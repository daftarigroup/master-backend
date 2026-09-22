import { Prisma, RepairIndentStatus } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { indentRepository, INDENT_INCLUDE } from '../repositories/indent.repository';
import { indentMapper } from './indent.mapper';

type Tx = Prisma.TransactionClient;

const TERMINAL: RepairIndentStatus[] = ['COMPLETED', 'PAYMENT_DONE'];

// Resolves a machine from either a real id (preferred — the live repair_tasks form
// already has real Machine.id via useMachines()) or, for back-compat with any caller
// still passing free-text name/serial, the same fuzzy match the frontend mock used.
async function resolveMachine(tx: Tx, body: Record<string, any>) {
  if (body.machineId) {
    const m = await tx.machine.findUnique({ where: { id: body.machineId } });
    if (!m) throw ApiError.badRequest('machineId does not reference an existing machine');
    return m;
  }
  if (body.machineSerialNo || body.machineName) {
    return tx.machine.findFirst({
      where: { OR: [{ serialNumber: body.machineSerialNo || undefined }, { name: body.machineName || undefined }] },
    });
  }
  return null;
}

// Rules 1/2 from ASSET_MAINTENANCE_REPAIR_SCHEMA_ARCHITECTURE.md §5 — status flips on
// create, rollup cascade on completion, guarded against double-firing (the frontend
// mock's bug: re-saving an already-terminal indent re-incremented the counters).
async function applyCreateCascade(tx: Tx, machineId: string | null) {
  if (!machineId) return;
  const machine = await tx.machine.update({ where: { id: machineId }, data: { status: 'UNDER_MAINTENANCE', statusChangedAt: new Date() } });
  if (machine.assetId) await tx.asset.update({ where: { id: machine.assetId }, data: { status: 'UNDER_REPAIR' } });
}

async function applyCompletionCascade(tx: Tx, machineId: string | null, cost: number, partNames: string[]) {
  if (!machineId) return;
  const machine = await tx.machine.update({ where: { id: machineId }, data: { status: 'OPERATIONAL', statusChangedAt: new Date() } });
  if (!machine.assetId) return;
  const asset = await tx.asset.findUnique({ where: { id: machine.assetId } });
  if (!asset) return;
  await tx.asset.update({
    where: { id: machine.assetId },
    data: {
      status: 'ACTIVE',
      repairCount: { increment: 1 },
      lastRepairDate: new Date(),
      lastRepairCost: cost,
      totalRepairCost: { increment: cost },
      partsChanged: asset.partsChanged || partNames.length > 0,
    },
  });
}

export const indentService = {
  async list(query: Record<string, any>) {
    const where: Prisma.RepairIndentWhereInput = {
      ...(query.firmId ? { firmId: BigInt(query.firmId) } : {}),
      ...(query.projectId ? { firmId: BigInt(query.projectId) } : {}),
      ...(query.machineId ? { machineId: query.machineId } : {}),
      ...(query.approvalStatus === 'Pending' ? { approvalStatus: 'PENDING' } : {}),
      ...(query.approvalStatus === 'notPending' ? { approvalStatus: { not: 'PENDING' } } : {}),
      ...(query.taskStatus ? { status: indentMapperStatus(query.taskStatus) } : {}),
    };
    const rows = await indentRepository.findMany(where);
    return rows.map(indentMapper.toDTO);
  },

  async getById(id: string) {
    const row = await indentRepository.findById(id);
    if (!row) throw ApiError.notFound('Indent not found');
    return indentMapper.toDTO(row);
  },

  async getByMachine(machineName: string, serialNo?: string | null) {
    const rows = await indentRepository.findMany({
      OR: [{ machine: { name: machineName } }, ...(serialNo ? [{ machine: { serialNumber: serialNo } }] : [])],
    });
    return rows.map(indentMapper.toDTO);
  },

  async nextSerialPreview() {
    const year = new Date().getFullYear();
    const seq = await prisma.documentSequence.findUnique({ where: { firmId_prefix_year: { firmId: 0n, prefix: 'REP', year } } });
    return `REP-${year}-${String((seq?.lastValue ?? 0) + 1).padStart(3, '0')}`;
  },

  async create(body: Record<string, any>) {
    return prisma.$transaction(async (tx) => {
      const machine = await resolveMachine(tx, body);
      const firmId = machine?.firmId ?? (body.firmId ? BigInt(body.firmId) : (body.projectId ? BigInt(body.projectId) : null));
      const indentNumber = await documentSequenceService.next({ prefix: 'REP', year: new Date().getFullYear(), pad: 3 }, tx);

      const row = await indentRepository.create(
        {
          indentNumber,
          problem: body.problem || '',
          priority: indentMapper.priorityFromFrontend(body.priority) ?? 'MEDIUM',
          expectedDeliveryDays: body.expectedDeliveryDays ?? 3,
          location: body.location ?? null,
          remarks: body.remarks ?? '',
          soundOfMachine: body.soundOfMachine ?? null,
          temperature: body.temperature ?? null,
          image: body.image ?? null,
          status: 'PENDING',
          approvalStatus: 'PENDING',
          ...(firmId ? { firm: { connect: { id: firmId } } } : {}),
          ...(machine ? { machine: { connect: { id: machine.id } }, ...(machine.assetId ? { asset: { connect: { id: machine.assetId } } } : {}) } : {}),
          ...(machine?.departmentId ? { department: { connect: { id: machine.departmentId } } } : body.departmentId ? { department: { connect: { id: BigInt(body.departmentId) } } } : {}),
          ...(body.machinePartId ? { machinePart: { connect: { id: body.machinePartId } } } : {}),
          ...(body.doerUserId ? { doer: { connect: { id: BigInt(body.doerUserId) } } } : {}),
          ...(body.vendorId ? { vendor: { connect: { id: body.vendorId } } } : {}),
        },
        tx
      );

      await applyCreateCascade(tx, machine?.id ?? null);
      const full = await tx.repairIndent.findUniqueOrThrow({ where: { id: row.id }, include: INDENT_INCLUDE });
      return indentMapper.toDTO(full);
    });
  },

  // Generic partial update (also backs `submitWorkUpdate` and any ad hoc field
  // edits) — status transitions into a terminal state trigger the completion
  // cascade exactly once, guarded against the frontend mock's double-fire bug.
  async update(id: string, body: Record<string, any>) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.repairIndent.findUnique({ where: { id } });
      if (!existing) throw ApiError.notFound('Indent not found');

      const data: Prisma.RepairIndentUpdateInput = {};
      if (body.problem !== undefined) data.problem = body.problem;
      if (body.priority !== undefined) data.priority = indentMapper.priorityFromFrontend(body.priority);
      if (body.expectedDeliveryDays !== undefined) data.expectedDeliveryDays = body.expectedDeliveryDays;
      if (body.location !== undefined) data.location = body.location;
      if (body.remarks !== undefined) data.remarks = body.remarks;
      if (body.soundOfMachine !== undefined) data.soundOfMachine = body.soundOfMachine;
      if (body.temperature !== undefined) data.temperature = body.temperature;
      if (body.image !== undefined) data.image = body.image;
      if (body.maintenanceCost !== undefined) data.maintenanceCost = body.maintenanceCost;
      if (body.vendorName !== undefined && !body.vendorId) {
        const vendor = await tx.repairVendor.findFirst({ where: { name: body.vendorName } });
        if (vendor) data.vendor = { connect: { id: vendor.id } };
      }
      if (body.vendorId !== undefined) data.vendor = { connect: { id: body.vendorId } };

      const newStatus = body.taskStatus ? indentMapper.statusFromFrontend(body.taskStatus) : undefined;
      if (newStatus) data.status = newStatus;

      const updated = await indentRepository.update(id, data, tx);

      const wasTerminal = TERMINAL.includes(existing.status);
      const isTerminal = newStatus ? TERMINAL.includes(newStatus) : wasTerminal;
      if (isTerminal && !wasTerminal) {
        const partNames = updated.machinePart?.name ? [updated.machinePart.name] : [];
        await applyCompletionCascade(tx, updated.machineId, Number(updated.maintenanceCost ?? 0), partNames);
      }

      return indentMapper.toDTO(updated);
    });
  },

  async approve(id: string, routing: 'Inhouse' | 'Outhouse', remarks?: string) {
    await indentRepository.update(id, {
      approvalStatus: 'APPROVED',
      routingType: routing === 'Inhouse' ? 'INHOUSE' : 'OUTHOUSE',
      approvedAt: new Date(),
      ...(remarks !== undefined ? { remarks } : {}),
      status: 'ASSIGNED',
    });
    if (routing === 'Outhouse') {
      await prisma.outhouseRepair.upsert({ where: { indentId: id }, create: { indentId: id }, update: {} });
    }
    return indentMapper.toDTO(await indentRepository.findById(id));
  },

  async reject(id: string, reason?: string) {
    const row = await indentRepository.update(id, { approvalStatus: 'REJECTED', ...(reason !== undefined ? { remarks: reason } : {}) });
    return indentMapper.toDTO(row);
  },

  async assignTechnician(id: string, technicianId: string, workNotes?: string) {
    const row = await indentRepository.update(id, {
      status: 'ASSIGNED',
      technician: { connect: { id: technicianId } },
      technicianAssignedAt: new Date(),
      technicianWorkNotes: workNotes ?? null,
    });
    return indentMapper.toDTO(row);
  },

  async completeRepair(id: string, finalCost: number, notes?: string) {
    return this.update(id, { taskStatus: 'Completed', maintenanceCost: finalCost, ...(notes !== undefined ? { remarks: notes } : {}) });
  },

  // --- Outhouse vendor lifecycle ---

  async saveOuthouseVendor(id: string, data: { vendorType?: string; vendorRemarks?: string }) {
    await prisma.outhouseRepair.upsert({
      where: { indentId: id },
      create: { indentId: id, vendorRemarks: data.vendorRemarks ?? null, vendorAssignedAt: new Date() },
      update: { vendorRemarks: data.vendorRemarks ?? undefined, vendorAssignedAt: new Date() },
    });
    return indentMapper.toDTO(await indentRepository.findById(id));
  },

  async saveOuthouseOffers(id: string, offers: Array<{ vendorId: string; rate: number; paymentTerm?: string }>) {
    return prisma.$transaction(async (tx) => {
      const outhouse = await tx.outhouseRepair.upsert({ where: { indentId: id }, create: { indentId: id }, update: {} });
      await tx.repairVendorOffer.createMany({
        data: offers.map((o) => ({ outhouseRepairId: outhouse.id, vendorId: o.vendorId, rate: o.rate, paymentTerm: o.paymentTerm ?? null })),
      });
      return indentMapper.toDTO(await tx.repairIndent.findUniqueOrThrow({ where: { id }, include: INDENT_INCLUDE }));
    });
  },

  async approveOuthouseRate(id: string, offerId: string) {
    return prisma.$transaction(async (tx) => {
      const outhouse = await tx.outhouseRepair.findUnique({ where: { indentId: id } });
      if (!outhouse) throw ApiError.notFound('Outhouse repair record not found for this indent');
      await tx.repairVendorOffer.updateMany({ where: { outhouseRepairId: outhouse.id }, data: { isApproved: false } });
      const offer = await tx.repairVendorOffer.update({ where: { id: offerId }, data: { isApproved: true } });
      await tx.outhouseRepair.update({ where: { id: outhouse.id }, data: { rateApprovedAt: new Date() } });
      await tx.repairIndent.update({ where: { id }, data: { vendor: { connect: { id: offer.vendorId } } } });
      return indentMapper.toDTO(await tx.repairIndent.findUniqueOrThrow({ where: { id }, include: INDENT_INCLUDE }));
    });
  },

  async recordOuthouseDispatch(id: string, data: { transporterName?: string; vehicleNo?: string; driverName?: string; driverContact?: string; expectedReturnDate?: string | Date; transportationCharges?: number; weighmentSlipNo?: string; transportImage?: string; sentPaymentType?: string; sentPaymentAmount?: number }) {
    return prisma.$transaction(async (tx) => {
      const outhouse = await tx.outhouseRepair.upsert({ where: { indentId: id }, create: { indentId: id }, update: {} });
      const sentAt = new Date();
      const expectedReturnDate = data.expectedReturnDate
        ? new Date(data.expectedReturnDate)
        : new Date(sentAt.getTime() + 3 * 24 * 60 * 60 * 1000);
      const dispatchPayload = {
        ...data,
        sentAt,
        expectedReturnDate,
      };
      await tx.repairDispatch.upsert({
        where: { outhouseRepairId: outhouse.id },
        create: { outhouseRepairId: outhouse.id, ...dispatchPayload },
        update: dispatchPayload,
      });
      await tx.repairIndent.update({ where: { id }, data: { status: 'SENT_FOR_REPAIR' } });
      return indentMapper.toDTO(await tx.repairIndent.findUniqueOrThrow({ where: { id }, include: INDENT_INCLUDE }));
    });
  },

  async recordOuthouseReceiving(id: string, data: any) {
    return prisma.$transaction(async (tx) => {
      const outhouse = await tx.outhouseRepair.upsert({ where: { indentId: id }, create: { indentId: id }, update: {} });

      const inspectedByName = data.inspectedByName || (typeof data.inspectedBy === 'string' ? data.inspectedBy.trim() : undefined);

      let inspectedByUserId: bigint | undefined = undefined;
      if (data.inspectedByUserId) {
        try {
          inspectedByUserId = BigInt(data.inspectedByUserId);
        } catch {
          inspectedByUserId = undefined;
        }
      }

      const validResults = ['PASS', 'FAIL', 'PENDING'];
      const rawResult = typeof data.inspectionResult === 'string' ? data.inspectionResult.trim() : '';
      const isEnumMatch = validResults.includes(rawResult.toUpperCase());
      const inspectionResult = isEnumMatch ? (rawResult.toUpperCase() as 'PASS' | 'FAIL' | 'PENDING') : 'PASS';
      const inspectionRemarks = data.inspectionRemarks || (!isEnumMatch && rawResult ? rawResult : undefined);

      const receivingPayload = {
        inspectedByName,
        ...(inspectedByUserId ? { inspectedByUserId } : {}),
        inspectionResult,
        inspectionRemarks,
        returnTransporterName: data.returnTransporterName || undefined,
        returnTransportAmount: data.returnTransportAmount !== undefined && data.returnTransportAmount !== null && !isNaN(Number(data.returnTransportAmount))
          ? Number(data.returnTransportAmount)
          : undefined,
        billImage: data.billImage || undefined,
        billNo: data.billNo || undefined,
        typeOfBill: data.typeOfBill || undefined,
        totalBillAmount: data.totalBillAmount !== undefined && data.totalBillAmount !== null && !isNaN(Number(data.totalBillAmount))
          ? Number(data.totalBillAmount)
          : undefined,
        toBePaidAmount: data.toBePaidAmount !== undefined && data.toBePaidAmount !== null && !isNaN(Number(data.toBePaidAmount))
          ? Number(data.toBePaidAmount)
          : undefined,
        receivedAt: new Date(),
      };

      await tx.repairReceiving.upsert({
        where: { outhouseRepairId: outhouse.id },
        create: { outhouseRepairId: outhouse.id, ...receivingPayload },
        update: receivingPayload,
      });
      await tx.repairIndent.update({ where: { id }, data: { status: 'STORE_IN' } });
      return indentMapper.toDTO(await tx.repairIndent.findUniqueOrThrow({ where: { id }, include: INDENT_INCLUDE }));
    });
  },

  async completeOuthousePayment(id: string, data: any) {
    return prisma.$transaction(async (tx) => {
      const outhouse = await tx.outhouseRepair.upsert({ where: { indentId: id }, create: { indentId: id }, update: {} });

      const billMatch = typeof data.billMatch === 'boolean'
        ? data.billMatch
        : (typeof data.billMatch === 'string' && (data.billMatch.toLowerCase().startsWith('yes') || data.billMatch.toLowerCase() === 'true'));

      const billStatus = typeof data.billStatus === 'string' ? data.billStatus : undefined;
      const paymentAmount = Number(data.finalPaymentAmount) || 0;
      const paymentMode = (data.paymentMode === 'ONLINE_TRANSFER' || data.paymentMode === 'CHEQUE' || data.paymentMode === 'CASH')
        ? data.paymentMode
        : undefined;

      // Fetch receiving details to know current net due and total bill
      const receiving = await tx.repairReceiving.findUnique({ where: { outhouseRepairId: outhouse.id } });
      const currentDue = receiving?.toBePaidAmount !== null && receiving?.toBePaidAmount !== undefined
        ? Number(receiving.toBePaidAmount)
        : (receiving?.totalBillAmount !== null && receiving?.totalBillAmount !== undefined ? Number(receiving.totalBillAmount) : paymentAmount);

      const remainingDue = Math.max(0, currentDue - paymentAmount);
      // It is fully settled if remaining balance is 0 and not marked as disputed, OR if marked explicitly as 'Cleared'
      const isPartial = (billStatus === 'Disputed' || billStatus === 'Pending') || remainingDue > 0;
      const isFullySettled = !isPartial;

      // Update receiving's remaining toBePaidAmount
      if (receiving) {
        await tx.repairReceiving.update({
          where: { id: receiving.id },
          data: { toBePaidAmount: remainingDue },
        });
      }

      // Existing payment record if any
      const existingPayment = await tx.repairPayment.findUnique({ where: { outhouseRepairId: outhouse.id } });
      const cumulativePaid = (existingPayment?.finalPaymentAmount ? Number(existingPayment.finalPaymentAmount) : 0) + paymentAmount;

      const paymentPayload = {
        billMatch,
        billStatus,
        finalPaymentAmount: cumulativePaid,
        ...(paymentMode ? { paymentMode } : {}),
        status: isFullySettled ? 'FULLY_PAID' as const : 'PARTIAL' as const,
        paidAt: new Date(),
      };

      await tx.repairPayment.upsert({
        where: { outhouseRepairId: outhouse.id },
        create: {
          outhouseRepairId: outhouse.id,
          ...paymentPayload,
        },
        update: paymentPayload,
      });

      const existing = await tx.repairIndent.findUniqueOrThrow({ where: { id } });

      if (isFullySettled) {
        const updated = await tx.repairIndent.update({
          where: { id },
          data: {
            status: 'PAYMENT_DONE',
            maintenanceCost: cumulativePaid,
          },
        });

        if (!TERMINAL.includes(existing.status)) {
          const withPart = await tx.repairIndent.findUniqueOrThrow({ where: { id }, include: { machinePart: true } });
          const partNames = withPart.machinePart?.name ? [withPart.machinePart.name] : [];
          await applyCompletionCascade(tx, updated.machineId, cumulativePaid, partNames);
        }
      } else {
        // Partial payment: keep status in STORE_IN (or pending payment), update maintenanceCost
        await tx.repairIndent.update({
          where: { id },
          data: {
            maintenanceCost: cumulativePaid,
          },
        });
      }

      return indentMapper.toDTO(await tx.repairIndent.findUniqueOrThrow({ where: { id }, include: INDENT_INCLUDE }));
    });
  },

  // --- Dashboard / reporting ---

  async dashboardStats() {
    const [total, inhouse, outhouse, completed] = await Promise.all([
      prisma.repairIndent.count(),
      prisma.repairIndent.count({ where: { routingType: 'INHOUSE' } }),
      prisma.repairIndent.count({ where: { routingType: 'OUTHOUSE' } }),
      prisma.repairIndent.count({ where: { status: { in: TERMINAL } } }),
    ]);
    return { total, inhouse, outhouse, completed };
  },

  // Shape matches repair/dailyreport/server/api/dailyreportApi.ts#DailyReportData —
  // the ONE consumer actually rendered (main_repairbotivate_dailyreport.tsx).
  // repairSystemApi.getDailyReport()'s alternate {date,totalRepairs,...} shape is
  // dead code (no component reads it), so this endpoint serves this shape instead.
  async dailyReport(date?: string) {
    const day = date ? new Date(date) : new Date();
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const end = new Date(start.getTime() + 86400000);

    const [indentsToday, machines] = await Promise.all([
      prisma.repairIndent.findMany({
        where: { OR: [{ createdAt: { gte: start, lt: end } }, { updatedAt: { gte: start, lt: end } }] },
        include: {
          doer: { select: { name: true, user_name: true } },
          technician: { select: { name: true } },
          machine: { select: { id: true, name: true, assetCode: true, serialNumber: true } },
          asset: { select: { id: true, productName: true, assetCode: true } },
          machinePart: { select: { name: true } },
          firm: { select: { id: true, firm_name: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.machine.findMany({ select: { status: true } }),
    ]);

    const tasks = indentsToday.map((i) => {
      const machineName = i.machine?.name || i.asset?.productName || 'General Machine';
      const machineId = i.machine?.assetCode || i.asset?.assetCode || i.machine?.serialNumber || machineName;
      const partInfo = i.machinePart?.name ? `Part: ${i.machinePart.name}` : '';
      const description = i.remarks || partInfo || (i.problem ? `Problem: ${i.problem}` : '');

      return {
        id: i.id,
        indentNumber: i.indentNumber || '',
        title: i.problem || (i.indentNumber ? `${i.indentNumber} – ${machineName}` : `Repair – ${machineName}`),
        problem: i.problem,
        description,
        machineName,
        machineId,
        assignedTo: i.technician?.name || i.doer?.name || i.doer?.user_name || 'Admin',
        status: TERMINAL.includes(i.status) ? 'completed' : i.status === 'PENDING' ? 'pending' : 'in-progress',
        priority: i.priority,
        createdAt: (i.createdAt || i.updatedAt || new Date()).toISOString(),
        updatedAt: (i.updatedAt || i.createdAt || new Date()).toISOString(),
        tenant: i.firm ? { id: String(i.firm.id), name: i.firm.firm_name } : null,
      };
    });

    const machineStats = {
      operational: machines.filter((m) => m.status === 'OPERATIONAL').length,
      maintenance: machines.filter((m) => m.status === 'UNDER_MAINTENANCE').length,
      down: machines.filter((m) => m.status === 'BREAKDOWN').length,
      totalMachines: machines.length,
    };

    return {
      tasks,
      stats: {
        totalTasks: tasks.length,
        completed: tasks.filter((t) => t.status === 'completed').length,
        inProgress: tasks.filter((t) => t.status === 'in-progress').length,
        pending: tasks.filter((t) => t.status === 'pending').length,
      },
      machineStats,
    };
  },

  async calendar() {
    const rows = await indentRepository.findMany({});
    return rows.map((i) => ({
      id: i.id,
      title: i.problem || `${i.machine?.name ?? 'Machine'} - ${i.machinePart?.name ?? 'Repair'}`,
      date: i.createdAt.toISOString().slice(0, 10),
      status: i.status,
      priority: i.priority || 'medium',
      type: 'repair',
      machineName: i.machine?.name ?? null,
      vendorName: i.vendor?.name ?? null,
    }));
  },

  // --- Derived list views (store-in / sent-machine / payments) ---
  // The frontend's separate StoreinItem/SentmachineItem/PaymentItem "mock" shapes
  // (storein/types, sentmachine/types, payment/types) were flagged in research as
  // orphaned/dead — never wired to any real component. These endpoints instead
  // project the real RepairReceiving/RepairDispatch/RepairPayment child tables,
  // which repairSystemApi.getStoreIn/getSentMachine/getPayments actually read.

  async storeInList() {
    const rows = await prisma.repairReceiving.findMany({
      include: { outhouseRepair: { include: { indent: { include: { machine: true, vendor: true } } } } },
      orderBy: { receivedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      indentId: r.outhouseRepair.indentId,
      indentNumber: r.outhouseRepair.indent.indentNumber ?? '',
      machineName: r.outhouseRepair.indent.machine?.name ?? '',
      machinePartName: '',
      vendorName: r.outhouseRepair.indent.vendor?.name ?? '',
      billNo: r.billNo ?? '',
      totalBillAmount: Number(r.totalBillAmount ?? 0),
      toBePaidAmount: Number(r.toBePaidAmount ?? 0),
      receivedAt: r.receivedAt?.toISOString().slice(0, 10) ?? '',
      receivedBy: '',
      inspectedBy: '',
      inspectionStatus: r.inspectionResult ?? 'Pending',
      status: r.status,
    }));
  },

  async sentMachineList() {
    const rows = await prisma.repairDispatch.findMany({
      include: { outhouseRepair: { include: { indent: { include: { machine: true, vendor: true } } } } },
      orderBy: { sentAt: 'desc' },
    });
    return rows.map((d) => ({
      id: d.id,
      indentId: d.outhouseRepair.indentId,
      indentNumber: d.outhouseRepair.indent.indentNumber ?? '',
      machineName: d.outhouseRepair.indent.machine?.name ?? '',
      vendorName: d.outhouseRepair.indent.vendor?.name ?? '',
      transporterName: d.transporterName ?? '',
      vehicleNo: d.vehicleNo ?? '',
      driverName: d.driverName ?? '',
      driverContact: d.driverContact ?? '',
      transportCharges: Number(d.transportationCharges ?? 0),
      weighmentSlipNo: d.weighmentSlipNo ?? '',
      sentAt: d.sentAt?.toISOString().slice(0, 10) ?? '',
      expectedReturnDate: d.expectedReturnDate?.toISOString().slice(0, 10) ?? '',
      status: d.outhouseRepair.indent.status === 'STORE_IN' || d.outhouseRepair.indent.status === 'COMPLETED' || d.outhouseRepair.indent.status === 'PAYMENT_DONE' ? 'Returned' : 'At Vendor',
    }));
  },

  async paymentsList() {
    const rows = await prisma.repairPayment.findMany({
      include: { outhouseRepair: { include: { indent: { include: { machine: true, vendor: true } } } } },
      orderBy: { paidAt: 'desc' },
    });
    return rows.map((p) => ({
      id: p.id,
      indentId: p.outhouseRepair.indentId,
      indentNumber: p.outhouseRepair.indent.indentNumber ?? '',
      machineName: p.outhouseRepair.indent.machine?.name ?? '',
      vendorName: p.outhouseRepair.indent.vendor?.name ?? '',
      billNo: '',
      totalBillAmount: Number(p.finalPaymentAmount ?? 0),
      paidAmount: Number(p.finalPaymentAmount ?? 0),
      balanceAmount: 0,
      paymentMode: p.paymentMode ?? 'ONLINE_TRANSFER',
      paidAt: p.paidAt?.toISOString().slice(0, 10) ?? '',
      status: p.status,
    }));
  },
};

function indentMapperStatus(taskStatus: string) {
  return indentMapper.statusFromFrontend(taskStatus);
}

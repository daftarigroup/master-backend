import { Prisma, WorkOrderStatus, WorkOrderType } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { workOrderRepository, WORK_ORDER_INCLUDE } from '../repositories/workOrder.repository';
import { workOrderMapper } from './workOrder.mapper';
import { parsePagination, paginationMeta } from './mapUtils';
import { priorityFromNumber } from './priority';

type Tx = Prisma.TransactionClient;

async function logStatus(tx: Tx, workOrderId: string, fromStatus: WorkOrderStatus | null, toStatus: WorkOrderStatus, note: string | null, changedByUserId: bigint | null) {
  await tx.workOrderStatusLog.create({
    data: { workOrderId, fromStatus, toStatus, note, changedByUserId },
  });
}

// Rule 4 from ASSET_MAINTENANCE_REPAIR_SCHEMA_ARCHITECTURE.md §5: completing a
// (non-repair) work order bumps the linked Asset's maintenance rollup cache.
async function applyMaintenanceCompletionCascade(tx: Tx, machineId: string) {
  const machine = await tx.machine.findUnique({ where: { id: machineId }, select: { assetId: true } });
  if (!machine?.assetId) return;
  await tx.asset.update({
    where: { id: machine.assetId },
    data: { maintenanceCount: { increment: 1 }, lastMaintenanceDate: new Date() },
  });
}

// A BREAKDOWN/REPAIR-type work order completed through Maintenance (not routed
// through the separate RepairIndent/outhouse-vendor flow) mirrors the repair-side
// cascade instead — same Asset fields RepairIndent completion would touch.
async function applyRepairCompletionCascade(tx: Tx, machineId: string, billAmount: number, partsChanged: boolean) {
  const machine = await tx.machine.findUnique({ where: { id: machineId }, select: { assetId: true } });
  if (!machine?.assetId) return;
  await tx.asset.update({
    where: { id: machine.assetId },
    data: {
      status: 'ACTIVE',
      repairCount: { increment: 1 },
      lastRepairDate: new Date(),
      lastRepairCost: billAmount,
      totalRepairCost: { increment: billAmount },
      partsChanged: partsChanged || undefined,
    },
  });
  await tx.machine.update({ where: { id: machineId }, data: { status: 'OPERATIONAL' } });
}

function parseStatus(status: any): Prisma.MaintenanceWorkOrderWhereInput['status'] | undefined {
  if (!status) return undefined;
  const list = (Array.isArray(status) ? status : String(status).split(','))
    .map((s) => s.trim())
    .filter(Boolean) as WorkOrderStatus[];
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return { in: list };
}

function parseType(type: any): Prisma.MaintenanceWorkOrderWhereInput['type'] | undefined {
  if (!type) return undefined;
  const list = (Array.isArray(type) ? type : String(type).split(','))
    .map((s) => s.trim())
    .filter(Boolean) as WorkOrderType[];
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return { in: list };
}

export const workOrderService = {
  async list(query: Record<string, any>, currentUserId: bigint | null) {
    const { page, limit, skip } = parsePagination(query);
    const parsedStatus = parseStatus(query.status);
    const parsedType = parseType(query.type);

    const where: Prisma.MaintenanceWorkOrderWhereInput = {
      ...(parsedStatus ? { status: parsedStatus } : {}),
      ...(query.machineId ? { machineId: query.machineId } : {}),
      ...(parsedType ? { type: parsedType } : {}),
      ...(query.assigneeId ? { currentAssigneeUserId: BigInt(query.assigneeId) } : {}),
      ...(query.view === 'personal' && currentUserId ? { currentAssigneeUserId: currentUserId } : {}),
      ...(query.from || query.to
        ? { actualDueDate: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
      ...(query.repairOnly === 'true' || query.repairOnly === true ? { type: { in: ['REPAIR', 'BREAKDOWN'] } } : {}),
      ...(query.excludeRepair === 'true' || query.excludeRepair === true ? { type: { notIn: ['REPAIR', 'BREAKDOWN'] } } : {}),
      ...(query.overdue === 'true' || query.overdue === true
        ? { actualDueDate: { lt: new Date() }, status: { notIn: ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED'] } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { workOrderCode: { contains: query.search, mode: 'insensitive' } },
              { machine: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(query.scope === 'outbox' ? { transfers: { some: { fromUserId: currentUserId ?? undefined } } } : {}),
      ...(query.scope === 'transfer' ? { transfers: { some: { toUserId: currentUserId ?? undefined } } } : {}),
    };

    const [rows, total] = await Promise.all([workOrderRepository.findMany(where, skip, limit), workOrderRepository.count(where)]);
    return { status: 'success', data: rows.map(workOrderMapper.toDTO), pagination: paginationMeta(page, limit, total) };
  },

  async getById(id: string) {
    const row = await workOrderRepository.findById(id);
    if (!row) throw ApiError.notFound('Work order not found');
    return workOrderMapper.toDTO(row);
  },

  async stats(query: Record<string, any> = {}, currentUserId: bigint | null = null) {
    const whereBase: Prisma.MaintenanceWorkOrderWhereInput = {
      ...(query.machineId ? { machineId: query.machineId } : {}),
      ...(query.assigneeId ? { currentAssigneeUserId: BigInt(query.assigneeId) } : {}),
      ...(query.view === 'personal' && currentUserId ? { currentAssigneeUserId: currentUserId } : {}),
      ...(query.repairOnly === 'true' || query.repairOnly === true ? { type: { in: ['REPAIR', 'BREAKDOWN'] } } : {}),
      ...(query.excludeRepair === 'true' || query.excludeRepair === true ? { type: { notIn: ['REPAIR', 'BREAKDOWN'] } } : {}),
      ...(query.frequency ? { plan: { frequency: query.frequency } } : {}),
      ...(query.from || query.to
        ? { actualDueDate: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    };

    const [total, pending, completed, overdue] = await Promise.all([
      prisma.maintenanceWorkOrder.count({ where: whereBase }),
      prisma.maintenanceWorkOrder.count({ where: { ...whereBase, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
      prisma.maintenanceWorkOrder.count({ where: { ...whereBase, status: { in: ['COMPLETED', 'COMPLETED_LATE'] } } }),
      prisma.maintenanceWorkOrder.count({
        where: {
          ...whereBase,
          actualDueDate: { lt: new Date() },
          status: { notIn: ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED'] },
        },
      }),
    ]);
    return { total, pending, completed, overdue, history: completed, upcoming: pending };
  },

  async assertExists(id: string) {
    const row = await workOrderRepository.findById(id);
    if (!row) throw ApiError.notFound('Work order not found');
    return row;
  },

  // Internal helper — used by planService (occurrence at plan creation) and
  // breakdownService (auto-generated BREAKDOWN work order).
  async createInternal(
    tx: Tx,
    input: {
      machineId: string;
      firmId?: bigint | null;
      planId?: string | null;
      breakdownReportId?: string | null;
      type: 'SCHEDULED' | 'BREAKDOWN' | 'ONE_TIME' | 'REPAIR';
      actualDueDate: Date;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      currentAssigneeUserId?: bigint | null;
      machinePartId?: string | null;
    }
  ) {
    const workOrderCode = await documentSequenceService.next({ prefix: 'WO', year: new Date().getFullYear(), pad: 3 }, tx);
    return workOrderRepository.create(
      {
        workOrderCode,
        type: input.type,
        status: 'PENDING',
        priority: input.priority ?? 'MEDIUM',
        actualDueDate: input.actualDueDate,
        scheduledDate: input.actualDueDate,
        machine: { connect: { id: input.machineId } },
        ...(input.firmId ? { firm: { connect: { id: input.firmId } } } : {}),
        ...(input.planId ? { plan: { connect: { id: input.planId } } } : {}),
        ...(input.breakdownReportId ? { breakdownReport: { connect: { id: input.breakdownReportId } } } : {}),
        ...(input.machinePartId ? { machinePart: { connect: { id: input.machinePartId } } } : {}),
        ...(input.currentAssigneeUserId ? { currentAssignee: { connect: { id: input.currentAssigneeUserId } } } : {}),
      },
      tx
    );
  },

  async transfer(id: string, body: { toUserId: string; type: 'OCCURRENCE_TRANSFER' | 'PERMANENT_TRANSFER' | 'TEMPORARY_COVER'; reason?: string; newDueDate?: string }, fromUserId: bigint | null) {
    const wo = await this.assertExists(id);
    const toUserId = BigInt(body.toUserId);

    return prisma.$transaction(async (tx) => {
      await tx.workOrderTransfer.create({
        data: { workOrderId: id, fromUserId, toUserId, type: body.type, status: 'APPROVED', reason: body.reason ?? null },
      });

      const data: Prisma.MaintenanceWorkOrderUpdateInput = {
        currentAssignee: { connect: { id: toUserId } },
        ...(body.newDueDate ? { actualDueDate: new Date(body.newDueDate), wasShifted: true } : {}),
      };
      const updated = await workOrderRepository.update(id, data, tx);

      if (body.type === 'PERMANENT_TRANSFER' && wo.planId) {
        await tx.maintenancePlan.update({ where: { id: wo.planId }, data: { assignedToUserId: toUserId } });
      }

      return workOrderMapper.toDTO(updated);
    });
  },

  async markDone(id: string, body: { completionNote?: string; actualMinutesTaken?: number; partsUsed?: string[]; documentUrl?: string }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      // Create the approval request before the final `include`-driven fetch below,
      // so the returned DTO's `approvalRequest` reflects it (previously fetched
      // stale — the update ran before the approval row existed).
      await tx.workOrderApprovalRequest.create({
        data: { workOrderId: id, status: 'PENDING', submissionNote: body.completionNote ?? null, submittedByUserId: userId, requestedAt: now },
      });
      const updated = await workOrderRepository.update(
        id,
        {
          status: 'PENDING_APPROVAL',
          startedAt: wo.startedAt ?? now,
          completedAt: now,
          completedBy: userId ? { connect: { id: userId } } : (wo.currentAssigneeUserId ? { connect: { id: wo.currentAssigneeUserId } } : undefined),
          completionNote: body.completionNote ?? wo.completionNote,
          actualMinutesTaken: body.actualMinutesTaken ?? wo.actualMinutesTaken,
        },
        tx
      );
      await logStatus(tx, id, wo.status, 'PENDING_APPROVAL', 'Marked done, awaiting approval', userId);
      return workOrderMapper.toDTO(updated);
    });
  },

  async markNotDone(id: string, body: { reason: string }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    return prisma.$transaction(async (tx) => {
      const updated = await workOrderRepository.update(id, { status: 'IN_PROGRESS' }, tx);
      await logStatus(tx, id, wo.status, 'IN_PROGRESS', body.reason, userId);
      return workOrderMapper.toDTO(updated);
    });
  },

  async extend(id: string, body: { newDueDate: string; reason?: string }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    return prisma.$transaction(async (tx) => {
      const updated = await workOrderRepository.update(id, { actualDueDate: new Date(body.newDueDate), wasShifted: true }, tx);
      await logStatus(tx, id, wo.status, wo.status, body.reason ? `Due date extended: ${body.reason}` : 'Due date extended', userId);
      return workOrderMapper.toDTO(updated);
    });
  },

  async hold(id: string, body: { reason?: string }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    return prisma.$transaction(async (tx) => {
      const updated = await workOrderRepository.update(id, { status: 'ON_HOLD' }, tx);
      await logStatus(tx, id, wo.status, 'ON_HOLD', body.reason ?? null, userId);
      return workOrderMapper.toDTO(updated);
    });
  },

  async cancel(id: string, body: { reason: string }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    return prisma.$transaction(async (tx) => {
      const updated = await workOrderRepository.update(id, { status: 'CANCELLED', cancelReason: body.reason }, tx);
      await logStatus(tx, id, wo.status, 'CANCELLED', body.reason, userId);
      return workOrderMapper.toDTO(updated);
    });
  },

  async skip(id: string, body: { skipReason: string }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    return prisma.$transaction(async (tx) => {
      const updated = await workOrderRepository.update(id, { status: 'SKIPPED', skipReason: body.skipReason }, tx);
      await logStatus(tx, id, wo.status, 'SKIPPED', body.skipReason, userId);
      return workOrderMapper.toDTO(updated);
    });
  },

  async approve(id: string, body: { reviewNote?: string }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    const pending = wo.approvalRequests?.[0];
    if (!pending || pending.status !== 'PENDING') throw ApiError.badRequest('No pending approval request for this work order');

    return prisma.$transaction(async (tx) => {
      await tx.workOrderApprovalRequest.update({
        where: { id: pending.id },
        data: { status: 'APPROVED', reviewedAt: new Date(), reviewNote: body.reviewNote ?? null, reviewedByUserId: userId },
      });
      const isLate = wo.actualDueDate && new Date() > wo.actualDueDate;
      const updated = await workOrderRepository.update(
        id,
        { status: isLate ? 'COMPLETED_LATE' : 'COMPLETED', completedAt: wo.completedAt ?? new Date(), completedBy: wo.completedByUserId ? undefined : (wo.currentAssigneeUserId ? { connect: { id: wo.currentAssigneeUserId } } : undefined) },
        tx
      );
      await logStatus(tx, id, wo.status, updated.status, body.reviewNote ?? 'Approved', userId);

      if (wo.type === 'REPAIR' || wo.type === 'BREAKDOWN') {
        // Cost isn't captured on this path (plain approve, no bill amount submitted)
        // — processRepair() is the path that records billAmount; this just flips
        // status/counters so a repair approved without going through processRepair
        // still shows up in Asset.repairCount history.
        const parts = await tx.workOrderRepairPart.findMany({ where: { workOrderId: id } });
        await applyRepairCompletionCascade(tx, wo.machineId, 0, parts.length > 0);
      } else {
        await applyMaintenanceCompletionCascade(tx, wo.machineId);
      }

      return workOrderMapper.toDTO(updated);
    });
  },

  async reject(id: string, body: { reviewNote: string; newDueDate?: string }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    const pending = wo.approvalRequests?.[0];
    if (!pending || pending.status !== 'PENDING') throw ApiError.badRequest('No pending approval request for this work order');

    return prisma.$transaction(async (tx) => {
      await tx.workOrderApprovalRequest.update({
        where: { id: pending.id },
        data: { status: 'REJECTED', reviewedAt: new Date(), reviewNote: body.reviewNote, reviewedByUserId: userId },
      });
      const updated = await workOrderRepository.update(
        id,
        { status: 'COMPLETION_REJECTED', ...(body.newDueDate ? { actualDueDate: new Date(body.newDueDate), wasShifted: true } : {}) },
        tx
      );
      await logStatus(tx, id, wo.status, 'COMPLETION_REJECTED', body.reviewNote, userId);
      return workOrderMapper.toDTO(updated);
    });
  },

  async approvalHistory(query: Record<string, any>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.MaintenanceWorkOrderWhereInput = {
      approvalRequests: { some: { ...(query.status ? { status: query.status } : {}) } },
    };
    const [rows, total] = await Promise.all([workOrderRepository.findMany(where, skip, limit, { updatedAt: 'desc' }), workOrderRepository.count(where)]);
    return { data: rows.map(workOrderMapper.toDTO), pagination: paginationMeta(page, limit, total) };
  },

  // Repair-processing sub-flow (WorkOrder.type = REPAIR/BREAKDOWN): records parts
  // replaced + bill amount as real WorkOrderRepairPart rows (replacing the
  // frontend's untyped `checklistResponses.repairProcess` JSON blob), and on
  // completion applies the same Asset cascade a RepairIndent completion would.
  async processRepair(
    id: string,
    body: {
      status: 'in_progress' | 'completed' | 'cancelled';
      parts?: Array<{ partName: string; quantity: number; vendorName?: string; warrantyFromDate?: string; warrantyToDate?: string }>;
      vendorName?: string;
      billAmount?: number;
      workDone?: string;
      remarks?: string;
      photoUrl?: string;
      billUrl?: string;
      typeOfWork?: string;
    },
    userId: bigint | null
  ) {
    const wo = await this.assertExists(id);
    const nextStatus: WorkOrderStatus = body.status === 'completed' ? 'COMPLETED' : body.status === 'cancelled' ? 'CANCELLED' : 'IN_PROGRESS';

    return prisma.$transaction(async (tx) => {
      if (Array.isArray(body.parts) && body.parts.length > 0) {
        await tx.workOrderRepairPart.deleteMany({ where: { workOrderId: id } });
        await tx.workOrderRepairPart.createMany({
          data: body.parts.map((p) => ({
            workOrderId: id,
            partName: p.partName,
            quantity: p.quantity ?? 1,
            vendorName: p.vendorName ?? null,
            warrantyFromDate: p.warrantyFromDate ? new Date(p.warrantyFromDate) : null,
            warrantyToDate: p.warrantyToDate ? new Date(p.warrantyToDate) : null,
          })),
        });
      }

      const updated = await workOrderRepository.update(
        id,
        {
          status: nextStatus,
          completionNote: body.workDone ?? body.remarks ?? wo.completionNote,
          ...(body.typeOfWork !== undefined ? { typeOfWork: body.typeOfWork } : {}),
          ...(body.billAmount !== undefined ? { cost: body.billAmount } : {}),
          ...(body.photoUrl !== undefined ? { photoUrl: body.photoUrl } : {}),
          ...(body.billUrl !== undefined ? { billUrl: body.billUrl } : {}),
          ...(nextStatus === 'COMPLETED' ? { completedAt: new Date(), completedBy: wo.currentAssigneeUserId ? { connect: { id: wo.currentAssigneeUserId } } : undefined } : {}),
        },
        tx
      );
      await logStatus(tx, id, wo.status, nextStatus, body.workDone ?? body.remarks ?? null, userId);

      // If marked as Outsource, queue to Outhouse Repair Indent pipeline (Sent Machines -> Store In -> Payments)
      if (body.typeOfWork === 'out_source' || body.typeOfWork === 'outhouse') {
        await syncOuthouseIndent(tx, wo, body);
      } else if (body.typeOfWork === 'in_house') {
        // If switched back to In-House, mark any existing linked indent as INHOUSE
        const existingIndent = await tx.repairIndent.findFirst({ where: { workOrderId: id } });
        if (existingIndent) {
          await tx.repairIndent.update({
            where: { id: existingIndent.id },
            data: { routingType: 'INHOUSE' },
          });
        }
      }

      if (nextStatus === 'COMPLETED') {
        await applyRepairCompletionCascade(tx, wo.machineId, body.billAmount ?? 0, (body.parts?.length ?? 0) > 0);
      }

      return workOrderMapper.toDTO(updated);
    });
  },
};

async function syncOuthouseIndent(
  tx: Tx,
  wo: {
    id: string;
    firmId: bigint | null;
    machineId: string;
    machinePartId: string | null;
    workOrderCode: string | null;
    priority: any;
    plan?: { title?: string | null } | null;
    currentAssigneeUserId?: bigint | null;
  },
  body: {
    parts?: Array<{ partName: string; quantity: number; vendorName?: string }>;
    vendorName?: string;
    billAmount?: number;
    remarks?: string;
    workDone?: string;
  }
) {
  const machine = await tx.machine.findUnique({
    where: { id: wo.machineId },
    select: { assetId: true, departmentId: true, name: true, serialNumber: true },
  });

  const vendorName = (body.vendorName || body.parts?.find((p) => p.vendorName)?.vendorName)?.trim();
  let vendorId: string | null = null;
  if (vendorName) {
    const existingVendor = await tx.repairVendor.findFirst({
      where: { name: { equals: vendorName, mode: 'insensitive' } },
    });
    if (existingVendor) {
      vendorId = existingVendor.id;
    } else {
      const newVendor = await tx.repairVendor.create({
        data: { name: vendorName, type: 'Repair' },
      });
      vendorId = newVendor.id;
    }
  }

  // Check if indent already exists for this work order
  const existingIndent = await tx.repairIndent.findFirst({
    where: { workOrderId: wo.id },
    include: { outhouseRepair: true },
  });

  let indentId: string;
  if (existingIndent) {
    indentId = existingIndent.id;
    await tx.repairIndent.update({
      where: { id: indentId },
      data: {
        vendorId: vendorId ?? existingIndent.vendorId,
        remarks: body.remarks || body.workDone || existingIndent.remarks,
        maintenanceCost: body.billAmount !== undefined ? body.billAmount : existingIndent.maintenanceCost,
        status: 'ASSIGNED',
        approvalStatus: 'APPROVED',
        routingType: 'OUTHOUSE',
      },
    });
  } else {
    const year = new Date().getFullYear();
    const indentNumber = await documentSequenceService.next(
      { prefix: 'REP', year, pad: 3, firmId: wo.firmId ?? undefined },
      tx
    );

    const newIndent = await tx.repairIndent.create({
      data: {
        indentNumber,
        workOrderId: wo.id,
        firmId: wo.firmId,
        machineId: wo.machineId,
        assetId: machine?.assetId ?? null,
        machinePartId: wo.machinePartId,
        departmentId: machine?.departmentId ?? null,
        doerUserId: wo.currentAssigneeUserId ?? null,
        problem: wo.plan?.title || (wo.workOrderCode ? `Task ${wo.workOrderCode}` : 'Outsourced Machine Repair'),
        priority: wo.priority ?? 'MEDIUM',
        status: 'ASSIGNED',
        approvalStatus: 'APPROVED',
        routingType: 'OUTHOUSE',
        approvedAt: new Date(),
        vendorId,
        remarks: body.remarks || body.workDone || 'Queued from Repair Task',
        expectedDeliveryDays: 3,
        maintenanceCost: body.billAmount ?? 0,
      },
    });
    indentId = newIndent.id;
  }

  // Upsert OuthouseRepair
  const outhouse = await tx.outhouseRepair.upsert({
    where: { indentId },
    create: {
      indentId,
      rateApprovedAt: new Date(),
    },
    update: {
      rateApprovedAt: new Date(),
    },
  });

  // If vendor exists, ensure RepairVendorOffer exists and is approved
  if (vendorId) {
    const existingOffer = await tx.repairVendorOffer.findFirst({
      where: { outhouseRepairId: outhouse.id, vendorId },
    });
    if (existingOffer) {
      await tx.repairVendorOffer.update({
        where: { id: existingOffer.id },
        data: {
          rate: body.billAmount ?? existingOffer.rate,
          isApproved: true,
        },
      });
    } else {
      await tx.repairVendorOffer.create({
        data: {
          outhouseRepairId: outhouse.id,
          vendorId,
          rate: body.billAmount ?? 0,
          isApproved: true,
        },
      });
    }
  }

  // Update Machine to UNDER_MAINTENANCE and Asset to UNDER_REPAIR
  await tx.machine.update({ where: { id: wo.machineId }, data: { status: 'UNDER_MAINTENANCE' } });
  if (machine?.assetId) {
    await tx.asset.update({ where: { id: machine.assetId }, data: { status: 'UNDER_REPAIR' } });
  }
}

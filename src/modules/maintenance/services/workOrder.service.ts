import { Prisma, WorkOrderStatus, WorkOrderType } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { nextIndentNumber } from '../../repair/services/indentNumber';
import { adjustRolledUpCost, applyMaintenanceRollupOnce, applyRepairRollupOnce } from './repairRollup';
import { workOrderRepository, WORK_ORDER_INCLUDE } from '../repositories/workOrder.repository';
import { workOrderMapper } from './workOrder.mapper';
import { parsePagination, paginationMeta } from './mapUtils';
import { priorityFromNumber } from './priority';
import { UserAuthContext } from '../../../utils/currentUser';
import { NO_FIRM, assertFirmWritable, parseBigIntId, parseFirmId } from '../../../utils/firmScope';
import { isAdmin, isOpenStatus } from '../lib/workOrderAccess';
import { involvementWhere, loadVisibleWorkOrder } from './workOrderGuard';
import { toIstDateString } from '../../fleet/lib/istDate';
import { currentReadingFor } from '../../fleet/lib/currentReading';
import { documentService } from '../../fleet/services/document.service';
import { workOrderPartsService, PartInput } from './workOrderParts.service';

type Tx = Prisma.TransactionClient;

async function logStatus(tx: Tx, workOrderId: string, fromStatus: WorkOrderStatus | null, toStatus: WorkOrderStatus, note: string | null, changedByUserId: bigint | null) {
  await tx.workOrderStatusLog.create({
    data: { workOrderId, fromStatus, toStatus, note, changedByUserId },
  });
}

// Rollups on the Asset/Machine (maintenance count, repair count and cost, status back to ACTIVE/OPERATIONAL) are
// applied at most once per work order, through `rollupAppliedAt` (see repairRollup.ts). They used to fire from two
// modules independently, which double-counted out-source repairs and restored the machine while it was at the vendor.
// A job that is out at a vendor is rolled up when it comes back (outsource.service), not when it is marked done.
const isAtVendor = (status: string | null | undefined) => status === 'TO_SEND' || status === 'SENT';

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

export interface CreateWorkOrderBody {
  type: 'SCHEDULED' | 'BREAKDOWN' | 'ONE_TIME' | 'REPAIR';
  machineId: string;
  firmId?: bigint | null;
  title: string;
  description?: string | null;
  activityTypeId?: string | null;
  dueAt: Date;
  assigneeId?: bigint | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  documentUrl?: string | null;
  machinePartId?: string | null;
  // task assignment and service details (fleet_v3_ops)
  responsibleId?: bigint | null;
  scheduleId?: string | null;
  serviceMode?: 'IN_HOUSE' | 'VENDOR';
  vendorId?: string | null;
  estPartsCost?: number | null;
  estLabourCost?: number | null;
  breakdownReportId?: string | null;
  failureType?: string | null;
  failureTime?: Date | null;
  estimatedDowntimeHours?: number | null;
  rootCause?: string | null;
  remarks?: string | null;
}

/** A row with no firm is visible to everyone (as machines are); otherwise its firm must be permitted. */
export function canSeeFirm(ctx: UserAuthContext, firmId: bigint | null): boolean {
  return ctx.role === 'SUPER_ADMIN' || firmId === null || ctx.permittedFirms.includes(firmId);
}

function normalizeAuthContext(auth?: UserAuthContext | bigint | null): UserAuthContext | null {
  if (!auth) return null;
  if (typeof auth === 'bigint') {
    return { userId: auth, role: 'USER', permittedFirms: [] };
  }
  return auth;
}

function buildWorkOrderScope(
  query: Record<string, any>,
  authCtx: UserAuthContext | null
): Prisma.MaintenanceWorkOrderWhereInput[] {
  if (!authCtx) return [];
  const conditions: Prisma.MaintenanceWorkOrderWhereInput[] = [];

  // 'all', '' or junk mean "no specific firm" (they used to crash BigInt() and return a 500).
  const requestedFirm = parseFirmId(query.firmId ?? query.projectId);
  const assignee = parseFirmId(query.assigneeId);

  if (authCtx.role === 'SUPER_ADMIN') {
    if (requestedFirm !== null) {
      conditions.push({
        OR: [
          { firmId: requestedFirm },
          { machine: { firmId: requestedFirm } },
          { machine: { assignments: { some: { endedAt: null, firmId: requestedFirm } } } },
        ],
      });
    }
  } else {
    // ADMIN and USER are scoped identically: to their own permitted firms, narrowed to the requested one if allowed.
    let allowedFirms = authCtx.permittedFirms;
    if (requestedFirm !== null) {
      allowedFirms = authCtx.permittedFirms.includes(requestedFirm) ? [requestedFirm] : [NO_FIRM];
    }
    const ids = allowedFirms.length > 0 ? allowedFirms : [NO_FIRM];
    conditions.push({
      OR: [
        { firmId: { in: ids } },
        { machine: { firmId: { in: ids } } },
        { machine: { assignments: { some: { endedAt: null, firmId: { in: ids } } } } },
      ],
    });
  }

  if (assignee !== null) conditions.push({ currentAssigneeUserId: assignee });
  const responsible = parseFirmId(query.responsibleId);
  if (responsible !== null) conditions.push({ responsibleId: responsible });
  const requester = parseFirmId(query.requestedById);
  if (requester !== null) conditions.push({ requestedById: requester });
  if (query.view === 'personal' && authCtx.userId) conditions.push({ currentAssigneeUserId: authCtx.userId });

  const me = authCtx.userId;
  // site users see only the work orders they are involved in (assigned, responsible, requested, completed, reassigned)
  if (authCtx.role === 'USER') conditions.push(me === null ? { id: '__none__' } : involvementWhere(me));
  if (me !== null) {
    if (query.view === 'assigned') conditions.push({ currentAssigneeUserId: me });
    if (query.view === 'responsible') conditions.push({ responsibleId: me });
    if (query.view === 'created') conditions.push({ requestedById: me });
    // approvals waiting for ME: the responsible person's own queue; an admin sees everything except work they did themselves; SUPER_ADMIN has full access to all
    if (query.pendingMyApproval === 'true' || query.pendingMyApproval === true) {
      conditions.push({ status: 'PENDING_APPROVAL' });
      if (authCtx.role === 'SUPER_ADMIN') {
        // SUPER_ADMIN has full access to all data and approval stages
      } else if (isAdmin({ userId: me, role: authCtx.role })) {
        conditions.push({ NOT: { approvalRequests: { some: { status: 'PENDING', submittedByUserId: me } } } });
      } else {
        conditions.push({ responsibleId: me });
      }
    }
  }
  if (query.scope === 'outbox') conditions.push({ transfers: { some: { fromUserId: authCtx.userId ?? undefined } } });
  if (query.scope === 'transfer') conditions.push({ transfers: { some: { toUserId: authCtx.userId ?? undefined } } });

  return conditions;
}

export const workOrderService = {
  async list(query: Record<string, any>, auth?: UserAuthContext | bigint | null) {
    const authCtx = normalizeAuthContext(auth);
    const { page, limit, skip } = parsePagination(query);
    const parsedStatus = parseStatus(query.status);
    const parsedType = parseType(query.type);

    const andConditions: Prisma.MaintenanceWorkOrderWhereInput[] = [];

    if (parsedStatus) andConditions.push({ status: parsedStatus });
    if (query.machineId) andConditions.push({ machineId: query.machineId });
    if (parsedType) andConditions.push({ type: parsedType });
    if (query.from || query.to) {
      andConditions.push({
        actualDueDate: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      });
    }
    if (query.repairOnly === 'true' || query.repairOnly === true) {
      andConditions.push({ type: { in: ['REPAIR', 'BREAKDOWN'] } });
    }
    if (query.excludeRepair === 'true' || query.excludeRepair === true) {
      andConditions.push({ type: { notIn: ['REPAIR', 'BREAKDOWN'] } });
    }
    if (query.overdue === 'true' || query.overdue === true) {
      andConditions.push({
        actualDueDate: { lt: new Date() },
        status: { notIn: ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED'] },
      });
    }
    // repairs that need Store parts and are not finished (the list shows exactly how many are issued)
    if (query.waitingParts === 'true' || query.waitingParts === true) {
      andConditions.push({ materialRequired: true, outsourceStatus: null, status: { notIn: ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED'] } });
    }
    // Outsourced tab: any outsourced job, or one stage of the To send -> Sent -> Received -> Paid track
    if (['TO_SEND', 'SENT', 'RECEIVED', 'PAID'].includes(String(query.outsourceStatus))) {
      andConditions.push({ outsourceStatus: query.outsourceStatus });
    } else if (query.outsourced === 'true' || query.outsourced === true) {
      andConditions.push({ outsourceStatus: { not: null } });
    }
    if (query.search) {
      andConditions.push({
        OR: [
          { workOrderCode: { contains: query.search, mode: 'insensitive' } },
          { title: { contains: query.search, mode: 'insensitive' } },
          { machine: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }

    andConditions.push(...buildWorkOrderScope(query, authCtx));

    const where: Prisma.MaintenanceWorkOrderWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

    const [rows, total] = await Promise.all([workOrderRepository.findMany(where, skip, limit), workOrderRepository.count(where)]);
    return { status: 'success', data: rows.map(workOrderMapper.toDTO), pagination: paginationMeta(page, limit, total) };
  },

  async getById(id: string, ctx?: UserAuthContext) {
    if (ctx) await loadVisibleWorkOrder(ctx, id);
    const row = await workOrderRepository.findById(id);
    if (!row) throw ApiError.notFound('Work order not found');
    return workOrderMapper.toDTO(row);
  },

  async stats(query: Record<string, any> = {}, auth?: UserAuthContext | bigint | null) {
    const authCtx = normalizeAuthContext(auth);
    const andConditions: Prisma.MaintenanceWorkOrderWhereInput[] = [];

    if (query.machineId) andConditions.push({ machineId: query.machineId });
    if (query.repairOnly === 'true' || query.repairOnly === true) {
      andConditions.push({ type: { in: ['REPAIR', 'BREAKDOWN'] } });
    }
    if (query.excludeRepair === 'true' || query.excludeRepair === true) {
      andConditions.push({ type: { notIn: ['REPAIR', 'BREAKDOWN'] } });
    }
    if (query.frequency) andConditions.push({ plan: { frequency: query.frequency } });
    if (query.from || query.to) {
      andConditions.push({
        actualDueDate: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      });
    }

    andConditions.push(...buildWorkOrderScope(query, authCtx));

    const whereBase: Prisma.MaintenanceWorkOrderWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

    const [total, pending, completed, overdue] = await Promise.all([
      prisma.maintenanceWorkOrder.count({ where: whereBase }),
      prisma.maintenanceWorkOrder.count({ where: { AND: [whereBase, { status: { in: ['PENDING', 'IN_PROGRESS'] } }] } }),
      prisma.maintenanceWorkOrder.count({ where: { AND: [whereBase, { status: { in: ['COMPLETED', 'COMPLETED_LATE'] } }] } }),
      prisma.maintenanceWorkOrder.count({
        where: {
          AND: [
            whereBase,
            {
              actualDueDate: { lt: new Date() },
              status: { notIn: ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED'] },
            },
          ],
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
      // the work order's own content (it no longer depends on a plan for its title, description, ...)
      title?: string | null;
      description?: string | null;
      activityTypeId?: string | null;
      documentUrl?: string | null;
      requestedById?: bigint | null;
      responsibleId?: bigint | null;
      scheduleId?: string | null;
      serviceMode?: 'IN_HOUSE' | 'VENDOR';
      vendorId?: string | null;
      estPartsCost?: number | null;
      estLabourCost?: number | null;
    }
  ) {
    const workOrderCode = await documentSequenceService.next({ prefix: 'WO', year: new Date().getFullYear(), pad: 3 }, tx);
    const created = await workOrderRepository.create(
      {
        workOrderCode,
        type: input.type,
        status: 'PENDING',
        priority: input.priority ?? 'MEDIUM',
        actualDueDate: input.actualDueDate,
        scheduledDate: input.actualDueDate,
        title: input.title ?? null,
        description: input.description ?? null,
        documentUrl: input.documentUrl ?? null,
        machine: { connect: { id: input.machineId } },
        ...(input.firmId ? { firm: { connect: { id: input.firmId } } } : {}),
        ...(input.planId ? { plan: { connect: { id: input.planId } } } : {}),
        ...(input.breakdownReportId ? { breakdownReport: { connect: { id: input.breakdownReportId } } } : {}),
        ...(input.machinePartId ? { machinePart: { connect: { id: input.machinePartId } } } : {}),
        ...(input.activityTypeId ? { activityType: { connect: { id: input.activityTypeId } } } : {}),
        ...(input.requestedById ? { requestedBy: { connect: { id: input.requestedById } } } : {}),
        ...(input.currentAssigneeUserId ? { currentAssignee: { connect: { id: input.currentAssigneeUserId } } } : {}),
        ...(input.responsibleId ? { responsible: { connect: { id: input.responsibleId } } } : {}),
        ...(input.scheduleId ? { schedule: { connect: { id: input.scheduleId } } } : {}),
        ...(input.vendorId ? { vendor: { connect: { id: input.vendorId } } } : {}),
        ...(input.serviceMode ? { serviceMode: input.serviceMode } : {}),
        ...(input.estPartsCost != null ? { estPartsCost: input.estPartsCost } : {}),
        ...(input.estLabourCost != null ? { estLabourCost: input.estLabourCost } : {}),
      },
      tx
    );
    await logStatus(tx, created.id, null, 'PENDING', 'Created', input.requestedById ?? null);
    await documentService.mirrorWorkOrderFile(tx, { workOrderId: created.id, field: 'documentUrl', url: input.documentUrl, actorId: input.requestedById ?? null });
    return created;
  },

  /**
   * Creates a work order directly (no plan needed). This is what the merged Maintenance + Repair screens use for
   * scheduled tasks, repairs and breakdowns. A hired (RENTED) machine is not maintenance-tracked, so the only work
   * it can have is a breakdown.
   */
  async create(ctx: UserAuthContext, body: CreateWorkOrderBody) {
    const machine = await prisma.machine.findUnique({ where: { id: body.machineId } });
    if (!machine || !canSeeFirm(ctx, machine.firmId)) throw ApiError.notFound('Machine not found');
    const firmId = machine.firmId ?? body.firmId ?? null;
    if (firmId === null) throw ApiError.badRequest('This machine has no firm: give a firmId');
    assertFirmWritable(ctx, firmId);

    if (machine.ownershipType === 'RENTED' && body.type !== 'BREAKDOWN') {
      throw ApiError.badRequest('A hired machine is not maintenance-tracked: only breakdown work can be raised for it');
    }
    // Assigned To defaults to the machine's default mechanic; Responsible to the active assignment's responsible person, else the
    // machine's default responsible person, else nobody (an admin then approves). All editable, none required.
    const assigneeId = body.assigneeId ?? machine.defaultMechanicId ?? null;
    let responsibleId = body.responsibleId ?? null;
    if (responsibleId === null) {
      const a = await prisma.machineAssignment.findFirst({ where: { machineId: machine.id, endedAt: null }, select: { responsibleUserId: true } });
      responsibleId = a?.responsibleUserId ?? machine.defaultResponsibleId ?? null;
    }
    for (const [label, uid] of [['assignee', assigneeId], ['responsible person', responsibleId]] as const) {
      if (uid === null) continue;
      const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true } });
      if (!u) throw ApiError.badRequest(`Unknown ${label}`);
    }
    if (body.vendorId) {
      const v = await prisma.repairVendor.findUnique({ where: { id: body.vendorId }, select: { id: true } });
      if (!v) throw ApiError.badRequest('Unknown vendor');
    }
    if (body.machinePartId) {
      const part = await prisma.machinePart.findFirst({ where: { id: body.machinePartId, machineId: machine.id }, select: { id: true } });
      if (!part) throw ApiError.badRequest('That part does not belong to this machine');
    }
    if (body.activityTypeId) {
      const at = await prisma.activityType.findUnique({ where: { id: body.activityTypeId }, select: { id: true } });
      if (!at) throw ApiError.badRequest('Unknown activity type');
    }

    return prisma.$transaction(async (tx) => {
      let breakdownReportId = body.breakdownReportId ?? null;
      if (body.type === 'BREAKDOWN' && !breakdownReportId) {
        const breakdownNumber = await documentSequenceService.next({ prefix: 'BD', year: new Date().getFullYear(), pad: 3 }, tx);
        let failureType = body.failureType?.trim() || 'Mechanical';
        if (!body.failureType && body.activityTypeId) {
          const at = await tx.activityType.findUnique({ where: { id: body.activityTypeId }, select: { name: true } });
          if (at?.name) failureType = at.name;
        }
        const breakdown = await tx.breakdownReport.create({
          data: {
            breakdownNumber,
            machine: { connect: { id: machine.id } },
            firm: firmId ? { connect: { id: firmId } } : undefined,
            failureType,
            description: body.description?.trim() || body.title?.trim() || 'Breakdown reported via work order',
            severity: body.priority ?? 'MEDIUM',
            status: 'OPEN',
            reportedAt: body.failureTime ? new Date(body.failureTime) : new Date(),
            estimatedDowntimeHours: body.estimatedDowntimeHours != null ? body.estimatedDowntimeHours : null,
            rootCause: body.rootCause?.trim() || null,
            remarks: body.remarks?.trim() || null,
            ...(ctx.userId ? { reportedBy: { connect: { id: ctx.userId } } } : {}),
            ...(assigneeId ? { assignedTo: { connect: { id: assigneeId } } } : {}),
          },
        });
        breakdownReportId = breakdown.id;
        await tx.machine.update({ where: { id: machine.id }, data: { status: 'BREAKDOWN', statusChangedAt: new Date() } });
        if (machine.assetId) {
          await tx.asset.update({ where: { id: machine.assetId }, data: { status: 'UNDER_REPAIR' } });
        }
      }

      const row = await this.createInternal(tx, {
        machineId: machine.id,
        firmId,
        breakdownReportId,
        type: body.type,
        actualDueDate: body.dueAt,
        priority: body.priority ?? 'MEDIUM',
        currentAssigneeUserId: assigneeId,
        responsibleId,
        scheduleId: body.scheduleId ?? null,
        serviceMode: body.serviceMode ?? (body.vendorId ? 'VENDOR' : 'IN_HOUSE'),
        vendorId: body.vendorId ?? null,
        estPartsCost: body.estPartsCost ?? null,
        estLabourCost: body.estLabourCost ?? null,
        machinePartId: body.machinePartId ?? null,
        title: body.title,
        description: body.description ?? null,
        activityTypeId: body.activityTypeId ?? null,
        documentUrl: body.documentUrl ?? null,
        requestedById: ctx.userId,
      });
      return workOrderMapper.toDTO(row);
    });
  },

  /**
   * Reassign (the old "transfer"): a reason is required, the new assignee must exist, only open work can be reassigned, and the
   * change is written to the status log as well as the transfer row. Who may do it is decided by the caller (workOrderGuard).
   */
  async transfer(id: string, body: { toUserId: string; type: 'OCCURRENCE_TRANSFER' | 'PERMANENT_TRANSFER' | 'TEMPORARY_COVER'; reason?: string; newDueDate?: string }, fromUserId: bigint | null) {
    const wo = await this.assertExists(id);
    const toUserId = parseBigIntId(body.toUserId, 'toUserId');
    if (!body.reason || body.reason.trim().length < 3) throw ApiError.badRequest('Give a reason for reassigning (at least 3 characters)');
    if (!isOpenStatus(wo.status)) throw ApiError.conflict('This work order is already closed and cannot be reassigned');
    if (wo.currentAssigneeUserId === toUserId) throw ApiError.badRequest('This work order is already assigned to that person');
    const target = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true, user_name: true } });
    if (!target) throw ApiError.badRequest('Unknown user to reassign to');

    return prisma.$transaction(async (tx) => {
      await tx.workOrderTransfer.create({
        data: { workOrderId: id, fromUserId, toUserId, type: body.type, status: 'APPROVED', reason: body.reason!.trim() },
      });

      const data: Prisma.MaintenanceWorkOrderUpdateInput = {
        currentAssignee: { connect: { id: toUserId } },
        ...(body.newDueDate ? { actualDueDate: new Date(body.newDueDate), wasShifted: true } : {}),
      };
      const updated = await workOrderRepository.update(id, data, tx);

      if (body.type === 'PERMANENT_TRANSFER' && wo.planId) {
        await tx.maintenancePlan.update({ where: { id: wo.planId }, data: { assignedToUserId: toUserId } });
      }
      await logStatus(tx, id, wo.status, wo.status, `Reassigned to ${target.name || target.user_name || 'user'}: ${body.reason!.trim()}`, fromUserId);

      return workOrderMapper.toDTO(updated);
    });
  },

  async markDone(id: string, body: { completionNote?: string; actualMinutesTaken?: number; partsUsed?: string[]; documentUrl?: string; readingAtService?: number | null; actualPartsCost?: number | null; actualLabourCost?: number | null }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      await workOrderPartsService.assertPartsIssued(tx, wo); // an in-house repair that needs parts cannot be completed before they are issued
      if (wo.type === 'SCHEDULED' && wo.checklistItems && wo.checklistItems.length > 0) {
        const pending = wo.checklistItems.filter((i) => i.state === 'PENDING' || (!i.state && !i.done));
        if (pending.length > 0) {
          throw ApiError.badRequest(
            `Cannot mark as done: ${pending.length} checklist item${pending.length > 1 ? 's are' : ' is'} still pending. Please complete all checklist items first.`
          );
        }
      }
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
          ...(body.readingAtService != null ? { readingAtService: body.readingAtService } : {}),
          ...(body.actualPartsCost != null ? { actualPartsCost: body.actualPartsCost } : {}),
          ...(body.actualLabourCost != null ? { actualLabourCost: body.actualLabourCost } : {}),
          ...(body.documentUrl ? { documentUrl: body.documentUrl } : {}),
        },
        tx
      );
      await documentService.mirrorWorkOrderFile(tx, { workOrderId: id, field: 'documentUrl', url: body.documentUrl, actorId: userId });
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
      await workOrderPartsService.cancelUnissued(tx, id, 'Work order cancelled: ' + body.reason);
      await logStatus(tx, id, wo.status, 'CANCELLED', body.reason, userId);
      return workOrderMapper.toDTO(updated);
    });
  },

  async skip(id: string, body: { skipReason: string }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    return prisma.$transaction(async (tx) => {
      const updated = await workOrderRepository.update(id, { status: 'SKIPPED', skipReason: body.skipReason }, tx);
      await workOrderPartsService.cancelUnissued(tx, id, 'Work order skipped: ' + body.skipReason);
      await logStatus(tx, id, wo.status, 'SKIPPED', body.skipReason, userId);
      return workOrderMapper.toDTO(updated);
    });
  },

  async approve(id: string, body: { reviewNote?: string }, userId: bigint | null) {
    const wo = await this.assertExists(id);
    const pending = wo.approvalRequests?.[0];
    if (!pending || pending.status !== 'PENDING') throw ApiError.badRequest('No pending approval request for this work order');

    return prisma.$transaction(async (tx) => {
      await workOrderPartsService.assertPartsIssued(tx, wo); // parts may have been un-issued after "mark done"
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

      // actual parts + labour become the work order's cost (the one number the cost provider reads); a vendor bill that already
      // set `cost` wins
      const resolvedParts = wo.actualPartsCost ?? wo.estPartsCost ?? null;
      const resolvedLabour = wo.actualLabourCost ?? wo.estLabourCost ?? null;
      let finalCost: number | null = wo.cost === null || wo.cost === undefined ? null : Number(wo.cost);
      if (finalCost === null && (resolvedParts !== null || resolvedLabour !== null)) {
        finalCost = Number(resolvedParts ?? 0) + Number(resolvedLabour ?? 0);
      }
      await tx.maintenanceWorkOrder.update({
        where: { id },
        data: {
          cost: finalCost,
          ...(wo.actualPartsCost === null && resolvedParts !== null ? { actualPartsCost: resolvedParts } : {}),
          ...(wo.actualLabourCost === null && resolvedLabour !== null ? { actualLabourCost: resolvedLabour } : {}),
        },
      });
      // Approving a service work order moves the schedule's "last service" forward, using the reading recorded on the order (fallback:
      // the machine's current reading). Approving twice is rejected above (no pending request), so this runs once.
      if (wo.scheduleId) {
        const machine = await tx.machine.findUnique({ where: { id: wo.machineId }, select: { id: true, openingReading: true, readingUnit: true } });
        const reading = wo.readingAtService !== null ? Number(wo.readingAtService) : machine ? await currentReadingFor(tx, machine) : null;
        await tx.machineServiceSchedule.update({
          where: { id: wo.scheduleId },
          data: { lastServiceAt: new Date(toIstDateString(wo.completedAt ?? new Date())), ...(reading !== null ? { lastServiceReading: reading } : {}) },
        });
      }

      if (wo.type === 'REPAIR' || wo.type === 'BREAKDOWN') {
        // Approving a repair that is still out at a vendor must not bring the machine back: that happens when it is
        // received. Anything else is rolled up here, once.
        if (!isAtVendor(wo.outsourceStatus)) {
          const parts = await tx.workOrderRepairPart.findMany({ where: { workOrderId: id } });
          await applyRepairRollupOnce(tx, wo, finalCost ?? 0, parts.length > 0 || wo.materialRequired === true);
        }
      } else {
        await applyMaintenanceRollupOnce(tx, wo);
      }

      // A breakdown work order that is approved closes its breakdown report (it used to stay OPEN for ever, because
      // nothing in the UI calls the resolve endpoint).
      if (wo.breakdownReportId && !isAtVendor(wo.outsourceStatus)) {
        await tx.breakdownReport.updateMany({
          where: { id: wo.breakdownReportId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
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

  async approvalHistory(query: Record<string, any>, auth?: UserAuthContext | bigint | null) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.MaintenanceWorkOrderWhereInput = {
      AND: [{ approvalRequests: { some: { ...(query.status ? { status: query.status } : {}) } } }, ...buildWorkOrderScope(query, normalizeAuthContext(auth))],
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
      // Phases 5 / 6: the in-house "Material required?" answer and the parts the repair needs (Store items)
      materialRequired?: boolean;
      partsNeeded?: PartInput[];
    },
    userId: bigint | null,
    ctx?: UserAuthContext
  ) {
    const wo = await this.assertExists(id);
    const nextStatus: WorkOrderStatus = body.status === 'completed' ? 'COMPLETED' : body.status === 'cancelled' ? 'CANCELLED' : 'IN_PROGRESS';
    const outsourced = body.typeOfWork === 'out_source' || body.typeOfWork === 'outhouse';
    const firstOutsource = outsourced && !wo.outsourceStatus;
    if (body.typeOfWork === 'in_house' && (wo.outsourceStatus === 'SENT' || wo.outsourceStatus === 'RECEIVED' || wo.outsourceStatus === 'PAID')) {
      throw ApiError.conflict('This job has already been sent to a vendor, so it cannot be switched back to in-house');
    }

    if (body.materialRequired !== undefined && !ctx) throw ApiError.internal('processRepair needs the caller to change the parts list');
    if (body.materialRequired === true && outsourced) throw ApiError.badRequest('An outsourced repair has no Store parts: the vendor supplies the material');

    return prisma.$transaction(async (tx) => {
      if (outsourced && wo.materialRequired === true) {
        const issued = await tx.workOrderPartIssue.count({ where: { workOrderId: id, voidedAt: null } });
        if (issued > 0) throw ApiError.conflict('Parts have already been issued from the Store for this repair, so it cannot be outsourced');
        await workOrderPartsService.setMaterial(tx, ctx ?? ({} as UserAuthContext), id, false, undefined, userId);
      }
      if (body.materialRequired !== undefined && !outsourced) {
        await workOrderPartsService.setMaterial(tx, ctx!, id, body.materialRequired, body.partsNeeded, userId);
      } else if (body.partsNeeded?.length && !outsourced) {
        throw ApiError.badRequest('Say whether material is required before listing parts');
      }
      const material = outsourced ? false : body.materialRequired ?? wo.materialRequired;
      if (nextStatus === 'COMPLETED' && !outsourced) {
        await workOrderPartsService.assertPartsIssued(tx, { ...wo, materialRequired: material, typeOfWork: body.typeOfWork ?? wo.typeOfWork });
      }

      // If completing an in-house repair requiring material, parts used cannot exceed parts issued from Store
      if (nextStatus === 'COMPLETED' && !outsourced && material === true && Array.isArray(body.parts) && body.parts.length > 0) {
        const partsSummary = await workOrderPartsService.summaryOf(tx, id);
        for (const p of body.parts) {
          const cleanName = (p.partName || '').trim().toLowerCase();
          const matchedLine = partsSummary.lines.find(
            (l) =>
              (l.itemName && l.itemName.trim().toLowerCase() === cleanName) ||
              ((p as any).machinePartId && (p as any).machinePartId === l.itemId)
          );
          if (matchedLine && Number(p.quantity ?? 1) > matchedLine.issued) {
            throw ApiError.badRequest(
              `Quantity used for "${p.partName}" (${p.quantity}) cannot exceed the quantity issued from the Store (${matchedLine.issued})`
            );
          }
        }
      }

      const vendorId = outsourced ? await resolveVendorId(tx, body.vendorName || body.parts?.find((p) => p.vendorName)?.vendorName) : null;

      if (Array.isArray(body.parts) && body.parts.length > 0) {
        await tx.workOrderRepairPart.deleteMany({ where: { workOrderId: id } });
        const machineParts = await tx.machinePart.findMany({
          where: { machineId: wo.machineId },
          select: { id: true, name: true },
        });
        const partMap = new Map(machineParts.map((mp) => [mp.name.trim().toLowerCase(), mp.id]));

        await tx.workOrderRepairPart.createMany({
          data: body.parts.map((p) => {
            const matchedPartId = (p as any).machinePartId ?? (p.partName ? partMap.get(p.partName.trim().toLowerCase()) : null) ?? null;
            return {
              workOrderId: id,
              partName: p.partName,
              quantity: p.quantity ?? 1,
              vendorName: p.vendorName ?? null,
              machinePartId: matchedPartId,
              warrantyFromDate: p.warrantyFromDate ? new Date(p.warrantyFromDate) : null,
              warrantyToDate: p.warrantyToDate ? new Date(p.warrantyToDate) : null,
            };
          }),
        });

        const firstMatchedPartId = body.parts
          .map((p) => (p as any).machinePartId ?? (p.partName ? partMap.get(p.partName.trim().toLowerCase()) : null))
          .find(Boolean);
        if (!wo.machinePartId && firstMatchedPartId) {
          await tx.maintenanceWorkOrder.update({
            where: { id },
            data: { machinePartId: firstMatchedPartId },
          });
        }
      }

      const updated = await workOrderRepository.update(
        id,
        {
          status: nextStatus,
          completionNote: body.workDone ?? body.remarks ?? wo.completionNote,
          ...(body.typeOfWork !== undefined ? { typeOfWork: body.typeOfWork } : {}),
          // the simplified out-source track starts here (To send -> Sent -> Received -> Paid)
          ...(firstOutsource ? { outsourceStatus: 'TO_SEND' as const } : {}),
          ...(outsourced && vendorId ? { vendor: { connect: { id: vendorId } } } : {}),
          ...(body.billAmount !== undefined ? { cost: body.billAmount } : {}),
          ...(body.billAmount === undefined && nextStatus === 'COMPLETED' && !outsourced && material === true && (wo.cost === null || wo.cost === undefined) && (wo.actualPartsCost !== null || wo.actualLabourCost !== null)
            ? { cost: Number(wo.actualPartsCost ?? 0) + Number(wo.actualLabourCost ?? 0) }
            : {}),
          ...(body.photoUrl !== undefined ? { photoUrl: body.photoUrl } : {}),
          ...(body.billUrl !== undefined ? { billUrl: body.billUrl } : {}),
          ...(nextStatus === 'COMPLETED' ? { completedAt: new Date(), completedBy: wo.currentAssigneeUserId ? { connect: { id: wo.currentAssigneeUserId } } : undefined } : {}),
        },
        tx
      );
      await logStatus(tx, id, wo.status, nextStatus, body.workDone ?? body.remarks ?? null, userId);
      await documentService.mirrorWorkOrderFile(tx, { workOrderId: id, field: 'photoUrl', url: body.photoUrl, actorId: userId });
      await documentService.mirrorWorkOrderFile(tx, { workOrderId: id, field: 'billUrl', url: body.billUrl, actorId: userId });

      if (outsourced) {
        // The machine leaves for the vendor: it is down and the asset is under repair until it comes back.
        if (firstOutsource) {
          const machine = await tx.machine.update({ where: { id: wo.machineId }, data: { status: 'UNDER_MAINTENANCE', statusChangedAt: new Date() } });
          if (machine.assetId) await tx.asset.update({ where: { id: machine.assetId }, data: { status: 'UNDER_REPAIR' } });
        }
        // The old Sent Machines / Store In / Payment screens are gone, so this is off by default (opt in with
        // FLEET_LEGACY_INDENT_SYNC=true to keep filling the deprecated indent tables).
        if (legacyIndentSyncEnabled()) await syncOuthouseIndent(tx, wo, body, vendorId);
      } else if (body.typeOfWork === 'in_house' && legacyIndentSyncEnabled()) {
        // If switched back to In-House, mark any existing linked indent as INHOUSE
        const existingIndent = await tx.repairIndent.findFirst({ where: { workOrderId: id } });
        if (existingIndent) {
          await tx.repairIndent.update({
            where: { id: existingIndent.id },
            data: { routingType: 'INHOUSE' },
          });
        }
      }

      // In-house work is rolled up as soon as it is completed. An out-source job is NOT: the machine is still at the
      // vendor, so it is rolled up when it is received (outsource.service). That was the double-count.
      if (nextStatus === 'COMPLETED' && !outsourced && !wo.outsourceStatus) {
        const rolled = body.billAmount ?? (updated.cost === null || updated.cost === undefined ? 0 : Number(updated.cost));
        await applyRepairRollupOnce(tx, wo, rolled, (body.parts?.length ?? 0) > 0 || material === true);
      }
      // The bill was corrected after this job had already been rolled up onto the asset (or it was rolled up with no bill
      // yet): move the asset total by the difference instead of letting it drift from the work-order cost.
      if (wo.rollupAppliedAt && body.billAmount !== undefined && (wo.type === 'REPAIR' || wo.type === 'BREAKDOWN')) {
        await adjustRolledUpCost(tx, wo.machineId, wo.cost === null || wo.cost === undefined ? 0 : Number(wo.cost), body.billAmount);
      }

      return workOrderMapper.toDTO(updated);
    });
  },
};

/** Finds a vendor by name (case-insensitive) or creates it. Null when no name was given. */
export async function resolveVendorId(tx: Tx, rawName: string | null | undefined): Promise<string | null> {
  const name = rawName?.trim();
  if (!name) return null;
  const existing = await tx.repairVendor.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
  if (existing) return existing.id;
  return (await tx.repairVendor.create({ data: { name, type: 'Repair' } })).id;
}

/**
 * The old Sent Machines / Store In / Payment screens still read the RepairIndent tables. Until they are retired the
 * out-source job is also queued there. Off by default now that those screens are gone; FLEET_LEGACY_INDENT_SYNC=true turns it back on.
 */
export function legacyIndentSyncEnabled(): boolean {
  return process.env.FLEET_LEGACY_INDENT_SYNC === 'true';
}

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
    title?: string | null;
    currentAssigneeUserId?: bigint | null;
  },
  body: {
    billAmount?: number;
    remarks?: string;
    workDone?: string;
  },
  vendorId: string | null,
) {
  const machine = await tx.machine.findUnique({
    where: { id: wo.machineId },
    select: { assetId: true, departmentId: true, name: true, serialNumber: true },
  });

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
    // One numbering path for every indent (was a per-firm counter here and the global one in the repair module,
    // which could mint the same REP-YYYY-NNN twice).
    const indentNumber = await nextIndentNumber(tx);

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
        problem: wo.title || wo.plan?.title || (wo.workOrderCode ? `Task ${wo.workOrderCode}` : 'Outsourced Machine Repair'),
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
  // (the machine -> UNDER_MAINTENANCE / asset -> UNDER_REPAIR flip now happens in processRepair itself)
}

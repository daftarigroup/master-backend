// Assignment Status: where each machine is working (its project), who operates it, who is responsible, and the 14-day availability
// timeline. Statuses come from the ONE derive function (cost/utilization.ts deriveStatus), so the tiles, the lists and the timeline
// cannot disagree. Changing who a machine works for is an admin action; reading is for everyone who can see the machine.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable } from '../../../utils/firmScope';
import { isAdminRole } from '../../../middleware/requireCostAccess';
import { DerivedStatus, isInFleet } from '../cost/utilization';
import { AssignmentWindow, DateWindow, MachineDayFacts, availabilityRow } from '../lib/availability';
import { toIstDateString } from '../lib/istDate';
import { activeOperatorWhere, machineAccessWhere } from '../lib/machineAccess';
import { loadOpsSettings } from '../lib/opsSettings';
import { loadMachineInScope, pageOf, requireUserId } from './common';
import { statusesFor } from './machineStatus';

const userName = (u: { name: string | null; user_name: string | null } | null | undefined) => (u ? u.name || u.user_name || null : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function requireAdmin(ctx: UserAuthContext) {
  if (!isAdminRole(ctx.role)) throw ApiError.forbidden('Only an admin can change assignments');
}

const MACHINE_INCLUDE = {
  asset: { select: { status: true } },
  assignments: { where: { endedAt: null }, take: 1, include: { firm: { select: { id: true, firm_name: true } }, siteLocation: { select: { id: true, location: true } }, responsible: { select: { id: true, name: true, user_name: true } } } },
  operatorAssignments: { where: activeOperatorWhere(), include: { user: { select: { id: true, name: true, user_name: true } } }, orderBy: { validFrom: 'desc' as const } },
} satisfies Prisma.MachineInclude;

type MachineRow = Prisma.MachineGetPayload<{ include: typeof MACHINE_INCLUDE }>;

export interface AssignmentListQuery {
  firmId?: unknown;
  status?: DerivedStatus;
  q?: string;
  siteId?: bigint;
  overdue?: boolean;
  assignedOnly?: boolean;
  limit?: number;
  offset?: number;
}

function mapRow(m: MachineRow, status: DerivedStatus, today: string) {
  const a = m.assignments[0] ?? null;
  const ret = a?.expectedReturnAt ? day(a.expectedReturnAt) : null;
  const op = m.operatorAssignments[0] ?? null;
  const allOps = m.operatorAssignments.map((o) => ({
    assignmentId: o.id,
    id: String(o.user.id),
    name: userName(o.user),
    shift: o.shift,
    validTill: day(o.validTill),
    expiringSoon: o.validTill !== null && day(o.validTill)! <= addDays(today, 7),
  }));
  const opNames = allOps.map((o) => o.name).filter(Boolean).join(', ');
  return {
    machine: { id: m.id, name: m.name, assetCode: m.assetCode, category: m.equipmentType, imageUrl: m.imageUrl, ownershipType: m.ownershipType, readingUnit: m.readingUnit },
    status,
    assignment: a
      ? {
          id: a.id,
          firm: { id: String(a.firm.id), name: a.firm.firm_name },
          site: a.siteLocation ? { id: String(a.siteLocation.id), name: a.siteLocation.location } : null,
          since: a.startedAt.toISOString(),
          expectedReturnAt: ret,
          // past the expected return and still assigned; for a hired machine this is extra rent
          returnOverdue: ret !== null && ret < today,
          responsible: a.responsible ? { id: String(a.responsible.id), name: userName(a.responsible) } : null,
          note: a.note,
        }
      : null,
    operator: op
      ? {
          assignmentId: op.id,
          id: String(op.user.id),
          name: opNames || userName(op.user),
          shift: op.shift,
          validTill: day(op.validTill),
          expiringSoon: op.validTill !== null && day(op.validTill)! <= addDays(today, 7),
        }
      : null,
    operators: allOps,
  };
}

export const assignmentService = {
  /** Rows + tiles. The tiles ignore the status filter (so a tile count always equals the list you get by tapping it) and sum to the total. */
  async list(ctx: UserAuthContext, q: AssignmentListQuery) {
    const today = toIstDateString(new Date());
    const search = q.q?.trim();
    const machines = await prisma.machine.findMany({
      where: {
        isActive: true,
        AND: [
          await machineAccessWhere(ctx, q.firmId),
          ...(q.siteId ? [{ OR: [{ siteLocationId: q.siteId }, { assignments: { some: { endedAt: null, siteLocationId: q.siteId } } }] }] : []),
          ...(search
            ? [{ OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { assetCode: { contains: search, mode: 'insensitive' as const } }, { registrationNo: { contains: search, mode: 'insensitive' as const } }, { assignments: { some: { endedAt: null, siteLocation: { location: { contains: search, mode: 'insensitive' as const } } } } }, { assignments: { some: { endedAt: null, firm: { firm_name: { contains: search, mode: 'insensitive' as const } } } } }] }]
            : []),
        ],
      },
      include: MACHINE_INCLUDE,
      orderBy: { name: 'asc' },
      take: 1000,
    });
    const live = machines.filter((m) => isInFleet({ rentalEndDate: m.rentalEndAt ? toIstDateString(m.rentalEndAt) : null }, m.status, m.asset?.status ?? null, today));
    const { status: statusOf } = await statusesFor(live, today);
    const rows = live.map((m) => mapRow(m, statusOf.get(m.id)!, today));

    const count = (s: DerivedStatus) => rows.filter((r) => r.status === s).length;
    const stats = {
      total: rows.length,
      inUse: count('IN_USE'),
      available: count('AVAILABLE'),
      maintenance: count('UNDER_MAINT'),
      idle: count('IDLE'),
      inTransit: count('IN_TRANSIT'),
      // machines with an active assignment, whatever their derived status (a machine in Maintenance can still be assigned)
      assigned: rows.filter((r) => r.assignment !== null).length,
      returnOverdue: rows.filter((r) => r.assignment?.returnOverdue).length,
    };

    let filtered = q.status ? rows.filter((r) => r.status === q.status) : rows;
    if (q.assignedOnly) filtered = filtered.filter((r) => r.assignment !== null);
    if (q.overdue) filtered = filtered.filter((r) => r.assignment?.returnOverdue);
    const { take, skip } = pageOf({ limit: q.limit ?? 100, offset: q.offset });
    return { today, stats, total: filtered.length, rows: filtered.slice(skip, skip + take) };
  },

  /** Put a machine to work for a project (firm + optional site). Ends its current assignment. A hired machine defaults to its hire end. */
  async assign(ctx: UserAuthContext, body: { machineId: string; firmId: bigint; siteLocationId?: bigint | null; expectedReturnAt?: string | null; responsibleUserId?: bigint | null; note?: string | null }) {
    requireAdmin(ctx);
    const userId = requireUserId(ctx);
    const machine = await loadMachineInScope(prisma, ctx, body.machineId);
    assertFirmWritable(ctx, body.firmId);
    const firm = await prisma.firm.findUnique({ where: { id: body.firmId }, select: { id: true } });
    if (!firm) throw ApiError.badRequest('Unknown firm');
    if (body.siteLocationId) {
      const site = await prisma.siteLocationDetails.findFirst({ where: { id: body.siteLocationId, firm_id: body.firmId }, select: { id: true } });
      if (!site) throw ApiError.badRequest('That site does not belong to this firm');
    }
    if (body.responsibleUserId) {
      const u = await prisma.user.findUnique({ where: { id: body.responsibleUserId }, select: { id: true } });
      if (!u) throw ApiError.badRequest('Unknown responsible person');
    }
    const open = await prisma.machineTransfer.findFirst({ where: { machineId: machine.id, status: { in: ['REQUESTED', 'APPROVED', 'IN_TRANSIT'] } }, select: { transferNumber: true } });
    if (open) throw ApiError.conflict(`${machine.name} has an open transfer (${open.transferNumber}). Finish or cancel it first.`);

    const expected = body.expectedReturnAt ?? (machine.ownershipType === 'RENTED' && machine.rentalEndAt ? day(machine.rentalEndAt) : null);
    return prisma.$transaction(async (tx) => {
      await tx.machineAssignment.updateMany({ where: { machineId: machine.id, endedAt: null }, data: { endedAt: new Date(), endReason: 'REASSIGNED' } });
      const created = await tx.machineAssignment.create({
        data: {
          machineId: machine.id,
          firmId: body.firmId,
          siteLocationId: body.siteLocationId ?? null,
          expectedReturnAt: expected ? new Date(expected) : null,
          responsibleUserId: body.responsibleUserId ?? machine.defaultResponsibleId ?? null,
          note: body.note?.trim() || null,
          createdById: userId,
        },
      });
      // the machine's working site follows its assignment
      await tx.machine.update({ where: { id: machine.id }, data: { siteLocationId: body.siteLocationId ?? null } });
      return { id: created.id };
    });
  },

  async update(ctx: UserAuthContext, id: string, body: { expectedReturnAt?: string | null; responsibleUserId?: bigint | null; note?: string | null; siteLocationId?: bigint | null }) {
    requireAdmin(ctx);
    const a = await prisma.machineAssignment.findFirst({ where: { id, endedAt: null, machine: await machineAccessWhere(ctx) } });
    if (!a) throw ApiError.notFound('Assignment not found');
    assertFirmWritable(ctx, a.firmId);
    if (body.siteLocationId) {
      const site = await prisma.siteLocationDetails.findFirst({ where: { id: body.siteLocationId, firm_id: a.firmId }, select: { id: true } });
      if (!site) throw ApiError.badRequest('That site does not belong to this firm');
    }
    await prisma.machineAssignment.update({
      where: { id },
      data: {
        ...(body.expectedReturnAt !== undefined ? { expectedReturnAt: body.expectedReturnAt ? new Date(body.expectedReturnAt) : null } : {}),
        ...(body.responsibleUserId !== undefined ? { responsibleUserId: body.responsibleUserId } : {}),
        ...(body.note !== undefined ? { note: body.note?.trim() || null } : {}),
        ...(body.siteLocationId !== undefined ? { siteLocationId: body.siteLocationId } : {}),
      },
    });
    return { id };
  },

  /** The machine stops working for this project. Releasing a hired machine sets the hire end, so rental proration stops with it. */
  async release(ctx: UserAuthContext, id: string, body: { reason?: string | null; returnedToVendor?: boolean }) {
    requireAdmin(ctx);
    requireUserId(ctx);
    const a = await prisma.machineAssignment.findFirst({ where: { id, endedAt: null, machine: await machineAccessWhere(ctx) }, include: { machine: true } });
    if (!a) throw ApiError.notFound('Assignment not found');
    assertFirmWritable(ctx, a.firmId);
    const open = await prisma.machineTransfer.findFirst({ where: { machineId: a.machineId, status: { in: ['REQUESTED', 'APPROVED', 'IN_TRANSIT'] } }, select: { transferNumber: true } });
    if (open) throw ApiError.conflict(`${a.machine.name} has an open transfer (${open.transferNumber}). Finish or cancel it first.`);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.machineAssignment.update({ where: { id }, data: { endedAt: now, endReason: a.machine.ownershipType === 'RENTED' && body.returnedToVendor !== false ? 'RETURNED_TO_VENDOR' : 'RELEASED', note: body.reason?.trim() || a.note } });
      if (a.machine.ownershipType === 'RENTED' && body.returnedToVendor !== false && (a.machine.rentalEndAt === null || a.machine.rentalEndAt > now)) {
        await tx.machine.update({ where: { id: a.machineId }, data: { rentalEndAt: now } });
      }
    });
    return { id, released: true };
  },

  // ---- operators -------------------------------------------------------------------------------------------------------------
  async listOperators(ctx: UserAuthContext, q: { machineId?: string; userId?: bigint; expiringInDays?: number }) {
    const today = toIstDateString(new Date());
    const rows = await prisma.machineOperatorAssignment.findMany({
      where: {
        machine: await machineAccessWhere(ctx),
        ...activeOperatorWhere(today),
        ...(q.machineId ? { machineId: q.machineId } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
      },
      include: { machine: { select: { id: true, name: true, assetCode: true } }, user: { select: { id: true, name: true, user_name: true, employee: { select: { emp_code: true, designation: true } } } } },
      orderBy: [{ validTill: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows
      .map((r) => ({
        id: r.id,
        machine: r.machine,
        operator: { id: String(r.user.id), name: userName(r.user), code: r.user.employee?.emp_code ?? null, designation: r.user.employee?.designation ?? null },
        shift: r.shift,
        validFrom: day(r.validFrom),
        validTill: day(r.validTill),
        expiringSoon: r.validTill !== null && day(r.validTill)! <= addDays(today, q.expiringInDays ?? 7),
      }))
      .filter((r) => q.expiringInDays === undefined || r.expiringSoon);
  },

  /** Assign operator(s) to a machine. Supports multiple active operators simultaneously. */
  async assignOperator(ctx: UserAuthContext, body: { machineId: string; userId?: bigint; userIds?: bigint[]; shift?: 'DAY' | 'NIGHT' | 'GENERAL' | null; validFrom?: string; validTill?: string | null }) {
    requireAdmin(ctx);
    const actor = requireUserId(ctx);
    const machine = await loadMachineInScope(prisma, ctx, body.machineId);
    const targetUserIds: bigint[] = body.userIds && body.userIds.length > 0
      ? body.userIds
      : body.userId ? [body.userId] : [];

    if (targetUserIds.length === 0) throw ApiError.badRequest('At least one operator must be selected');

    const users = await prisma.user.findMany({
      where: { id: { in: targetUserIds } },
      select: { id: true },
    });
    if (users.length !== targetUserIds.length) throw ApiError.badRequest('One or more selected operators do not exist');

    if (body.validFrom && body.validTill && body.validTill < body.validFrom) throw ApiError.badRequest('Valid-till is before valid-from');

    const now = new Date();
    const fromDate = new Date(body.validFrom ?? toIstDateString(now));
    const tillDate = body.validTill ? new Date(body.validTill) : null;

    return prisma.$transaction(async (tx) => {
      const activeAssignments = await tx.machineOperatorAssignment.findMany({
        where: { machineId: machine.id, endedAt: null },
      });

      const activeUserIds = new Set(activeAssignments.map((a) => a.userId.toString()));
      const desiredUserIds = new Set(targetUserIds.map((id) => id.toString()));

      // End assignments for any operator not in the selected list
      const assignmentsToEnd = activeAssignments.filter((a) => !desiredUserIds.has(a.userId.toString()));
      if (assignmentsToEnd.length > 0) {
        await tx.machineOperatorAssignment.updateMany({
          where: { id: { in: assignmentsToEnd.map((a) => a.id) } },
          data: { endedAt: now },
        });
      }

      // Update dates for operators who remain assigned
      const assignmentsToKeep = activeAssignments.filter((a) => desiredUserIds.has(a.userId.toString()));
      if (assignmentsToKeep.length > 0) {
        await tx.machineOperatorAssignment.updateMany({
          where: { id: { in: assignmentsToKeep.map((a) => a.id) } },
          data: { validFrom: fromDate, validTill: tillDate },
        });
      }

      // Create new assignments for operators who aren't active yet
      const usersToCreate = targetUserIds.filter((id) => !activeUserIds.has(id.toString()));
      let lastId = '';
      for (const uId of usersToCreate) {
        const row = await tx.machineOperatorAssignment.create({
          data: {
            machineId: machine.id,
            userId: uId,
            shift: body.shift ?? null,
            validFrom: fromDate,
            validTill: tillDate,
            createdById: actor,
          },
        });
        lastId = row.id;
      }

      return { id: lastId || (activeAssignments[0]?.id ?? machine.id) };
    });
  },

  async endOperator(ctx: UserAuthContext, id: string) {
    requireAdmin(ctx);
    const row = await prisma.machineOperatorAssignment.findFirst({ where: { id, endedAt: null, machine: await machineAccessWhere(ctx) } });
    if (!row) throw ApiError.notFound('Operator assignment not found');
    await prisma.machineOperatorAssignment.update({ where: { id }, data: { endedAt: new Date() } });
    return { id, ended: true };
  },

  // ---- availability timeline -------------------------------------------------------------------------------------------------
  /** Machines x days. Today and the past are actual; future days are planned (assignment until the expected return, service windows). */
  async availability(ctx: UserAuthContext, q: { firmId?: unknown; from?: string; days?: number; machineId?: string; status?: DerivedStatus }) {
    const today = toIstDateString(new Date());
    const days = Math.min(Math.max(q.days ?? 14, 1), 31);
    const from = q.from ?? today;
    const to = addDays(from, days - 1);
    const machines = await prisma.machine.findMany({
      where: { isActive: true, ...(q.machineId ? { id: q.machineId } : {}), AND: [await machineAccessWhere(ctx, q.firmId)] },
      include: { asset: { select: { status: true } } },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const live = machines.filter((m) => isInFleet({ rentalEndDate: m.rentalEndAt ? toIstDateString(m.rentalEndAt) : null }, m.status, m.asset?.status ?? null, today));
    const ids = live.map((m) => m.id);
    if (ids.length === 0) return { from, days, today, rows: [] };

    const lookBack = addDays(from, -7);
    const [assignments, usage, diesel, orders, transfers, settings] = await Promise.all([
      prisma.machineAssignment.findMany({ where: { machineId: { in: ids }, startedAt: { lte: new Date(`${to}T23:59:59Z`) }, OR: [{ endedAt: null }, { endedAt: { gte: new Date(`${from}T00:00:00Z`) } }] } }),
      prisma.machineUsageLog.findMany({ where: { machineId: { in: ids }, voidedAt: null, status: { not: 'REJECTED' }, stopReading: { not: null }, logDate: { gte: new Date(lookBack), lte: new Date(to) } }, select: { machineId: true, logDate: true } }),
      prisma.dieselLog.findMany({ where: { machineId: { in: ids }, voidedAt: null, issueDate: { gte: new Date(lookBack), lte: new Date(to) } }, select: { machineId: true, issueDate: true } }),
      prisma.maintenanceWorkOrder.findMany({
        where: { machineId: { in: ids }, OR: [{ type: { in: ['BREAKDOWN', 'REPAIR'] } }, { scheduleId: { not: null } }], AND: [{ OR: [{ completedAt: null }, { completedAt: { gte: new Date(`${from}T00:00:00Z`) } }] }, { status: { notIn: ['CANCELLED', 'SKIPPED'] } }] },
        select: { machineId: true, type: true, status: true, createdAt: true, completedAt: true, scheduledDate: true, actualDueDate: true },
      }),
      prisma.machineTransfer.findMany({ where: { machineId: { in: ids }, dispatchedAt: { not: null }, OR: [{ receivedAt: null }, { receivedAt: { gte: new Date(`${from}T00:00:00Z`) } }] }, select: { machineId: true, dispatchedAt: true, receivedAt: true, status: true } }),
      loadOpsSettings(prisma, live.map((m) => m.firmId).filter((f): f is bigint => f !== null)),
    ]);

    const rows = live.map((m) => {
      const f: MachineDayFacts = { activityDates: new Set(), assignments: [], maintenance: [], inTransit: [] };
      for (const a of assignments.filter((x) => x.machineId === m.id)) {
        const w: AssignmentWindow = { from: toIstDateString(a.startedAt), to: a.endedAt ? toIstDateString(a.endedAt) : null, expectedReturnAt: day(a.expectedReturnAt) };
        f.assignments.push(w);
      }
      for (const u of usage) if (u.machineId === m.id) f.activityDates.add(day(u.logDate)!);
      for (const d of diesel) if (d.machineId === m.id) f.activityDates.add(day(d.issueDate)!);
      for (const o of orders.filter((x) => x.machineId === m.id)) {
        // a breakdown / repair is a down window from when it was raised until it was completed; a scheduled service blocks its due day
        const w: DateWindow =
          o.type === 'BREAKDOWN' || o.type === 'REPAIR'
            ? { from: toIstDateString(o.createdAt), to: o.completedAt ? toIstDateString(o.completedAt) : null }
            : { from: toIstDateString(o.actualDueDate ?? o.scheduledDate ?? o.createdAt), to: toIstDateString(o.actualDueDate ?? o.scheduledDate ?? o.createdAt) };
        f.maintenance.push(w);
      }
      for (const t of transfers.filter((x) => x.machineId === m.id)) f.inTransit.push({ from: toIstDateString(t.dispatchedAt!), to: t.receivedAt ? toIstDateString(t.receivedAt) : null });
      const idle = m.firmId === null ? 2 : (settings.get(String(m.firmId))?.idleAfterDays ?? 2);
      return { machineId: m.id, name: m.name, assetCode: m.assetCode, cells: availabilityRow(f, from, days, today, idle) };
    });
    const filtered = q.status ? rows.filter((r) => r.cells.some((c) => c.status === q.status)) : rows;
    return { from, days, today, rows: filtered };
  },
};


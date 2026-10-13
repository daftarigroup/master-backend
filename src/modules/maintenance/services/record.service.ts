// Maintenance Records: per-machine service view (next service due, schedule, checklist, breakdown, mechanic, cost) and the fleet list
// of what is overdue / due soon. Every number is computed here; the screens only lay it out.
//   * Next due / left / status: lib/serviceDue.ts through dueForMachines (one definition).
//   * Checklist progress: counted from the work order's items, never stored.
//   * Est. cost: estimated parts + labour on the open service work order; "Actual" once the last service is completed. Only returned
//     to users with cost access (omitted, not nulled).
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { canViewCost, isAdminRole } from '../../../middleware/requireCostAccess';
import { currentReadings } from '../../fleet/lib/currentReading';
import { toIstDateString } from '../../fleet/lib/istDate';
import { machineAccessWhere } from '../../fleet/lib/machineAccess';
import { isInFleet } from '../../fleet/cost/utilization';
import { loadMachineInScope, pageOf, requireUserId } from '../../fleet/services/common';
import { statusesFor } from '../../fleet/services/machineStatus';
import { MachineDue, dueForMachines } from '../../fleet/services/serviceDue.service';
import { checklistProgress } from '../lib/workOrderAccess';

const OPEN_STATUSES = ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED', 'MISSED'] as const;
const dec = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : Number(v));
const userName = (u: { name: string | null; user_name: string | null } | null | undefined) => (u ? u.name || u.user_name || null : null);

type DueSummary = ReturnType<typeof mapDue>;
function mapDue(d: MachineDue | undefined) {
  const n = d?.nearest ?? null;
  if (!d || !n) return { status: 'NOT_SET' as const, scheduleId: null, scheduleName: null, left: null, overdueBy: null, nextDueReading: null, nextDueDate: null, trigger: null, unit: null, missingBaseline: false };
  const b = n.binding;
  const sched = d.schedules.find((s) => s.id === d.nearestScheduleId) ?? null;
  return {
    status: n.status,
    scheduleId: d.nearestScheduleId,
    scheduleName: sched?.name ?? null,
    left: b && b.left >= 0 ? { value: b.left, unit: b.unit } : null,
    overdueBy: b && b.left < 0 ? { value: Math.abs(b.left), unit: b.unit } : null,
    nextDueReading: n.nextDueReading,
    nextDueDate: n.nextDueDate,
    trigger: b?.kind ?? null,
    unit: b?.unit ?? null,
    missingBaseline: n.missingBaseline,
  };
}

export const recordService = {
  /** Fleet list: one row per maintenance-tracked machine with its nearest service due; chips count Overdue / Due soon / OK. */
  async list(ctx: UserAuthContext, q: { firmId?: unknown; dueStatus?: 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NOT_SET'; q?: string; category?: string; ownership?: 'OWNED' | 'RENTED'; siteId?: bigint; limit?: number; offset?: number }) {
    const today = toIstDateString(new Date());
    const search = q.q?.trim();
    const machines = await prisma.machine.findMany({
      where: {
        isActive: true,
        // a hired machine is not maintenance-tracked unless asked for
        ownershipType: q.ownership ?? 'OWNED',
        ...(q.category ? { equipmentType: q.category as never } : {}),
        AND: [
          await machineAccessWhere(ctx, q.firmId),
          ...(q.siteId ? [{ siteLocationId: q.siteId }] : []),
          ...(search ? [{ OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { assetCode: { contains: search, mode: 'insensitive' as const } }, { registrationNo: { contains: search, mode: 'insensitive' as const } }] }] : []),
        ],
      },
      include: {
        asset: { select: { status: true } },
        firm: { select: { id: true, firm_name: true } },
        assignments: {
          where: { endedAt: null },
          select: { id: true, firmId: true, firm: { select: { id: true, firm_name: true } } },
        },
        defaultMechanic: { select: { id: true, name: true, user_name: true } },
      },
      orderBy: { name: 'asc' },
      take: 1000,
    });
    const live = machines.filter((m) => isInFleet({ rentalEndDate: m.rentalEndAt ? toIstDateString(m.rentalEndAt) : null }, m.status, m.asset?.status ?? null, today));
    const [dues, readings, { status, facts }] = await Promise.all([dueForMachines(prisma, live, today), currentReadings(prisma, live), statusesFor(live, today)]);

    const rows = live.map((m) => {
      const due = mapDue(dues.get(m.id));
      const activeAssignment = m.assignments?.[0] ?? null;
      return {
        machine: {
          id: m.id,
          name: m.name,
          assetCode: m.assetCode,
          category: m.equipmentType,
          imageUrl: m.imageUrl,
          readingUnit: m.readingUnit,
          capacityLabel: m.capacityLabel,
          firmId: m.firmId ? String(m.firmId) : null,
          firmName: m.firm?.firm_name ?? null,
          assignment: activeAssignment
            ? {
                id: String(activeAssignment.id),
                firmId: String(activeAssignment.firmId),
                firmName: activeAssignment.firm?.firm_name ?? null,
              }
            : null,
        },
        status: status.get(m.id)!,
        currentReading: readings.get(m.id) ?? null,
        due,
        schedules: dues.get(m.id)?.schedules.length ?? 0,
        openBreakdown: facts.openOrders.has(m.id),
        mechanic: m.defaultMechanic ? { id: String(m.defaultMechanic.id), name: userName(m.defaultMechanic) } : null,
      };
    });
    const count = (s: DueSummary['status']) => rows.filter((r) => r.due.status === s).length;
    const stats = { total: rows.length, overdue: count('OVERDUE'), dueSoon: count('DUE_SOON'), ok: count('OK'), notSet: count('NOT_SET'), openBreakdowns: rows.filter((r) => r.openBreakdown).length };
    const order = { OVERDUE: 0, DUE_SOON: 1, NOT_SET: 2, OK: 3 } as const;
    const filtered = (q.dueStatus ? rows.filter((r) => r.due.status === q.dueStatus) : rows).sort((a, b) => order[a.due.status] - order[b.due.status] || a.machine.name.localeCompare(b.machine.name));
    const { take, skip } = pageOf({ limit: q.limit ?? 100, offset: q.offset });
    return { today, stats, total: filtered.length, rows: filtered.slice(skip, skip + take) };
  },

  /** Everything the per-machine Overview needs, in the order the screen shows it. */
  async summary(ctx: UserAuthContext, machineId: string) {
    const machine = await loadMachineInScope(prisma, ctx, machineId);
    const today = toIstDateString(new Date());
    const withCost = await canViewCost(ctx);
    const full = await prisma.machine.findUniqueOrThrow({
      where: { id: machine.id },
      include: { asset: { select: { id: true, status: true } }, defaultMechanic: { select: { id: true, name: true, user_name: true, employee: { select: { designation: true, phone: true } } } } },
    });
    const [dues, readings, { status }] = await Promise.all([dueForMachines(prisma, [full], today), currentReadings(prisma, [full]), statusesFor([full], today)]);
    const due = dues.get(full.id);

    // the open service work order: the nearest schedule's, else the latest open scheduled one
    const woSelect = {
      include: {
        checklistItems: { orderBy: { sortOrder: 'asc' as const } },
        currentAssignee: { select: { id: true, name: true, user_name: true, employee: { select: { designation: true, phone: true } } } },
        responsible: { select: { id: true, name: true, user_name: true } },
        vendor: { select: { id: true, name: true } },
      },
    } satisfies Prisma.MaintenanceWorkOrderDefaultArgs;
    const openService =
      (due?.nearestScheduleId ? await prisma.maintenanceWorkOrder.findFirst({ where: { scheduleId: due.nearestScheduleId, status: { notIn: [...OPEN_STATUSES] } }, orderBy: { createdAt: 'desc' }, ...woSelect }) : null) ??
      (await prisma.maintenanceWorkOrder.findFirst({ where: { machineId, type: 'SCHEDULED', scheduleId: { not: null }, status: { notIn: [...OPEN_STATUSES] } }, orderBy: { createdAt: 'desc' }, ...woSelect }));
    const lastService = await prisma.maintenanceWorkOrder.findFirst({ where: { machineId, scheduleId: { not: null }, status: { in: ['COMPLETED', 'COMPLETED_LATE'] } }, orderBy: { completedAt: 'desc' } });
    const breakdown = await prisma.breakdownReport.findFirst({ where: { machineId }, orderBy: { reportedAt: 'desc' }, include: { workOrder: { select: { id: true } } } });

    const openBreakdown = breakdown !== null && (breakdown.status === 'OPEN' || breakdown.status === 'IN_PROGRESS');
    const mechanicUser = openService?.currentAssignee ?? full.defaultMechanic;
    const estimated = openService ? (dec(openService.estPartsCost) ?? 0) + (dec(openService.estLabourCost) ?? 0) : null;
    const lastParts = lastService ? (dec(lastService.actualPartsCost) ?? dec(lastService.estPartsCost)) : null;
    const lastLabour = lastService ? (dec(lastService.actualLabourCost) ?? dec(lastService.estLabourCost)) : null;
    const actual = lastService
      ? (dec(lastService.cost) ?? ((lastParts !== null || lastLabour !== null) ? (lastParts ?? 0) + (lastLabour ?? 0) : null))
      : null;

    const a = await prisma.machineAssignment.findFirst({ where: { machineId, endedAt: null }, select: { responsibleUserId: true } });
    const mayScheduleService = isAdminRole(ctx.role) || a?.responsibleUserId === ctx.userId || full.defaultResponsibleId === ctx.userId;

    return {
      machine: {
        id: full.id,
        firmId: full.firmId === null ? null : String(full.firmId),
        name: full.name,
        assetCode: full.assetCode,
        assetId: full.assetId,
        category: full.equipmentType,
        imageUrl: full.imageUrl,
        ownershipType: full.ownershipType,
        readingUnit: full.readingUnit,
        capacityLabel: full.capacityLabel,
        currentReading: readings.get(full.id) ?? null,
        status: status.get(full.id)!,
      },
      nextService: mapDue(due),
      schedules: (due?.schedules ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        intervalValue: s.intervalValue,
        intervalDays: s.intervalDays,
        lastServiceAt: s.lastServiceAt,
        lastServiceReading: s.lastServiceReading,
        nextDueReading: s.due.nextDueReading,
        nextDueDate: s.due.nextDueDate,
        status: s.due.status,
        missingBaseline: s.due.missingBaseline,
      })),
      checklist: openService
        ? {
            workOrderId: openService.id,
            workOrderCode: openService.workOrderCode,
            status: openService.status,
            items: openService.checklistItems.map((i) => ({ id: i.id, text: i.text, state: i.state, note: i.note })),
            ...checklistProgress(openService.checklistItems),
          }
        : null,
      breakdown: {
        reported: openBreakdown,
        reportedAt: breakdown?.reportedAt.toISOString() ?? null,
        id: breakdown?.id ?? null,
        status: breakdown?.status ?? null,
        severity: breakdown?.severity ?? null,
        workOrderId: breakdown?.workOrder?.id ?? null,
      },
      mechanic: mechanicUser ? { id: String(mechanicUser.id), name: userName(mechanicUser), designation: mechanicUser.employee?.designation ?? null, phone: mechanicUser.employee?.phone ?? null } : null,
      responsible: openService?.responsible ? { id: String(openService.responsible.id), name: userName(openService.responsible) } : null,
      openServiceWorkOrder: openService ? { id: openService.id, code: openService.workOrderCode, status: openService.status, dueAt: openService.actualDueDate?.toISOString() ?? null, serviceMode: openService.serviceMode, vendor: openService.vendor ? { id: openService.vendor.id, name: openService.vendor.name } : null } : null,
      // omitted entirely for users without cost access
      ...(withCost
        ? {
            cost: openService
              ? { label: 'Est.', total: estimated, parts: dec(openService.estPartsCost), labour: dec(openService.estLabourCost) }
              : lastService
                ? { label: 'Actual', total: actual, parts: lastParts, labour: lastLabour }
                : null,
          }
        : {}),
      canScheduleService: mayScheduleService && full.ownershipType === 'OWNED',
      canManageSchedules: isAdminRole(ctx.role),
    };
  },

  /** Service History: completed work orders (any type) on this machine, newest first, with vendor and bill details. */
  async history(ctx: UserAuthContext, machineId: string, q: { limit?: number; offset?: number }) {
    await loadMachineInScope(prisma, ctx, machineId);
    const withCost = await canViewCost(ctx);
    const where: Prisma.MaintenanceWorkOrderWhereInput = { machineId, status: { in: ['COMPLETED', 'COMPLETED_LATE'] } };
    const { take, skip } = pageOf({ limit: q.limit ?? 50, offset: q.offset });
    const [rows, total] = await Promise.all([
      prisma.maintenanceWorkOrder.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        take,
        skip,
        include: { vendor: { select: { id: true, name: true, mobileNumber: true } }, currentAssignee: { select: { name: true, user_name: true } }, repairParts: { select: { id: true } } },
      }),
      prisma.maintenanceWorkOrder.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((w) => {
        const partsCost = dec(w.actualPartsCost) ?? dec(w.estPartsCost);
        const labourCost = dec(w.actualLabourCost) ?? dec(w.estLabourCost);
        const totalCost = dec(w.cost) ?? ((partsCost !== null || labourCost !== null) ? (partsCost ?? 0) + (labourCost ?? 0) : null);
        return {
          id: w.id,
          code: w.workOrderCode,
          type: w.type,
          title: w.title,
          completedAt: w.completedAt?.toISOString() ?? null,
          readingAtService: dec(w.readingAtService),
          serviceMode: w.serviceMode,
          vendor: w.vendor ? { id: w.vendor.id, name: w.vendor.name, phone: w.vendor.mobileNumber } : null,
          billNo: w.billNo,
          billUrl: w.billUrl,
          mechanic: userName(w.currentAssignee),
          parts: w.repairParts.length,
          ...(withCost ? { cost: totalCost, actualPartsCost: partsCost, actualLabourCost: labourCost, estPartsCost: dec(w.estPartsCost), estLabourCost: dec(w.estLabourCost) } : {}),
        };
      }),
    };
  },

  /** Parts Used across the machine's work orders. */
  async parts(ctx: UserAuthContext, machineId: string, q: { limit?: number; offset?: number }) {
    await loadMachineInScope(prisma, ctx, machineId);
    const withCost = await canViewCost(ctx);
    const { take, skip } = pageOf({ limit: q.limit ?? 100, offset: q.offset });
    const rows = await prisma.workOrderRepairPart.findMany({
      where: { workOrder: { machineId } },
      orderBy: { workOrder: { createdAt: 'desc' } },
      take,
      skip,
      include: { workOrder: { select: { id: true, workOrderCode: true, title: true, completedAt: true, createdAt: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      partName: p.partName,
      quantity: p.quantity,
      vendorName: p.vendorName,
      warrantyFromDate: p.warrantyFromDate?.toISOString().slice(0, 10) ?? null,
      warrantyToDate: p.warrantyToDate?.toISOString().slice(0, 10) ?? null,
      workOrder: { id: p.workOrder.id, code: p.workOrder.workOrderCode, title: p.workOrder.title },
      date: (p.workOrder.completedAt ?? p.workOrder.createdAt).toISOString().slice(0, 10),
      ...(withCost ? { unitCost: dec(p.unitCost) } : {}),
    }));
  },
};

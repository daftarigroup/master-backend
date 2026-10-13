// Equipment Master: the searchable, filterable fleet list with derived status, utilization and stat tiles.
// Status and utilization come from the same code as the cost screens (cost/utilization.ts + the engine), fed by batched queries
// (costQueries.ts), so a card, a table row, a drawer and the Cost Tracking page can never disagree.
// Cost fields (month spend, fleet spend) are only even LOADED for callers who may see cost.
import { Machine, Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { canViewCost } from '../../../middleware/requireCostAccess';
import { computeMachinePeriod } from '../cost/costEngine';
import { D, sumDec } from '../cost/decimal';
import { loadCostInputs, loadStatusFacts, settingsFor, loadSettings } from '../cost/costQueries';
import { money } from '../cost/serialize';
import { monthBounds } from '../cost/period';
import { DerivedStatus, deriveStatus, isInFleet } from '../cost/utilization';
import { istMonthOf, toIstDateString } from '../lib/istDate';
import { machineAccessWhere } from '../lib/machineAccess';
import { loadMachineInScope, num, scopeOf } from './common';

export interface EquipmentQuery {
  firmId?: unknown;
  q?: string;
  category?: string;
  ownership?: 'OWNED' | 'RENTED';
  status?: DerivedStatus;
  siteId?: bigint;
  vendor?: string;
  month?: string;
  includeInactive?: boolean;
  sort?: 'code' | 'name' | 'utilization' | 'status' | 'recent' | 'site';
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

type MachineRow = Prisma.MachineGetPayload<{ include: { siteLocation: { select: { location: true } }; rentalVendor: { select: { name: true } }; asset: { select: { status: true } }; firm: { select: { firm_name: true } } } }>;

const STATUS_ORDER: Record<DerivedStatus, number> = { IN_USE: 0, IDLE: 1, AVAILABLE: 2, IN_TRANSIT: 3, UNDER_MAINT: 4 };

/** One equipment row (list item, card, drawer header). Cost fields exist only when `withCost`. */
async function buildRows(machines: MachineRow[], month: string, withCost: boolean) {
  const today = toIstDateString(new Date());
  const period = monthBounds(month);
  const [inputs, facts, settings] = await Promise.all([
    loadCostInputs(machines, period, today, { withCost }),
    loadStatusFacts(machines.map((m) => m.id), machines),
    loadSettings([...new Set(machines.map((m) => m.firmId).filter((f): f is bigint => f !== null))]),
  ]);

  return machines.map((m) => {
    const base = inputs.get(m.id)!;
    const result = computeMachinePeriod({ ...base, period });
    const lastActivity = facts.lastActivity.get(m.id) ?? null;
    const status = deriveStatus({
      machineStatus: m.status,
      assetStatus: m.asset?.status ?? null,
      hasOpenBreakdownOrRepair: facts.openOrders.has(m.id),
      lastActivityDate: lastActivity,
      today,
      idleAfterDays: settingsFor(settings, m.firmId).idleAfterDays,
      hasActiveAssignment: facts.assigned.has(m.id),
      inTransit: facts.inTransit.has(m.id),
    });
    const lastDiesel = base.diesel.reduce<string | null>((latest, d) => (latest === null || d.issueDate > latest ? d.issueDate : latest), null);
    return {
      id: m.id,
      name: m.name,
      assetCode: m.assetCode,
      assetId: m.assetId,
      registrationNo: m.registrationNo,
      category: m.equipmentType,
      imageUrl: m.imageUrl,
      ownershipType: m.ownershipType,
      hireType: m.hireType,
      vendor: m.ownershipType === 'RENTED' ? (m.rentalVendor?.name ?? m.rentalVendorName) : null,
      site: m.siteLocation?.location ?? m.location,
      siteId: m.siteLocationId ? String(m.siteLocationId) : null,
      firmId: m.firmId ? String(m.firmId) : null,
      firmName: m.firm?.firm_name ?? null,
      readingUnit: m.readingUnit,
      status,
      utilization: { percent: result.utilization.percent, overShift: result.utilization.overShift },
      hoursThisMonth: result.usage.unit ? result.usage.quantity.toNumber() : null,
      unit: result.usage.unit,
      lastActivityDate: lastActivity,
      lastDieselDate: lastDiesel,
      lastReading: m.readingUnit === 'NONE' ? null : (facts.lastReading.get(m.id) ?? (Number(m.openingReading) > 0 ? Number(m.openingReading) : null)),
      efficiency: result.metrics.efficiency.value === null ? null : { value: result.metrics.efficiency.value, unit: result.metrics.efficiency.unit },
      createdAt: m.createdAt.toISOString(),
      ...(withCost ? { monthSpend: money(result.tiles.total), dataComplete: result.completeness.complete } : {}),
      _run: result.usage.quantity,
      _available: result.utilization.availableHours,
      _hoursMachine: m.readingUnit === 'HOURS',
    };
  });
}

type Row = Awaited<ReturnType<typeof buildRows>>[number];
const publicRow = ({ _run, _available, _hoursMachine, ...row }: Row) => row;

export const equipmentService = {
  async list(ctx: UserAuthContext, q: EquipmentQuery) {
    const withCost = await canViewCost(ctx);
    const month = q.month ?? istMonthOf(new Date());
    const today = toIstDateString(new Date());

    const search = q.q?.trim();
    const where: Prisma.MachineWhereInput = {
      ...(q.includeInactive ? {} : { isActive: true }),
      ...(q.category ? { equipmentType: q.category as Machine['equipmentType'] } : {}),
      ...(q.ownership ? { ownershipType: q.ownership } : {}),
      ...(q.siteId ? { siteLocationId: q.siteId } : {}),
      ...(q.vendor ? { OR: [{ rentalVendorName: { contains: q.vendor, mode: 'insensitive' } }, { rentalVendor: { name: { contains: q.vendor, mode: 'insensitive' } } }] } : {}),
      AND: [
        await machineAccessWhere(ctx, q.firmId),
        ...(search
          ? [
              {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { assetCode: { contains: search, mode: 'insensitive' as const } },
                  { registrationNo: { contains: search, mode: 'insensitive' as const } },
                  { rentalVendorName: { contains: search, mode: 'insensitive' as const } },
                  { rentalVendor: { name: { contains: search, mode: 'insensitive' as const } } },
                  { location: { contains: search, mode: 'insensitive' as const } },
                  { siteLocation: { location: { contains: search, mode: 'insensitive' as const } } },
                ],
              },
            ]
          : []),
      ],
    };

    const machines = (await prisma.machine.findMany({
      where,
      include: { siteLocation: { select: { location: true } }, rentalVendor: { select: { name: true } }, asset: { select: { status: true } }, firm: { select: { firm_name: true } } },
      take: 1000,
    })) as MachineRow[];

    // disposed, inactive, decommissioned and released machines are left out unless the caller asks for them
    const inFleet = q.includeInactive ? machines : machines.filter((m) => isInFleet({ rentalEndDate: m.rentalEndAt ? toIstDateString(m.rentalEndAt) : null }, m.status, m.asset?.status ?? null, today));
    const rows = await buildRows(inFleet, month, withCost);

    // the tiles ignore the status filter, so a tile count always equals the list you get by tapping that tile
    const stats = {
      total: rows.length,
      inUse: rows.filter((r) => r.status === 'IN_USE').length,
      underMaint: rows.filter((r) => r.status === 'UNDER_MAINT').length,
      // Equipment Master keeps four tiles: "Idle" = Idle + Available (tapping it filters on both); In Transit is its own count and
      // only shows when a machine is on the road, so the tiles still add up to the total.
      idle: rows.filter((r) => r.status === 'IDLE' || r.status === 'AVAILABLE').length,
      available: rows.filter((r) => r.status === 'AVAILABLE').length,
      inTransit: rows.filter((r) => r.status === 'IN_TRANSIT').length,
      owned: rows.filter((r) => r.ownershipType === 'OWNED').length,
      rented: rows.filter((r) => r.ownershipType === 'RENTED').length,
      fleetUtilization: fleetUtilization(rows),
      ...(withCost ? { fleetSpend: money(sumDec(rows.map((r) => D((r as { monthSpend?: number | null }).monthSpend ?? 0)))) } : {}),
    };

    const filtered = q.status ? rows.filter((r) => (q.status === 'IDLE' ? r.status === 'IDLE' || r.status === 'AVAILABLE' : r.status === q.status)) : rows;
    const dir = q.dir === 'desc' ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      switch (q.sort) {
        case 'name': return dir * a.name.localeCompare(b.name);
        case 'utilization': return dir * ((a.utilization.percent ?? -1) - (b.utilization.percent ?? -1));
        case 'status': return dir * (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
        case 'recent': return -dir * a.createdAt.localeCompare(b.createdAt);
        case 'site': return dir * (a.site ?? '').localeCompare(b.site ?? '');
        default: return dir * a.assetCode.localeCompare(b.assetCode, undefined, { numeric: true });
      }
    });
    const take = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const skip = Math.max(q.offset ?? 0, 0);
    return { month, stats, total: sorted.length, items: sorted.slice(skip, skip + take).map(publicRow) };
  },

  /** The desktop drawer / Cost Tracking header: one machine, same numbers as the list. */
  async summary(ctx: UserAuthContext, machineId: string, month?: string) {
    await loadMachineInScope(prisma, ctx, machineId);
    const m = (await prisma.machine.findUnique({
      where: { id: machineId },
      include: { siteLocation: { select: { location: true } }, rentalVendor: { select: { name: true } }, asset: { select: { status: true } } },
    })) as MachineRow | null;
    if (!m) throw ApiError.notFound('Machine not found');
    const [row] = await buildRows([m], month ?? istMonthOf(new Date()), await canViewCost(ctx));
    return { ...publicRow(row), openingReading: num(m.openingReading), rentalStartAt: m.rentalStartAt?.toISOString() ?? null, rentalEndAt: m.rentalEndAt?.toISOString() ?? null };
  },
};

/** Fleet utilization = run hours / available hours over the hour-metered machines (not an average of percentages). */
function fleetUtilization(rows: Row[]): number | null {
  const hourly = rows.filter((r) => r._hoursMachine && r._available !== null);
  const available = sumDec(hourly.map((r) => r._available!));
  if (available.lte(0)) return null;
  return Math.min(sumDec(hourly.map((r) => r._run)).div(available).mul(100).toDecimalPlaces(0).toNumber(), 100);
}

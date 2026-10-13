// The only place cost inputs are read from the database. One batch of queries per call, however many machines: the equipment list,
// the machine cost page and the fleet view all come through here, so they agree and stay fast (no per-machine round trips).
// Everything is scoped by the machines handed in (the caller has already applied firm scope to them).
import { Machine, Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { currentReadings } from '../lib/currentReading';
import { toIstDateString } from '../lib/istDate';
import { D } from './decimal';
import { CostInput } from './costEngine';
import { getMaintenanceCostProvider } from './maintenanceCostProvider';
import { Iso, Period, addDays } from './period';
import { RateRow } from './rates';
import { MachineFacts, SettingsFacts, WbsInfo } from './types';

export type BaseInput = Omit<CostInput, 'period'>;

const DEFAULT_SETTINGS: SettingsFacts = { standardHoursPerDay: D(8), workingDays: [1, 2, 3, 4, 5, 6], idleAfterDays: 2, defaultDieselRate: null };

const dateStr = (d: Date): Iso => d.toISOString().slice(0, 10); // @db.Date columns come back as UTC midnight
const istStr = (d: Date | null): Iso | null => (d ? toIstDateString(d) : null);
const range = (p: Period) => ({ gte: new Date(p.from), lte: new Date(p.to) });

export function machineFacts(m: Machine): MachineFacts {
  return {
    id: m.id,
    ownershipType: m.ownershipType,
    hireType: m.hireType,
    readingUnit: m.readingUnit,
    rentalStartDate: istStr(m.rentalStartAt),
    rentalEndDate: istStr(m.rentalEndAt),
    commissionedOn: istStr(m.installationDate ?? m.purchaseDate),
    shiftHoursPerDay: m.shiftHoursPerDay ? D(m.shiftHoursPerDay) : null,
    expectedConsumption: m.expectedConsumption ? Number(m.expectedConsumption) : null,
  };
}

export async function loadSettings(firmIds: bigint[]): Promise<Map<string, SettingsFacts>> {
  const rows = await prisma.fleetSettings.findMany({ where: { firmId: { in: firmIds } } });
  return new Map(
    rows.map((s) => [
      String(s.firmId),
      { standardHoursPerDay: D(s.standardHoursPerDay), workingDays: s.workingDays, idleAfterDays: s.idleAfterDays, defaultDieselRate: s.defaultDieselRate ? D(s.defaultDieselRate) : null },
    ]),
  );
}

export const settingsFor = (map: Map<string, SettingsFacts>, firmId: bigint | null): SettingsFacts => (firmId === null ? DEFAULT_SETTINGS : (map.get(String(firmId)) ?? DEFAULT_SETTINGS));

/**
 * Engine inputs for many machines over `window` (cover the current AND the comparison period in one go).
 * `withCost: false` loads usage and diesel litres only (what a non-permitted role's list needs): no rates, invoices, maintenance
 * or diesel amounts are even read, so there is nothing to leak.
 */
export async function loadCostInputs(machines: Machine[], window: Period, today: Iso, opts: { withCost: boolean }): Promise<Map<string, BaseInput>> {
  const ids = machines.map((m) => m.id);
  const out = new Map<string, BaseInput>();
  if (ids.length === 0) return out;

  const firmIds = [...new Set(machines.map((m) => m.firmId).filter((f): f is bigint => f !== null))];
  const [settings, usage, openCounts, diesel, entries, rates, maintenance, wbsRows] = await Promise.all([
    loadSettings(firmIds),
    // The two big tables are read as plain strings: at fleet scale (200 machines x 60 days) building Prisma model objects, Dates and
    // Decimals for every row dominates the request time.
    prisma.$queryRaw<RawUsage[]>`
      SELECT id, "machineId", to_char("logDate", 'YYYY-MM-DD') AS "logDate", usage::text AS usage, "wbsActivityId"
      FROM machine_usage_logs
      WHERE "machineId" = ANY(${ids}) AND "voidedAt" IS NULL AND "stopReading" IS NOT NULL AND "logDate" BETWEEN ${window.from}::date AND ${window.to}::date
        AND "status" <> 'REJECTED'
        AND ("status" = 'APPROVED' OR COALESCE((SELECT fs."countPendingLogsInTotals" FROM fleet_settings fs WHERE fs."firmId" = machine_usage_logs."firmId"), true))`,
    prisma.machineUsageLog.groupBy({ by: ['machineId'], where: { machineId: { in: ids }, voidedAt: null, status: { not: 'REJECTED' }, stopReading: null, logDate: range(window) }, _count: { _all: true } }),
    opts.withCost
      ? prisma.$queryRaw<RawDiesel[]>`
          SELECT id, "machineId", to_char("issueDate", 'YYYY-MM-DD') AS "issueDate", litres::text AS litres, "wbsActivityId", "usageLogId",
                 amount::text AS amount, "ratePerLitre"::text AS "ratePerLitre", "rateSource"::text AS "rateSource"
          FROM diesel_logs
          WHERE "machineId" = ANY(${ids}) AND "voidedAt" IS NULL AND "issueDate" BETWEEN ${window.from}::date AND ${window.to}::date`
      : prisma.$queryRaw<RawDiesel[]>`
          SELECT id, "machineId", to_char("issueDate", 'YYYY-MM-DD') AS "issueDate", litres::text AS litres, "wbsActivityId", "usageLogId"
          FROM diesel_logs
          WHERE "machineId" = ANY(${ids}) AND "voidedAt" IS NULL AND "issueDate" BETWEEN ${window.from}::date AND ${window.to}::date`,
    opts.withCost
      ? prisma.machineCostEntry.findMany({ where: { machineId: { in: ids }, voidedAt: null, costDate: range(window) }, select: { id: true, machineId: true, costDate: true, category: true, amount: true, wbsActivityId: true } })
      : Promise.resolve([]),
    opts.withCost ? prisma.machineRate.findMany({ where: { machineId: { in: ids } } }) : Promise.resolve([]),
    opts.withCost ? getMaintenanceCostProvider().costsForMachines({ machineIds: ids, period: window }) : Promise.resolve(new Map()),
    opts.withCost ? prisma.wbsActivity.findMany({ where: { firmId: { in: firmIds } }, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
  ]);

  const wbs = new Map<string, WbsInfo>(wbsRows.map((w) => [w.id, { code: w.code, name: w.name }]));
  const by = <T extends { machineId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.machineId) m.set(r.machineId, [...(m.get(r.machineId) ?? []), r]);
    return m;
  };
  const usageBy = by(usage);
  const dieselBy = by(diesel);
  const entriesBy = by(entries);
  const ratesBy = by(rates);
  const openBy = new Map(openCounts.map((o) => [o.machineId, o._count._all]));

  // breakdown days only matter to rates that deduct them
  const deducting = rates.filter((r) => r.deductBreakdownDays).map((r) => r.machineId);
  const downDays = new Map<string, Iso[]>();
  if (deducting.length > 0) {
    const reports = await prisma.breakdownReport.findMany({
      where: { machineId: { in: [...new Set(deducting)] }, reportedAt: { lte: new Date(`${window.to}T23:59:59Z`) }, OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(window.from) } }] },
      select: { machineId: true, reportedAt: true, resolvedAt: true },
    });
    for (const r of reports) {
      const days = downDays.get(r.machineId) ?? [];
      const from = toIstDateString(r.reportedAt);
      const to = r.resolvedAt ? toIstDateString(r.resolvedAt) : today;
      for (let d = from > window.from ? from : window.from; d <= (to < window.to ? to : window.to); d = addDays(d, 1)) days.push(d);
      downDays.set(r.machineId, days);
    }
  }

  for (const m of machines) {
    out.set(m.id, {
      machine: machineFacts(m),
      settings: settingsFor(settings, m.firmId),
      today,
      usage: (usageBy.get(m.id) ?? []).map((u) => ({ id: u.id, logDate: u.logDate, usage: D(u.usage), wbsActivityId: u.wbsActivityId })),
      diesel: (dieselBy.get(m.id) ?? []).map((d) => ({
        id: d.id,
        issueDate: d.issueDate,
        litres: D(d.litres),
        amount: d.amount ? D(d.amount) : null,
        ratePerLitre: d.ratePerLitre ? D(d.ratePerLitre) : null,
        rateSource: (d.rateSource ?? null) as CostInput['diesel'][number]['rateSource'],
        wbsActivityId: d.wbsActivityId,
        usageLogId: d.usageLogId,
      })),
      maintenance: maintenance.get(m.id) ?? [],
      entries: (entriesBy.get(m.id) ?? []).map((e) => ({ id: e.id, costDate: dateStr(e.costDate), category: e.category, amount: D(e.amount), wbsActivityId: e.wbsActivityId })),
      rates: (ratesBy.get(m.id) ?? []).map(
        (r): RateRow => ({
          id: r.id,
          rateType: r.rateType,
          basis: r.basis,
          amount: D(r.amount),
          minBillableQty: r.minBillableQty ? D(r.minBillableQty) : null,
          extraRate: r.extraRate ? D(r.extraRate) : null,
          deductBreakdownDays: r.deductBreakdownDays,
          effectiveFrom: dateStr(r.effectiveFrom),
          effectiveTo: r.effectiveTo ? dateStr(r.effectiveTo) : null,
        }),
      ),
      breakdownDays: downDays.get(m.id) ?? [],
      openUsageEntries: openBy.get(m.id) ?? 0,
      wbs,
    });
  }
  return out;
}

interface RawUsage {
  id: string;
  machineId: string;
  logDate: string;
  usage: string;
  wbsActivityId: string | null;
}
interface RawDiesel {
  id: string;
  machineId: string | null;
  issueDate: string;
  litres: string;
  wbsActivityId: string | null;
  usageLogId: string | null;
  amount?: string | null;
  ratePerLitre?: string | null;
  rateSource?: string | null;
}

/**
 * Facts the derived status needs for many machines at once: latest activity date, open breakdown/repair orders, the machines that
 * have an ACTIVE assignment, and the machines whose transfer is IN_TRANSIT. The current reading comes from the single module.
 */
export async function loadStatusFacts(machineIds: string[], readingMachines?: Array<{ id: string; openingReading: unknown; readingUnit?: 'KM' | 'HOURS' | 'NONE' }>) {
  if (machineIds.length === 0) return { lastActivity: new Map<string, Iso>(), openOrders: new Set<string>(), lastReading: new Map<string, number>(), assigned: new Set<string>(), inTransit: new Set<string>() };
  const [usage, diesel, orders, assignments, transfers] = await Promise.all([
    prisma.machineUsageLog.groupBy({ by: ['machineId'], where: { machineId: { in: machineIds }, voidedAt: null, status: { not: 'REJECTED' }, stopReading: { not: null } }, _max: { logDate: true } }),
    prisma.dieselLog.groupBy({ by: ['machineId'], where: { machineId: { in: machineIds }, voidedAt: null }, _max: { issueDate: true } }),
    prisma.maintenanceWorkOrder.findMany({
      where: { machineId: { in: machineIds }, type: { in: ['BREAKDOWN', 'REPAIR'] }, status: { notIn: ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED', 'MISSED'] } },
      select: { machineId: true },
      distinct: ['machineId'],
    }),
    prisma.machineAssignment.findMany({ where: { machineId: { in: machineIds }, endedAt: null }, select: { machineId: true } }),
    prisma.machineTransfer.findMany({ where: { machineId: { in: machineIds }, status: 'IN_TRANSIT' }, select: { machineId: true } }),
  ]);
  const lastReading = new Map<string, number>();
  if (readingMachines) {
    const readings = await currentReadings(prisma, readingMachines as Array<{ id: string; openingReading: number; readingUnit?: 'KM' | 'HOURS' | 'NONE' }>);
    for (const [id, v] of readings) if (v !== null) lastReading.set(id, v);
  }
  const lastActivity = new Map<string, Iso>();
  for (const r of usage) if (r._max.logDate) lastActivity.set(r.machineId, dateStr(r._max.logDate));
  for (const r of diesel) {
    if (!r.machineId || !r._max.issueDate) continue;
    const d = dateStr(r._max.issueDate);
    if (!lastActivity.has(r.machineId) || d > lastActivity.get(r.machineId)!) lastActivity.set(r.machineId, d);
  }
  return { lastActivity, openOrders: new Set(orders.map((o) => o.machineId)), lastReading, assigned: new Set(assignments.map((a) => a.machineId)), inTransit: new Set(transfers.map((t) => t.machineId)) };
}

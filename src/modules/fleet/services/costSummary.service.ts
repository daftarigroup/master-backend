// Cost Tracking read side: one machine's month (tiles, overview, metrics, WBS, comparison), a 6-month trend, the log tabs behind the
// numbers, and the fleet overview. Every number comes from the cost engine; nothing here calculates money.
// All of it is cost data: the routes sit behind requireCostAccess.
import { prisma } from '../../../database/prisma';
import { UserAuthContext } from '../../../utils/currentUser';
import { firmWhere } from '../../../utils/firmScope';
import { computeMachineMonth, computeMachinePeriod } from '../cost/costEngine';
import { D, Dec, ZERO, percentShares, sumDec } from '../cost/decimal';
import { deltaPercent, deltaPoints } from '../cost/compare';
import { loadCostInputs, loadSettings, loadStatusFacts, settingsFor } from '../cost/costQueries';
import { getMaintenanceCostProvider } from '../cost/maintenanceCostProvider';
import { comparisonPeriod, monthBounds } from '../cost/period';
import { money, serializeMonth } from '../cost/serialize';
import { deriveStatus, isInFleet } from '../cost/utilization';
import { WbsRow } from '../cost/wbsAllocation';
import { istMonthOf, shiftMonth, toIstDateString } from '../lib/istDate';
import { machineAccessWhere } from '../lib/machineAccess';
import { loadMachineInScope, num, pageOf, scopeOf } from './common';

const nowMonth = () => istMonthOf(new Date());
const todayIst = () => toIstDateString(new Date());

export type CostLogKind = 'usage' | 'diesel' | 'maintenance' | 'entries' | 'rates';

export const costSummaryService = {
  /** One machine, one month, with its like-for-like comparison. */
  async machine(ctx: UserAuthContext, machineId: string, q: { month?: string; category?: string; wbsId?: string }) {
    await loadMachineInScope(prisma, ctx, machineId);
    const machine = await prisma.machine.findUniqueOrThrow({
      where: { id: machineId },
      include: { siteLocation: { select: { location: true } }, rentalVendor: { select: { name: true } }, asset: { select: { status: true } } },
    });
    const month = q.month ?? nowMonth();
    const today = todayIst();
    const cmp = comparisonPeriod(month, today);
    const window = { from: cmp.period.from, to: monthBounds(month).to };

    const [inputs, facts, settings, lifetime] = await Promise.all([
      loadCostInputs([machine], window, today, { withCost: true }),
      loadStatusFacts([machineId]),
      loadSettings(machine.firmId ? [machine.firmId] : []),
      prisma.machineUsageLog.aggregate({ where: { machineId, voidedAt: null, status: { not: 'REJECTED' }, stopReading: { not: null } }, _sum: { usage: true } }),
    ]);
    const result = serializeMonth(computeMachineMonth({ ...inputs.get(machineId)!, month }));

    // filters narrow the WBS table only; the tiles always describe the whole machine-month, so everything still reconciles
    let rows = result.wbs.rows;
    if (q.wbsId) rows = rows.filter((r) => r.wbsActivityId === q.wbsId);
    if (q.category) {
      const col = ({ FUEL: 'fuel', MAINTENANCE: 'maintenance', RENTAL: 'rental', OTHER: 'other' } as const)[q.category as 'FUEL'];
      if (col) rows = rows.filter((r) => (r[col] ?? 0) !== 0);
    }

    return {
      machine: {
        id: machine.id,
        firmId: machine.firmId === null ? null : String(machine.firmId),
        name: machine.name,
        assetCode: machine.assetCode,
        category: machine.equipmentType,
        imageUrl: machine.imageUrl,
        site: machine.siteLocation?.location ?? machine.location,
        ownershipType: machine.ownershipType,
        hireType: machine.hireType,
        vendor: machine.ownershipType === 'RENTED' ? (machine.rentalVendor?.name ?? machine.rentalVendorName) : null,
        rentalStartAt: machine.rentalStartAt?.toISOString() ?? null,
        rentalEndAt: machine.rentalEndAt?.toISOString() ?? null,
        readingUnit: machine.readingUnit,
        lifetimeReading: Number(machine.openingReading) + Number(lifetime._sum.usage ?? 0),
        status: deriveStatus({
          machineStatus: machine.status,
          assetStatus: machine.asset?.status ?? null,
          hasOpenBreakdownOrRepair: facts.openOrders.has(machineId),
          lastActivityDate: facts.lastActivity.get(machineId) ?? null,
          today,
          idleAfterDays: settingsFor(settings, machine.firmId).idleAfterDays,
          hasActiveAssignment: facts.assigned.has(machineId),
          inTransit: facts.inTransit.has(machineId),
        }),
      },
      month,
      filters: { category: q.category ?? null, wbsId: q.wbsId ?? null },
      ...result,
      wbs: { ...result.wbs, rows },
    };
  },

  /** Stacked-bar data: the last `months` months, ending at `month`. */
  async trend(ctx: UserAuthContext, machineId: string, q: { month?: string; months?: number }) {
    await loadMachineInScope(prisma, ctx, machineId);
    const machine = await prisma.machine.findUniqueOrThrow({ where: { id: machineId } });
    const end = q.month ?? nowMonth();
    const count = Math.min(Math.max(q.months ?? 6, 1), 24);
    const list = Array.from({ length: count }, (_, i) => shiftMonth(end, i - (count - 1)));
    const today = todayIst();
    const inputs = await loadCostInputs([machine], { from: monthBounds(list[0]).from, to: monthBounds(end).to }, today, { withCost: true });
    const base = inputs.get(machineId)!;
    return list.map((month) => {
      const r = computeMachinePeriod({ ...base, period: monthBounds(month) });
      return {
        month,
        fuel: money(r.tiles.fuel.amount),
        maintenance: money(r.tiles.maintenance.amount),
        rental: money(r.tiles.rental.amount),
        other: money(r.tiles.other.amount),
        total: money(r.tiles.total),
        hours: r.usage.quantity.toNumber(),
      };
    });
  },

  /** The records behind the tiles (Usage | Diesel | Maintenance | Cost entries | Rate card), month-scoped, voided rows excluded. */
  async logs(ctx: UserAuthContext, machineId: string, kind: CostLogKind, q: { month?: string; limit?: number; offset?: number }) {
    await loadMachineInScope(prisma, ctx, machineId);
    const month = q.month ?? nowMonth();
    const period = monthBounds(month);
    const dates = { gte: new Date(period.from), lte: new Date(period.to) };
    const { take, skip } = pageOf(q);

    switch (kind) {
      case 'usage': {
        const rows = await prisma.machineUsageLog.findMany({ where: { machineId, voidedAt: null, status: { not: 'REJECTED' }, logDate: dates }, orderBy: { startedAt: 'desc' }, take, skip });
        return rows.map((r) => ({
          id: r.id, date: r.logDate.toISOString().slice(0, 10), startReading: num(r.startReading), stopReading: num(r.stopReading), usage: num(r.usage),
          wbsActivityId: r.wbsActivityId, counted: r.stopReading !== null, // open entries are listed but never counted
        }));
      }
      case 'diesel': {
        const rows = await prisma.dieselLog.findMany({ where: { machineId, voidedAt: null, issueDate: dates }, orderBy: { issuedAt: 'desc' }, take, skip });
        return rows.map((r) => ({
          id: r.id, date: r.issueDate.toISOString().slice(0, 10), litres: num(r.litres), ratePerLitre: num(r.ratePerLitre), amount: num(r.amount),
          rateSource: r.rateSource, wbsActivityId: r.wbsActivityId, usageLogId: r.usageLogId,
        }));
      }
      case 'maintenance': {
        const byMachine = await getMaintenanceCostProvider().costsForMachines({ machineIds: [machineId], period });
        const rows = byMachine.get(machineId) ?? [];
        const orders = await prisma.maintenanceWorkOrder.findMany({ where: { id: { in: rows.map((r) => r.workOrderId) } }, select: { id: true, workOrderCode: true, type: true, typeOfWork: true, outsourceStatus: true } });
        const info = new Map(orders.map((o) => [o.id, o]));
        return rows.map((r) => ({ workOrderId: r.workOrderId, code: info.get(r.workOrderId)?.workOrderCode ?? null, type: info.get(r.workOrderId)?.type ?? null, outsourceStatus: info.get(r.workOrderId)?.outsourceStatus ?? null, date: r.date, amount: money(r.amount) }));
      }
      case 'entries': {
        const rows = await prisma.machineCostEntry.findMany({ where: { machineId, voidedAt: null, costDate: dates }, orderBy: { costDate: 'desc' }, take, skip });
        return rows.map((r) => ({ id: r.id, date: r.costDate.toISOString().slice(0, 10), category: r.category, amount: num(r.amount), description: r.description, attachmentUrl: r.attachmentUrl, wbsActivityId: r.wbsActivityId }));
      }
      case 'rates': {
        const rows = await prisma.machineRate.findMany({ where: { machineId }, orderBy: [{ rateType: 'asc' }, { effectiveFrom: 'desc' }] });
        return rows.map((r) => ({
          id: r.id, rateType: r.rateType, basis: r.basis, amount: num(r.amount), minBillableQty: num(r.minBillableQty), extraRate: num(r.extraRate),
          deductBreakdownDays: r.deductBreakdownDays, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), effectiveTo: r.effectiveTo?.toISOString().slice(0, 10) ?? null, note: r.note,
        }));
      }
    }
  },

  /** Fleet overview: KPI strip plus one comparison row per machine. */
  async fleet(ctx: UserAuthContext, q: { firmId?: unknown; month?: string; ownership?: 'OWNED' | 'RENTED'; category?: string; siteId?: bigint; sort?: string; dir?: 'asc' | 'desc'; limit?: number; offset?: number }) {
    const month = q.month ?? nowMonth();
    const today = todayIst();
    const machines = await prisma.machine.findMany({
      where: {
        AND: [await machineAccessWhere(ctx, q.firmId)],
        isActive: true,
        ...(q.ownership ? { ownershipType: q.ownership } : {}),
        ...(q.category ? { equipmentType: q.category as never } : {}),
        ...(q.siteId ? { siteLocationId: q.siteId } : {}),
      },
      include: { siteLocation: { select: { location: true } }, asset: { select: { status: true } } },
      take: 1000,
    });
    const fleetMachines = machines.filter((m) => isInFleet({ rentalEndDate: m.rentalEndAt ? toIstDateString(m.rentalEndAt) : null }, m.status, m.asset?.status ?? null, today));

    const cmp = comparisonPeriod(month, today);
    const inputs = await loadCostInputs(fleetMachines, { from: cmp.period.from, to: monthBounds(month).to }, today, { withCost: true });
    const results = fleetMachines.map((m) => ({ m, r: computeMachineMonth({ ...inputs.get(m.id)!, month }) }));

    const cat = (pick: (r: (typeof results)[number]['r']['current']) => ReturnType<typeof money>) => sumDec(results.map((x) => D(pick(x.r.current) ?? 0)));
    const fuel = cat((r) => money(r.tiles.fuel.amount));
    const maintenance = cat((r) => money(r.tiles.maintenance.amount));
    const rental = cat((r) => money(r.tiles.rental.amount));
    const other = cat((r) => money(r.tiles.other.amount));
    const total = sumDec(results.map((x) => x.r.current.tiles.total));
    const prevTotal = sumDec(results.map((x) => x.r.previous.tiles.total));
    const hourly = results.filter((x) => x.m.readingUnit === 'HOURS');
    const hours = sumDec(hourly.map((x) => x.r.current.usage.quantity));
    const prevHours = sumDec(hourly.map((x) => x.r.previous.usage.quantity));
    const avail = sumDec(hourly.map((x) => x.r.current.utilization.availableHours ?? ZERO));
    const prevAvail = sumDec(hourly.map((x) => x.r.previous.utilization.availableHours ?? ZERO));
    const util = avail.gt(0) ? Math.min(hours.div(avail).mul(100).toDecimalPlaces(0).toNumber(), 100) : null;
    const prevUtil = prevAvail.gt(0) ? Math.min(prevHours.div(prevAvail).mul(100).toDecimalPlaces(0).toNumber(), 100) : null;
    const shares = percentShares([fuel, maintenance, rental, other]);

    const rows = results.map(({ m, r }) => ({
      machineId: m.id, name: m.name, assetCode: m.assetCode, category: m.equipmentType, ownershipType: m.ownershipType, site: m.siteLocation?.location ?? m.location,
      spend: money(r.current.tiles.total), spendDelta: r.comparison.totalSpend, hours: r.current.usage.quantity.toNumber(), unit: r.current.usage.unit,
      costPerUnit: money(r.current.metrics.costPerUnit), efficiency: r.current.metrics.efficiency.value === null ? null : { value: r.current.metrics.efficiency.value, unit: r.current.metrics.efficiency.unit },
      utilization: r.current.utilization.percent, utilizationDelta: r.comparison.utilization, dataComplete: r.current.completeness.complete,
    }));
    const dir = q.dir === 'asc' ? 1 : -1;
    const keyOf: Record<string, (x: (typeof rows)[number]) => number | string> = {
      spend: (x) => x.spend ?? 0, hours: (x) => x.hours, costPerUnit: (x) => x.costPerUnit ?? -1, utilization: (x) => x.utilization ?? -1, name: (x) => x.name,
    };
    const key = keyOf[q.sort ?? 'spend'] ?? keyOf.spend;
    rows.sort((a, b) => {
      const av = key(a), bv = key(b);
      return dir * (typeof av === 'string' ? av.localeCompare(String(bv)) : (av as number) - (bv as number));
    });
    // the fleet view (and its export) may return the whole fleet, so it does not use the 200-row cap of the log tabs
    const take = Math.min(Math.max(q.limit ?? 50, 1), 1000);
    const skip = Math.max(q.offset ?? 0, 0);

    return {
      month,
      comparison: { label: cmp.label, likeForLike: cmp.likeForLike },
      kpis: {
        totalSpend: money(total),
        categories: { fuel: money(fuel), maintenance: money(maintenance), rental: money(rental), other: money(other) },
        shares: shares ? { fuel: shares[0], maintenance: shares[1], rental: shares[2], other: shares[3] } : null,
        hours: hours.toNumber(),
        costPerHour: hours.gt(0) ? money(total.div(hours).toDecimalPlaces(2)) : null,
        utilization: util,
        machines: results.length,
        deltas: { spend: deltaPercent(total, prevTotal, false), hours: deltaPercent(hours, prevHours, true), utilization: deltaPoints(util, prevUtil) },
      },
      total: rows.length,
      rows: rows.slice(skip, skip + take),
      wbsRollup: rollupWbs(results.map((x) => x.r.current.wbs.rows)),
    };
  },
};

/** Fleet-wide WBS totals (sum of each machine's table), so the fleet view reconciles to its own Total Spend too. */
function rollupWbs(tables: WbsRow[][]) {
  const byKey = new Map<string, { wbsActivityId: string | null; code: string | null; name: string; hours: Dec; total: Dec }>();
  for (const table of tables) {
    for (const row of table) {
      const k = row.wbsActivityId ?? '__none__';
      const cur = byKey.get(k) ?? { wbsActivityId: row.wbsActivityId, code: row.code, name: row.name, hours: ZERO, total: ZERO };
      cur.hours = cur.hours.plus(row.hours);
      cur.total = cur.total.plus(row.total);
      byKey.set(k, cur);
    }
  }
  return [...byKey.values()].map((r) => ({ wbsActivityId: r.wbsActivityId, code: r.code, name: r.name, hours: r.hours.toNumber(), total: money(r.total) }));
}

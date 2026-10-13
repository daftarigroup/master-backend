// JSON shape of the engine's results. One shape serves mobile and desktop: the screens choose what to show, the numbers are the same.
import { Dec } from './decimal';
import { MachineCostResult, MachineMonthResult, Tile } from './costEngine';
import { WbsRow } from './wbsAllocation';

export const money = (d: Dec | null): number | null => (d === null ? null : d.toNumber());

const tile = (t: Tile) => ({ amount: money(t.amount), status: t.status, share: t.share });

export function serializeWbsRow(r: WbsRow) {
  return {
    wbsActivityId: r.wbsActivityId,
    code: r.code,
    name: r.name,
    hours: r.hours.toNumber(),
    fuel: money(r.fuel),
    maintenance: money(r.maintenance),
    rental: money(r.rental),
    other: money(r.other),
    total: money(r.total),
    costPerUnit: money(r.costPerUnit),
    percentOfSpend: r.percentOfSpend,
  };
}

export function serializeResult(r: MachineCostResult) {
  return {
    period: r.period,
    tiles: {
      fuel: tile(r.tiles.fuel),
      maintenance: tile(r.tiles.maintenance),
      rental: tile(r.tiles.rental),
      other: tile(r.tiles.other),
      total: money(r.tiles.total),
    },
    rental: { applicable: r.rental.applicable, status: r.rental.status, source: r.rental.source, estimatedAmount: money(r.rental.estimatedAmount), invoicedAmount: money(r.rental.invoicedAmount), uncovered: r.rental.uncovered },
    usage: { quantity: r.usage.quantity.toNumber(), unit: r.usage.unit, entries: r.usage.entries },
    utilization: { percent: r.utilization.percent, overShift: r.utilization.overShift, workingDays: r.utilization.workingDays, availableHours: money(r.utilization.availableHours) },
    metrics: {
      referenceRate: r.metrics.referenceRate ? { amount: money(r.metrics.referenceRate.amount), basis: r.metrics.referenceRate.basis } : null,
      chargeOutValue: money(r.metrics.chargeOutValue),
      costPerUnit: money(r.metrics.costPerUnit),
      efficiency: r.metrics.efficiency,
    },
    wbs: { rows: r.wbs.rows.map(serializeWbsRow), totals: serializeWbsRow({ ...r.wbs.totals, wbsActivityId: null, code: null, name: 'Total' }) },
    completeness: { ...r.completeness, untaggedHours: r.completeness.untaggedHours.toNumber() },
  };
}

export function serializeMonth(m: MachineMonthResult) {
  return {
    ...serializeResult(m.current),
    comparison: {
      label: m.comparison.label,
      likeForLike: m.comparison.likeForLike,
      period: m.comparison.period,
      totalSpend: m.comparison.totalSpend,
      totalHours: m.comparison.totalHours,
      utilization: m.comparison.utilization,
      costByCategory: m.comparison.costByCategory,
      previous: { total: money(m.previous.tiles.total), hours: m.previous.usage.quantity.toNumber(), utilization: m.previous.utilization.percent },
    },
  };
}

// The cost engine: one machine, one period, pure. Everything the mobile tiles, the desktop strip, the WBS table, the fleet view and
// the exports show comes from here, so the numbers cannot disagree between screens.
//
//   Total Spend = fuel + maintenance + rental + other.
//   The internal hourly rate is a charge-out rate shown for reference (and as "rate x hours"); it is NOT part of Total Spend.
import { computeEfficiency } from '../lib/efficiency';
import { Delta, deltaPercent, deltaPoints } from './compare';
import { Dec, ZERO, percentShares, round2, sumDec } from './decimal';
import { Comparison, Iso, Period, comparisonPeriod, inPeriod } from './period';
import { RateBasis, RateRow, rateOn, segmentsFor } from './rates';
import { RentalResult, computeRental } from './rental';
import { CostEntryRow, DieselRow, MachineFacts, MaintenanceRow, SettingsFacts, TileStatus, UsageRow, WbsInfo } from './types';
import { Utilization, computeUtilization } from './utilization';
import { WbsRow, allocateWbs } from './wbsAllocation';

export interface CostInput {
  machine: MachineFacts;
  settings: SettingsFacts;
  period: Period;
  today: Iso;
  usage: UsageRow[];
  diesel: DieselRow[];
  maintenance: MaintenanceRow[];
  entries: CostEntryRow[];
  rates: RateRow[];
  breakdownDays: Iso[];
  /** Open usage entries in the period: reported in the completeness panel, never counted. */
  openUsageEntries: number;
  wbs: Map<string, WbsInfo>;
}

export interface Tile {
  /** Null = could not be computed ("—" plus a "Set rate" badge), never a silent zero. */
  amount: Dec | null;
  status: TileStatus;
  /** Whole-number share of Total Spend; the four shares add up to 100. */
  share: number | null;
}

export interface Completeness {
  missingInternalRate: boolean;
  missingRentalRate: boolean;
  rentalNotInvoiced: boolean;
  unpricedDieselLogs: number;
  estimatedDieselLogs: number;
  untaggedHours: Dec;
  openUsageEntries: number;
  /** True when nothing needs attention. */
  complete: boolean;
}

export interface MachineCostResult {
  period: Period;
  tiles: { fuel: Tile; maintenance: Tile; rental: Tile; other: Tile; total: Dec };
  rental: RentalResult;
  usage: { quantity: Dec; unit: 'Hrs' | 'km' | null; entries: number };
  utilization: Utilization;
  metrics: {
    referenceRate: { amount: Dec; basis: RateBasis } | null;
    /** rate x hours, shown beside (never inside) Total Spend. */
    chargeOutValue: Dec | null;
    costPerUnit: Dec | null;
    efficiency: { value: number | null; unit: 'L/hr' | 'km/L' | null; litres: number; usage: number; entries: number };
  };
  wbs: { rows: WbsRow[]; totals: Omit<WbsRow, 'wbsActivityId' | 'code' | 'name'> };
  completeness: Completeness;
}

const UNIT_LABEL = { HOURS: 'Hrs', KM: 'km', NONE: null } as const;

export function computeMachinePeriod(input: CostInput): MachineCostResult {
  const { machine, settings, period, today } = input;
  const usage = input.usage.filter((u) => inPeriod(u.logDate, period));
  const diesel = input.diesel.filter((d) => inPeriod(d.issueDate, period));

  // ---- fuel -------------------------------------------------------------------------------------------------------------
  const wet = machine.ownershipType === 'RENTED' && machine.hireType === 'WET';
  let fuelAmount: Dec | null = ZERO;
  let fuelStatus: TileStatus = 'OK';
  let unpriced = 0;
  let estimated = 0;
  const fuelForWbs: Array<{ wbsActivityId: string | null; amount: Dec }> = [];
  if (wet) {
    fuelStatus = 'INCLUDED'; // the vendor supplies the diesel: it is in the rental
  } else {
    for (const log of diesel) {
      let amount = log.amount;
      if (amount === null && settings.defaultDieselRate) {
        amount = round2(log.litres.mul(settings.defaultDieselRate));
        estimated += 1;
      }
      if (amount === null) {
        unpriced += 1;
        continue;
      }
      fuelForWbs.push({ wbsActivityId: log.wbsActivityId, amount });
    }
    if (diesel.length > 0 && fuelForWbs.length === 0) {
      fuelAmount = null;
      fuelStatus = 'NO_RATE';
    } else {
      fuelAmount = sumDec(fuelForWbs.map((f) => f.amount));
      fuelStatus = unpriced > 0 ? 'PARTIAL' : estimated > 0 ? 'ESTIMATED' : 'OK';
    }
  }

  // ---- maintenance: each work order once -------------------------------------------------------------------------------
  const seen = new Set<string>();
  const maintenanceRows = input.maintenance.filter((m) => inPeriod(m.date, period) && !seen.has(m.workOrderId) && seen.add(m.workOrderId));
  const maintenanceAmount = sumDec(maintenanceRows.map((m) => m.amount));

  // ---- rental and other -----------------------------------------------------------------------------------------------
  const rental = computeRental({ machine, period, today, usage, rates: input.rates, entries: input.entries, breakdownDays: input.breakdownDays });
  const otherEntries = input.entries.filter((e) => e.category !== 'RENTAL_INVOICE' && inPeriod(e.costDate, period));
  const otherAmount = sumDec(otherEntries.map((e) => e.amount));

  // ---- tiles: rounded once, then Total is their exact sum, so the four tiles always reconcile to it ----------------------
  const fuelRounded = fuelAmount === null ? null : round2(fuelAmount);
  const maintenanceRounded = round2(maintenanceAmount);
  const rentalRounded = rental.amount === null ? null : round2(rental.amount);
  const otherRounded = round2(otherAmount);
  const total = sumDec([fuelRounded ?? ZERO, maintenanceRounded, rentalRounded ?? ZERO, otherRounded]);
  const shares = percentShares([fuelRounded ?? ZERO, maintenanceRounded, rentalRounded ?? ZERO, otherRounded]);

  // ---- usage, utilization, rates ---------------------------------------------------------------------------------------
  const quantity = sumDec(usage.map((u) => u.usage));
  const unit = UNIT_LABEL[machine.readingUnit];
  const utilization = computeUtilization(machine, settings, period, today, usage);

  const internalSegments = segmentsFor(input.rates, 'INTERNAL_HOURLY', period);
  const lastInternal = internalSegments[internalSegments.length - 1]?.rate ?? null;
  const hasUnit = machine.readingUnit !== 'NONE';
  const chargeOut =
    hasUnit && internalSegments.length > 0
      ? round2(sumDec(usage.map((u) => u.usage.mul(rateOn(input.rates, 'INTERNAL_HOURLY', u.logDate)?.amount ?? ZERO))))
      : null;

  // ---- fuel efficiency: litres issued in the period / usage of the period's complete work-log entries ---------------------
  // Diesel now comes from Store issues, which are not tied to one work-log entry, so this is a period figure (the same one the
  // Efficiency report shows). It needs both some diesel and some metered usage in the period.
  let efficiency: MachineCostResult['metrics']['efficiency'] = { value: null, unit: null, litres: 0, usage: 0, entries: usage.length };
  if (hasUnit && diesel.length > 0 && usage.length > 0) {
    const eff = computeEfficiency({
      machineId: machine.id,
      litres: sumDec(diesel.map((d) => d.litres)).toNumber(),
      usages: usage.map((u) => u.usage.toNumber()),
      expectedConsumption: machine.expectedConsumption,
    });
    const value =
      machine.readingUnit === 'HOURS'
        ? eff.rate
        : eff.litres > 0 && eff.usage > 0
          ? Math.round((eff.usage / eff.litres) * 100) / 100
          : null;
    efficiency = { value, unit: machine.readingUnit === 'HOURS' ? 'L/hr' : 'km/L', litres: eff.litres, usage: eff.usage, entries: usage.length };
  }

  // ---- WBS: the table always sums to Total Spend -------------------------------------------------------------------------
  const wbs = allocateWbs({
    usage,
    fuel: fuelForWbs.map((f) => ({ wbsActivityId: f.wbsActivityId, amount: f.amount })),
    maintenanceTotal: maintenanceRounded,
    rentalTotal: rentalRounded ?? ZERO,
    otherEntries,
    wbs: input.wbs,
  });

  // ---- completeness ---------------------------------------------------------------------------------------------------
  const untaggedHours = sumDec(usage.filter((u) => !u.wbsActivityId).map((u) => u.usage));
  const completeness: Completeness = {
    missingInternalRate: hasUnit && internalSegments.length === 0,
    missingRentalRate: rental.applicable && (rental.status === 'NO_RATE' || rental.status === 'PARTIAL'),
    rentalNotInvoiced: rental.source === 'COMPUTED' && today > period.to,
    unpricedDieselLogs: unpriced,
    estimatedDieselLogs: estimated,
    untaggedHours,
    openUsageEntries: input.openUsageEntries,
    complete: false,
  };
  completeness.complete =
    !completeness.missingInternalRate && !completeness.missingRentalRate && !completeness.rentalNotInvoiced &&
    unpriced === 0 && estimated === 0 && untaggedHours.isZero() && input.openUsageEntries === 0;

  const tile = (amount: Dec | null, status: TileStatus, i: number): Tile => ({ amount, status, share: shares ? shares[i] : null });
  return {
    period,
    tiles: {
      fuel: tile(fuelRounded, fuelStatus, 0),
      maintenance: tile(maintenanceRounded, 'OK', 1),
      rental: tile(rentalRounded, rental.status, 2),
      other: tile(otherRounded, 'OK', 3),
      total,
    },
    rental,
    usage: { quantity, unit, entries: usage.length },
    utilization,
    metrics: {
      referenceRate: lastInternal ? { amount: lastInternal.amount, basis: lastInternal.basis } : null,
      chargeOutValue: chargeOut,
      costPerUnit: hasUnit && quantity.gt(0) ? total.div(quantity).toDecimalPlaces(2, 4) : null,
      efficiency,
    },
    wbs,
    completeness,
  };
}

export interface MachineMonthResult {
  current: MachineCostResult;
  previous: MachineCostResult;
  comparison: Comparison & {
    totalSpend: Delta;
    totalHours: Delta;
    utilization: Delta;
    costByCategory: { fuel: Delta; maintenance: Delta; rental: Delta; other: Delta };
  };
}

/** A month and its like-for-like comparison. `input.period` is ignored; `month` (YYYY-MM) sets it. */
export function computeMachineMonth(input: Omit<CostInput, 'period'> & { month: string }): MachineMonthResult {
  const { month, ...rest } = input;
  const from = `${month}-01`;
  const cmp = comparisonPeriod(month, input.today);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const current = computeMachinePeriod({ ...rest, period: { from, to: `${month}-${String(last).padStart(2, '0')}` } });
  const previous = computeMachinePeriod({ ...rest, period: cmp.period });

  // spend is bad when it rises; hours and utilization are good when they rise
  const d = (c: Tile, p: Tile) => deltaPercent(c.amount, p.amount, false);
  return {
    current,
    previous,
    comparison: {
      ...cmp,
      totalSpend: deltaPercent(current.tiles.total, previous.tiles.total, false),
      totalHours: deltaPercent(current.usage.quantity, previous.usage.quantity, true),
      utilization: deltaPoints(current.utilization.percent, previous.utilization.percent),
      costByCategory: {
        fuel: d(current.tiles.fuel, previous.tiles.fuel),
        maintenance: d(current.tiles.maintenance, previous.tiles.maintenance),
        rental: d(current.tiles.rental, previous.tiles.rental),
        other: d(current.tiles.other, previous.tiles.other),
      },
    },
  };
}


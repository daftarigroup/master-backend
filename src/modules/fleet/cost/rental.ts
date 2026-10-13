// Rental charge for a hired machine: effective-dated rate card x logged usage, with minimum billable quantity, an extra-quantity
// rate, and proration for the months the hire starts and ends. A manual RENTAL_INVOICE entry for the period replaces the
// computed figure (and is labelled "invoiced"); the computed one is kept alongside as the estimate.
import { D, Dec, ZERO, round2, sumDec } from './decimal';
import { Iso, Period, daysInMonthOf, daysInclusive, maxIso, minIso } from './period';
import { RateRow, RateSegment, segmentsFor } from './rates';
import { CostEntryRow, MachineFacts, TileStatus, UsageRow } from './types';

export interface RentalResult {
  applicable: boolean;
  /** null = could not be computed (no rate card): show "—" and "Set rate", never 0. */
  amount: Dec | null;
  status: TileStatus;
  source: 'COMPUTED' | 'INVOICED' | null;
  /** The computed figure, kept when an invoice replaced it. */
  estimatedAmount: Dec | null;
  invoicedAmount: Dec | null;
  /** Days or quantity that fell outside every rate row (a gap in the rate card). */
  uncovered: boolean;
}

export interface RentalInput {
  machine: MachineFacts;
  period: Period;
  today: Iso;
  usage: UsageRow[];
  rates: RateRow[];
  entries: CostEntryRow[];
  /** IST dates on which the machine was broken down (for rates that deduct breakdown days). */
  breakdownDays: Iso[];
}

/**
 * Amount for a quantity under a minimum guarantee. Up to the (prorated) minimum is billed at the base rate whatever was used;
 * beyond it, at `extraRate` when the rate card has one, otherwise at the base rate.
 */
export function billedAmount(qty: Dec, rate: RateRow, minQty: Dec): Dec {
  const base = rate.amount;
  if (minQty.gt(0) && rate.extraRate) {
    const over = qty.minus(minQty);
    return over.gt(0) ? base.mul(minQty).plus(rate.extraRate.mul(over)) : base.mul(minQty);
  }
  return base.mul(qty.gt(minQty) ? qty : minQty);
}

function segmentAmount(seg: RateSegment, usage: UsageRow[], monthDays: number, breakdownDays: Iso[]): Dec {
  const rows = usage.filter((u) => u.logDate >= seg.from && u.logDate <= seg.to);
  const calendarDays = daysInclusive(seg.from, seg.to);
  const monthFraction = D(calendarDays).div(monthDays);
  const { rate } = seg;
  const minQty = rate.minBillableQty ? rate.minBillableQty.mul(monthFraction) : ZERO;

  switch (rate.basis) {
    case 'HOUR':
    case 'KM':
      return billedAmount(sumDec(rows.map((r) => r.usage)), rate, minQty);
    case 'DAY':
      // a day is billed when the machine worked that day
      return billedAmount(D(new Set(rows.map((r) => r.logDate)).size), rate, minQty);
    case 'MONTH': {
      const down = rate.deductBreakdownDays ? breakdownDays.filter((d) => d >= seg.from && d <= seg.to).length : 0;
      return rate.amount.mul(D(Math.max(calendarDays - down, 0))).div(monthDays);
    }
  }
}

export function computeRental(input: RentalInput): RentalResult {
  const { machine, period, today, usage, rates, entries } = input;
  if (machine.ownershipType !== 'RENTED') {
    return { applicable: false, amount: null, status: 'NOT_APPLICABLE', source: null, estimatedAmount: null, invoicedAmount: null, uncovered: false };
  }

  // the stretch of the period the machine was actually on hire, up to today
  const window: Period = {
    from: machine.rentalStartDate ? maxIso(period.from, machine.rentalStartDate) : period.from,
    to: minIso(minIso(period.to, today), machine.rentalEndDate ?? period.to),
  };
  const monthDays = daysInMonthOf(period.from);
  const inWindow = usage.filter((u) => u.logDate >= window.from && u.logDate <= window.to);

  let estimated: Dec | null = null;
  let uncovered = false;
  if (window.from > window.to) {
    estimated = ZERO; // not on hire in this period
  } else {
    const segments = segmentsFor(rates, 'RENTAL', window);
    if (segments.length > 0) {
      estimated = round2(sumDec(segments.map((s) => segmentAmount(s, inWindow, monthDays, input.breakdownDays))));
      const covered = (date: Iso) => segments.some((s) => date >= s.from && date <= s.to);
      const coveredDays = segments.reduce((n, s) => n + daysInclusive(s.from, s.to), 0);
      uncovered = inWindow.some((u) => !covered(u.logDate)) || coveredDays < daysInclusive(window.from, window.to);
    }
  }

  const invoices = entries.filter((e) => e.category === 'RENTAL_INVOICE' && e.costDate >= period.from && e.costDate <= period.to);
  if (invoices.length > 0) {
    const invoiced = round2(sumDec(invoices.map((e) => e.amount)));
    return { applicable: true, amount: invoiced, status: 'INVOICED', source: 'INVOICED', estimatedAmount: estimated, invoicedAmount: invoiced, uncovered: false };
  }
  if (estimated === null) {
    return { applicable: true, amount: null, status: 'NO_RATE', source: null, estimatedAmount: null, invoicedAmount: null, uncovered: false };
  }
  return {
    applicable: true,
    amount: estimated,
    // a computed accrual is an estimate until the vendor's invoice is entered
    status: uncovered ? 'PARTIAL' : 'ESTIMATED',
    source: 'COMPUTED',
    estimatedAmount: estimated,
    invoicedAmount: null,
    uncovered,
  };
}

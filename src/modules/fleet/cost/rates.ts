// Effective-dated rate cards. A rate row is valid from `effectiveFrom` until its own `effectiveTo` or the day before the next
// row of the same type starts, whichever is first. History is never rewritten, so a cost always uses the rate in force on the
// date it happened, and a change in the middle of a month splits that month.
import { Dec } from './decimal';
import { Iso, Period, addDays, maxIso, minIso } from './period';

export type RateType = 'INTERNAL_HOURLY' | 'RENTAL';
export type RateBasis = 'HOUR' | 'DAY' | 'MONTH' | 'KM';

export interface RateRow {
  id: string;
  rateType: RateType;
  basis: RateBasis;
  amount: Dec;
  minBillableQty: Dec | null;
  extraRate: Dec | null;
  deductBreakdownDays: boolean;
  effectiveFrom: Iso;
  effectiveTo: Iso | null;
}

export interface RateSegment {
  rate: RateRow;
  from: Iso;
  to: Iso;
}

const OPEN_END = '9999-12-31';

/** Non-overlapping segments of one rate type that intersect `window`, in date order. */
export function segmentsFor(rates: RateRow[], rateType: RateType, window: Period): RateSegment[] {
  const rows = rates.filter((r) => r.rateType === rateType).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const out: RateSegment[] = [];
  rows.forEach((rate, i) => {
    const next = rows[i + 1];
    let to = rate.effectiveTo ?? OPEN_END;
    if (next) to = minIso(to, addDays(next.effectiveFrom, -1));
    const from = maxIso(rate.effectiveFrom, window.from);
    const end = minIso(to, window.to);
    if (from <= end) out.push({ rate, from, to: end });
  });
  return out;
}

/** The rate of this type in force on a date, or null. */
export function rateOn(rates: RateRow[], rateType: RateType, date: Iso): RateRow | null {
  const seg = segmentsFor(rates, rateType, { from: date, to: date })[0];
  return seg ? seg.rate : null;
}

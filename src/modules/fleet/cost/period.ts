// Calendar maths for cost periods. Every date is an IST 'YYYY-MM-DD' string (the format of the @db.Date columns), so
// there are no time zones in here. Turning an instant into an IST date is istDate.ts's job, and only its.
import { shiftMonth } from '../lib/istDate';

export type Iso = string;

/** Inclusive range of IST dates. */
export interface Period {
  from: Iso;
  to: Iso;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const utc = (d: Iso) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const DAY_MS = 86_400_000;

export const maxIso = (a: Iso, b: Iso) => (a >= b ? a : b);
export const minIso = (a: Iso, b: Iso) => (a <= b ? a : b);

export function addDays(d: Iso, n: number): Iso {
  return new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Number of calendar days in [from, to], 0 when the range is empty. */
export function daysInclusive(from: Iso, to: Iso): number {
  return to < from ? 0 : Math.round((utc(to) - utc(from)) / DAY_MS) + 1;
}

export function daysInMonthOf(d: Iso): number {
  return new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
}

/** ISO weekday: 1 = Monday .. 7 = Sunday. */
export function isoWeekday(d: Iso): number {
  const w = new Date(utc(d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Days in [from, to] that fall on one of `workingDays`. */
export function countWorkingDays(from: Iso, to: Iso, workingDays: number[]): number {
  const set = new Set(workingDays);
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (set.has(isoWeekday(d))) n += 1;
  return n;
}

export function monthBounds(month: string): Period {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`Invalid month "${month}", expected YYYY-MM`);
  const from = `${month}-01`;
  return { from, to: addDays(`${shiftMonth(month, 1)}-01`, -1) };
}

export const inPeriod = (d: Iso, p: Period) => d >= p.from && d <= p.to;

export interface Comparison {
  period: Period;
  /** true when the current month is still in progress, so the previous month is cut to the same number of days. */
  likeForLike: boolean;
  label: string;
}

/**
 * The period a month is compared with. A closed month compares with the whole previous month; the month in progress
 * compares with the same elapsed day range of the previous month ("vs Apr 1-15"), so a half month is never set
 * against a full one.
 */
export function comparisonPeriod(month: string, today: Iso): Comparison {
  const prev = shiftMonth(month, -1);
  const prevFull = monthBounds(prev);
  const cur = monthBounds(month);
  const name = `${MONTH_NAMES[Number(prev.slice(5, 7)) - 1]}`;

  if (today >= cur.from && today < cur.to) {
    const elapsed = daysInclusive(cur.from, today);
    const to = minIso(addDays(prevFull.from, elapsed - 1), prevFull.to);
    return { period: { from: prevFull.from, to }, likeForLike: true, label: `vs ${name} 1-${Number(to.slice(8, 10))}` };
  }
  return { period: prevFull, likeForLike: false, label: `vs ${name} ${prev.slice(0, 4)}` };
}

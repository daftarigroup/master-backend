// Daily grouping for the diesel/usage logbooks is done in IST (the sites' wall clock),
// not UTC, so an entry made at 00:30 IST on the 2nd lands on the 2nd.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' of the IST calendar day containing this instant. */
export function toIstDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM' of the IST month containing this instant. */
export function istMonthOf(d: Date): string {
  return toIstDateString(d).slice(0, 7);
}

/** 'YYYY-MM' shifted by `delta` months (negative = earlier). */
export function shiftMonth(month: string, delta: number): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`Invalid month "${month}", expected YYYY-MM`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Every 'YYYY-MM-DD' of a 'YYYY-MM' month, in order. */
export function daysOfMonth(month: string): string[] {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`Invalid month "${month}", expected YYYY-MM`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${m[1]}-${m[2]}-${String(i + 1).padStart(2, '0')}`);
}

/** The instant an IST calendar day starts (00:00 IST) — the lower bound of a timestamp query for that day. */
export function istDayStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - IST_OFFSET_MS);
}

/** The instant the day AFTER an IST calendar day starts: use as an exclusive upper bound (`lt`) for that day. */
export function istNextDayStart(date: string): Date {
  return new Date(istDayStart(date).getTime() + 24 * 60 * 60 * 1000);
}

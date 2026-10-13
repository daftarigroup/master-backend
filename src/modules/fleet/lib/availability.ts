// Availability timeline: one machine, a run of days, a status per day. Pure; the service feeds it pre-fetched facts.
//
//  * Today and past days are ACTUAL: derived from what happened (maintenance window, transfer window, assignment, activity).
//  * Future days are PLANNED: assignment windows (until the expected return), scheduled service windows and open maintenance.
//    A day with no data at all is Available.

export type DayStatus = 'IN_USE' | 'IDLE' | 'UNDER_MAINT' | 'AVAILABLE' | 'IN_TRANSIT';

export interface DateWindow {
  from: string; // YYYY-MM-DD, inclusive
  to: string | null; // null = still open
}
export interface AssignmentWindow extends DateWindow {
  expectedReturnAt: string | null;
}

export interface MachineDayFacts {
  /** dates (YYYY-MM-DD) on which the machine had a complete usage log or a diesel issue */
  activityDates: Set<string>;
  assignments: AssignmentWindow[];
  /** open or past breakdown / repair work orders and scheduled-service windows */
  maintenance: DateWindow[];
  inTransit: DateWindow[];
}

export interface DayCell {
  date: string;
  status: DayStatus;
  planned: boolean;
}

const dn = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);
const addDays = (iso: string, n: number) => new Date((dn(iso) + n) * 86_400_000).toISOString().slice(0, 10);
const covers = (w: DateWindow, d: string) => w.from <= d && (w.to === null || d <= w.to);

export function dayStatus(f: MachineDayFacts, date: string, today: string, idleAfterDays: number): DayCell {
  const planned = date > today;
  if (f.maintenance.some((w) => covers(w, date))) return { date, status: 'UNDER_MAINT', planned };
  if (f.inTransit.some((w) => covers(w, date))) return { date, status: 'IN_TRANSIT', planned };

  const assignment = f.assignments.find((a) => covers(a, date));
  if (planned) {
    // planned: assigned until the expected return (or open-ended), otherwise nobody has asked for it
    if (assignment && (assignment.expectedReturnAt === null || assignment.expectedReturnAt >= date)) return { date, status: 'IN_USE', planned };
    return { date, status: 'AVAILABLE', planned };
  }
  if (!assignment) return { date, status: 'AVAILABLE', planned };
  for (let i = 0; i <= idleAfterDays; i++) if (f.activityDates.has(addDays(date, -i))) return { date, status: 'IN_USE', planned };
  return { date, status: 'IDLE', planned };
}

export function availabilityRow(f: MachineDayFacts, from: string, days: number, today: string, idleAfterDays: number): DayCell[] {
  return Array.from({ length: days }, (_, i) => dayStatus(f, addDays(from, i), today, idleAfterDays));
}

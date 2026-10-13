// Work-log totals for a machine-day, a range, or a day sheet across machines. Pure.
//
//  * Usage is the METER difference (stop - start) on hour-metered machines: the meter is authoritative, the clock window is
//    informational (a variance above 10 minutes is flagged, never "corrected").
//  * Pending logs count as provisional unless the firm counts approved logs only; rejected logs never count; open logs
//    (start without a stop) never contribute hours.
//  * Fuel, trips and output are no longer part of a work log (diesel comes from Store Issue; the form records readings only).

export type ReadingUnit = 'HOURS' | 'KM' | 'NONE';
export type LogStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface KpiLog {
  status: LogStatus;
  readingUnit: ReadingUnit;
  /** stop - start, or null while the entry is open */
  usage: number | null;
  startedAt: Date;
  stoppedAt: Date | null;
}

export const VARIANCE_LIMIT_MINUTES = 10;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function clockMinutes(l: Pick<KpiLog, 'startedAt' | 'stoppedAt'>): number | null {
  return l.stoppedAt ? Math.round((l.stoppedAt.getTime() - l.startedAt.getTime()) / 60_000) : null;
}

/** Minutes the clock window differs from the meter usage (hour-metered machines only); null when it cannot be compared. */
export function clockVarianceMinutes(l: KpiLog): number | null {
  const clock = clockMinutes(l);
  if (clock === null || l.usage === null || l.readingUnit !== 'HOURS') return null;
  return Math.round(Math.abs(clock - l.usage * 60));
}
export const hasClockVariance = (l: KpiLog) => (clockVarianceMinutes(l) ?? 0) > VARIANCE_LIMIT_MINUTES;

export function formatHm(hours: number): string {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export interface WorkLogKpis {
  hours: number;
  hoursLabel: string;
  km: number;
  /** clock minutes of logs on machines without a meter */
  clockMinutesNoMeter: number;
  pendingCount: number;
  /** true when pending logs are inside the totals */
  provisional: boolean;
  counted: number;
  varianceCount: number;
}

export function computeWorkLogKpis(logs: KpiLog[], opts: { countPending: boolean }): WorkLogKpis {
  const counted = logs.filter((l) => l.status !== 'REJECTED' && (l.status === 'APPROVED' || opts.countPending));
  const pendingCount = logs.filter((l) => l.status === 'PENDING').length;

  const hours = counted.reduce((a, l) => (l.readingUnit === 'HOURS' && l.usage !== null ? a + l.usage : a), 0);
  const km = counted.reduce((a, l) => (l.readingUnit === 'KM' && l.usage !== null ? a + l.usage : a), 0);
  const clockMinutesNoMeter = counted.reduce((a, l) => (l.readingUnit === 'NONE' ? a + (clockMinutes(l) ?? 0) : a), 0);

  return {
    hours: round2(hours),
    hoursLabel: formatHm(hours),
    km: round2(km),
    clockMinutesNoMeter,
    pendingCount,
    provisional: opts.countPending && pendingCount > 0,
    counted: counted.length,
    varianceCount: counted.filter(hasClockVariance).length,
  };
}

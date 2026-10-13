// Service due for one schedule. Pure: no database, no clock (the caller passes today).
//
//   next due reading = last service reading + interval      (hour- or km-metered machines)
//   next due date    = last service date + interval days
//   Due = whichever trigger comes first. Status: OK, DUE_SOON (inside the lead window) or OVERDUE.
//   "Left" = the remaining reading (or days) of the NEARER trigger, measured as a share of its own interval, so hours and days compare.
//   A machine with no meter (readingUnit NONE) is date-only.
//
// Worked example (the Maintenance Records design): last service at 20,500 Hrs, interval 250, now 20,500 -> next due 20,750, 250 Hrs left, OK.
// The literal numbers of the mockup (last service at 20,000) give next due 20,250 and the machine at 20,500 is overdue by 250.

export type ReadingUnit = 'HOURS' | 'KM' | 'NONE';
export type ServiceStatus = 'OK' | 'DUE_SOON' | 'OVERDUE' | 'NOT_SET';
export type DueUnit = 'HOURS' | 'KM' | 'DAYS';

export interface ScheduleFacts {
  intervalValue: number | null;
  intervalDays: number | null;
  /** Lead window before the due point; null = the firm default. */
  leadValue: number | null;
  leadDays: number | null;
  /** IST date (YYYY-MM-DD) and meter reading of the last completed service. */
  lastServiceAt: string | null;
  lastServiceReading: number | null;
}

export interface DueContext {
  readingUnit: ReadingUnit;
  currentReading: number | null;
  today: string;
  /** Firm defaults: lead = this percent of the interval (reading trigger) or this many days (date trigger). */
  leadPercent: number;
  leadDays: number;
}

export interface TriggerResult {
  kind: 'READING' | 'DATE';
  unit: DueUnit;
  /** Remaining until due; negative once overdue. */
  left: number;
  dueAt: number | string;
  status: Exclude<ServiceStatus, 'NOT_SET'>;
  /** left as a share of the trigger's own interval; used to pick the nearer trigger. */
  share: number;
}

export interface ServiceDue {
  status: ServiceStatus;
  nextDueReading: number | null;
  nextDueDate: string | null;
  /** The nearer trigger (the one the banner shows), or null when nothing can be computed. */
  binding: TriggerResult | null;
  triggers: TriggerResult[];
  /** A reading-based schedule that has no last-service reading cannot be measured: say so instead of guessing. */
  missingBaseline: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function dayNumber(iso: string): number {
  return Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);
}
export function addDaysIso(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * 86_400_000).toISOString().slice(0, 10);
}

const SEVERITY: Record<Exclude<ServiceStatus, 'NOT_SET'>, number> = { OK: 0, DUE_SOON: 1, OVERDUE: 2 };

export function computeServiceDue(s: ScheduleFacts, ctx: DueContext): ServiceDue {
  const triggers: TriggerResult[] = [];
  let nextDueReading: number | null = null;
  let nextDueDate: string | null = null;
  let missingBaseline = false;

  // reading trigger
  if (s.intervalValue !== null && s.intervalValue > 0 && ctx.readingUnit !== 'NONE') {
    if (s.lastServiceReading === null) {
      missingBaseline = true;
    } else {
      nextDueReading = round2(s.lastServiceReading + s.intervalValue);
      if (ctx.currentReading !== null) {
        const left = round2(nextDueReading - ctx.currentReading);
        const lead = s.leadValue ?? round2((s.intervalValue * ctx.leadPercent) / 100);
        triggers.push({
          kind: 'READING',
          unit: ctx.readingUnit,
          left,
          dueAt: nextDueReading,
          status: left < 0 ? 'OVERDUE' : left <= lead ? 'DUE_SOON' : 'OK',
          share: left / s.intervalValue,
        });
      }
    }
  }

  // date trigger
  if (s.intervalDays !== null && s.intervalDays > 0) {
    if (s.lastServiceAt === null) {
      missingBaseline = true;
    } else {
      nextDueDate = addDaysIso(s.lastServiceAt, s.intervalDays);
      const left = dayNumber(nextDueDate) - dayNumber(ctx.today);
      const lead = s.leadDays ?? ctx.leadDays;
      triggers.push({ kind: 'DATE', unit: 'DAYS', left, dueAt: nextDueDate, status: left < 0 ? 'OVERDUE' : left <= lead ? 'DUE_SOON' : 'OK', share: left / s.intervalDays });
    }
  }

  if (triggers.length === 0) return { status: 'NOT_SET', nextDueReading, nextDueDate, binding: null, triggers, missingBaseline };

  // the worst status wins; among equals the trigger with the smaller remaining share is "nearer"
  const worst = Math.max(...triggers.map((t) => SEVERITY[t.status]));
  const candidates = triggers.filter((t) => SEVERITY[t.status] === worst);
  const binding = candidates.reduce((a, b) => (b.share < a.share ? b : a));
  const status = (Object.keys(SEVERITY) as Array<keyof typeof SEVERITY>).find((k) => SEVERITY[k] === worst)!;
  return { status, nextDueReading, nextDueDate, binding, triggers, missingBaseline };
}

/** The most urgent of several schedules for one machine (what the banner and the fleet list show). */
export function nearestDue(dues: ServiceDue[]): ServiceDue | null {
  const live = dues.filter((d) => d.binding !== null);
  if (live.length === 0) return dues[0] ?? null;
  return live.reduce((a, b) => {
    const sa = SEVERITY[a.status as keyof typeof SEVERITY];
    const sb = SEVERITY[b.status as keyof typeof SEVERITY];
    if (sa !== sb) return sb > sa ? b : a;
    return b.binding!.share < a.binding!.share ? b : a;
  });
}

// Pure validation for one Machine Usage Logbook entry. No database, no clock.
// Implements data-quality rules 1-4 and 7 from the fleet plan (§B.3):
//   1. A start without a stop is an OPEN entry: usage is null, never negative or partial.
//   2. stop < start is rejected. A meter reset/replacement is a NEW entry with
//      meterReset=true and a reason; its start becomes the new baseline.
//   3. start should equal the machine's previous stop. A gap is allowed but needs a reason.
//   4. Implausibly large usage is flagged (warn, never block).
//   7. Machines with readingUnit NONE have no readings at all.
// Readings are stored with 2 decimals, so all arithmetic is rounded to 2 dp to avoid
// floating-point noise such as 0.30000000000000004.

export type ReadingUnit = 'KM' | 'HOURS' | 'NONE';
export type UsageFlag = 'IMPLAUSIBLE_USAGE' | 'CONTINUITY_GAP' | 'METER_RESET';
export type UsageErrorCode =
  | 'READINGS_NOT_ALLOWED'
  | 'NEGATIVE_READING'
  | 'STOP_BEFORE_START'
  | 'METER_RESET_REASON_REQUIRED'
  | 'CONTINUITY_REASON_REQUIRED';

export interface UsageLimits {
  maxHoursPerEntry: number;
  maxKmPerEntry: number;
}

export const DEFAULT_USAGE_LIMITS: UsageLimits = { maxHoursPerEntry: 24, maxKmPerEntry: 800 };

export interface UsageEntryInput {
  readingUnit: ReadingUnit;
  startReading: number;
  stopReading?: number | null;
  meterReset?: boolean;
  meterResetReason?: string | null;
  /** Latest complete, non-voided stop reading before this entry; null when there is none. */
  previousStop?: number | null;
  continuityReason?: string | null;
  /** Per-machine override of the plausibility threshold. */
  maxUsagePerEntry?: number | null;
}

export interface UsageWarning {
  code: UsageFlag;
  message: string;
}

export interface UsageEvaluation {
  ok: true;
  isOpen: boolean;
  /** stop - start, or null while the entry is open. */
  usage: number | null;
  /** start - previousStop when it is not zero, otherwise null. */
  continuityGap: number | null;
  flags: UsageFlag[];
  warnings: UsageWarning[];
}

export interface UsageRejection {
  ok: false;
  code: UsageErrorCode;
  message: string;
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const blank = (s?: string | null): boolean => !s || s.trim().length === 0;

export function effectiveMaxUsage(
  unit: ReadingUnit,
  override?: number | null,
  limits: UsageLimits = DEFAULT_USAGE_LIMITS,
): number | null {
  if (override != null && override > 0) return override;
  if (unit === 'HOURS') return limits.maxHoursPerEntry;
  if (unit === 'KM') return limits.maxKmPerEntry;
  return null;
}

export function evaluateUsageEntry(
  input: UsageEntryInput,
  limits: UsageLimits = DEFAULT_USAGE_LIMITS,
): UsageEvaluation | UsageRejection {
  const reject = (code: UsageErrorCode, message: string): UsageRejection => ({ ok: false, code, message });

  if (input.readingUnit === 'NONE') {
    return reject('READINGS_NOT_ALLOWED', 'This machine has no meter (reading unit NONE); usage readings are not recorded.');
  }

  const start = round2(input.startReading);
  const hasStop = input.stopReading !== null && input.stopReading !== undefined;
  const stop = hasStop ? round2(input.stopReading as number) : null;

  if (start < 0 || (stop !== null && stop < 0)) {
    return reject('NEGATIVE_READING', 'Readings cannot be negative.');
  }
  if (stop !== null && stop < start) {
    return reject('STOP_BEFORE_START', `Stop reading (${stop}) is lower than start reading (${start}).`);
  }

  const flags: UsageFlag[] = [];
  const warnings: UsageWarning[] = [];

  let continuityGap: number | null = null;
  if (input.meterReset) {
    if (blank(input.meterResetReason)) {
      return reject('METER_RESET_REASON_REQUIRED', 'A meter reset or replacement needs a reason.');
    }
    flags.push('METER_RESET');
  } else if (input.previousStop !== null && input.previousStop !== undefined) {
    const gap = round2(start - input.previousStop);
    if (gap !== 0) {
      if (blank(input.continuityReason)) {
        return reject(
          'CONTINUITY_REASON_REQUIRED',
          `Start reading (${start}) differs from the previous stop reading (${input.previousStop}) by ${gap}. Enter a reason to continue.`,
        );
      }
      continuityGap = gap;
      flags.push('CONTINUITY_GAP');
      warnings.push({ code: 'CONTINUITY_GAP', message: `Start reading is ${gap} away from the previous stop reading.` });
    }
  }

  const usage = stop === null ? null : round2(stop - start);

  if (usage !== null) {
    const max = effectiveMaxUsage(input.readingUnit, input.maxUsagePerEntry, limits);
    if (max !== null && usage > max) {
      flags.push('IMPLAUSIBLE_USAGE');
      warnings.push({
        code: 'IMPLAUSIBLE_USAGE',
        message: `Usage of ${usage} ${input.readingUnit === 'HOURS' ? 'hours' : 'km'} in one entry is above the expected maximum of ${max}.`,
      });
    }
  }

  return { ok: true, isOpen: usage === null, usage, continuityGap, flags, warnings };
}

/** Total run of a machine = opening reading + sum of complete usage entries. Open entries add nothing. */
export function totalRun(openingReading: number, usages: Array<number | null | undefined>): number {
  const sum = usages.reduce<number>((acc, u) => (u == null ? acc : acc + u), 0);
  return round2(openingReading + sum);
}

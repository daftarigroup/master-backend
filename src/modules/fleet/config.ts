import { DEFAULT_USAGE_LIMITS, UsageLimits } from './lib/usageRules';
import { DEFAULT_EFFICIENCY_DEVIATION_PCT } from './lib/efficiency';

const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Thresholds are configuration, not constants (plan §B.3). A machine's own
// `maxUsagePerEntry` overrides the per-unit default at evaluation time.
export const fleetConfig = {
  get usageLimits(): UsageLimits {
    return {
      maxHoursPerEntry: num(process.env.FLEET_MAX_HOURS_PER_ENTRY, DEFAULT_USAGE_LIMITS.maxHoursPerEntry),
      maxKmPerEntry: num(process.env.FLEET_MAX_KM_PER_ENTRY, DEFAULT_USAGE_LIMITS.maxKmPerEntry),
    };
  },
  get efficiencyDeviationPct(): number {
    return num(process.env.FLEET_EFFICIENCY_DEVIATION_PCT, DEFAULT_EFFICIENCY_DEVIATION_PCT);
  },
  /** Entries dated further ahead than this are rejected as typos; back-dating is unrestricted. */
  maxFutureMs: 24 * 60 * 60 * 1000,
  /** An open entry older than this shows up as stale in /alerts. */
  staleOpenEntryMs: 24 * 60 * 60 * 1000,
};

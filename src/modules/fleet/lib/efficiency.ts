// Fuel efficiency (rule 8): total litres / total usage over a period, per machine.
// Only complete entries count towards usage; open entries are reported, never divided.
// A zero usage total yields a null rate, never a division by zero.

import { round2 } from './usageRules';

export interface EfficiencyInput {
  machineId: string;
  /** Litres issued to the machine in the period (non-voided). */
  litres: number;
  /** `usage` of every entry in the period; null = open entry. */
  usages: Array<number | null>;
  /** Expected litres per reading unit (per hour or per km). */
  expectedConsumption: number | null;
}

export interface EfficiencyResult {
  machineId: string;
  litres: number;
  usage: number;
  /** Litres per reading unit, or null when there is no complete usage. */
  rate: number | null;
  expected: number | null;
  /** (rate - expected) / expected * 100, or null when either side is missing. */
  deviationPct: number | null;
  flagged: boolean;
  excludedOpenEntries: number;
}

export const DEFAULT_EFFICIENCY_DEVIATION_PCT = 25;

export function computeEfficiency(
  input: EfficiencyInput,
  thresholdPct: number = DEFAULT_EFFICIENCY_DEVIATION_PCT,
): EfficiencyResult {
  const complete = input.usages.filter((u): u is number => u !== null);
  const usage = round2(complete.reduce((a, u) => a + u, 0));
  const litres = round2(input.litres);
  const rate = usage > 0 ? Math.round((litres / usage) * 1000) / 1000 : null;
  const expected = input.expectedConsumption != null && input.expectedConsumption > 0 ? input.expectedConsumption : null;
  const deviationPct = rate !== null && expected !== null ? Math.round(((rate - expected) / expected) * 1000) / 10 : null;
  return {
    machineId: input.machineId,
    litres,
    usage,
    rate,
    expected,
    deviationPct,
    flagged: deviationPct !== null && Math.abs(deviationPct) > thresholdPct,
    excludedOpenEntries: input.usages.length - complete.length,
  };
}

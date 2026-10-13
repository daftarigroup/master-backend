// Month-over-month deltas. A previous value of zero (or missing) gives null, never Infinity or NaN. Colours are direction-aware:
// more spend is bad, more hours or utilization is good.
import { Dec } from './decimal';

export interface Delta {
  kind: 'percent' | 'points';
  /** Relative % for spend and hours, percentage points for utilization. Null when there is nothing to compare. */
  value: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  tone: 'good' | 'bad' | 'neutral';
}

const EMPTY = (kind: Delta['kind']): Delta => ({ kind, value: null, direction: null, tone: 'neutral' });

function build(kind: Delta['kind'], value: number, higherIsBetter: boolean): Delta {
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const tone = direction === 'flat' ? 'neutral' : (direction === 'up') === higherIsBetter ? 'good' : 'bad';
  return { kind, value, direction, tone };
}

/** Relative change, one decimal. `higherIsBetter` is false for spend. */
export function deltaPercent(current: Dec | null, previous: Dec | null, higherIsBetter: boolean): Delta {
  if (current === null || previous === null || previous.isZero()) return EMPTY('percent');
  const pct = current.minus(previous).div(previous.abs()).mul(100).toDecimalPlaces(1, 4).toNumber();
  return build('percent', pct, higherIsBetter);
}

/** Percentage-point change (utilization); higher is always better. */
export function deltaPoints(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return EMPTY('points');
  return build('points', Math.round((current - previous) * 10) / 10, true);
}

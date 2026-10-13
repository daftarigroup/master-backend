// Money and quantities in the cost engine are Prisma.Decimal end to end: no JS floats in aggregation.
import { Prisma } from '@prisma/client';

export type Dec = Prisma.Decimal;
export const ZERO: Dec = new Prisma.Decimal(0);

export function D(value: Prisma.Decimal.Value | null | undefined): Dec {
  return value === null || value === undefined ? ZERO : new Prisma.Decimal(value);
}

export function sumDec(values: Dec[]): Dec {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

/** Round to whole paise (half up). Amounts are rounded once, at the edge of a calculation. */
export function round2(value: Dec): Dec {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Splits `total` across `weights` in units of 10^-dp (default paise) so every part is a whole unit and the parts add up to
 * `total` exactly (largest-remainder method; ties go to the earlier index). Zero or no weights returns null: the caller
 * decides where an unattributable amount goes.
 */
export function allocate(total: Dec, weights: Dec[], dp = 2): Dec[] | null {
  const weightSum = sumDec(weights);
  if (weights.length === 0 || weightSum.lte(0)) return null;

  const unit = new Prisma.Decimal(10).pow(-dp);
  const negative = total.isNegative();
  const units = total.abs().div(unit).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  const raw = weights.map((w) => units.mul(w).div(weightSum));
  const floors = raw.map((r) => r.floor());
  let remaining = units.minus(sumDec(floors)).toNumber();

  const order = raw
    .map((r, i) => ({ i, frac: r.minus(floors[i]) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const parts = floors.slice();
  for (const { i } of order) {
    if (remaining <= 0) break;
    parts[i] = parts[i].plus(1);
    remaining -= 1;
  }
  return parts.map((p) => (negative ? p.neg() : p).mul(unit));
}

/** Whole-number percentages of `amounts` that add up to exactly 100 (largest remainder). Null when the total is zero. */
export function percentShares(amounts: Dec[]): number[] | null {
  const parts = allocate(new Prisma.Decimal(100), amounts, 0);
  return parts ? parts.map((p) => p.toNumber()) : null;
}

export const toNum = (value: Dec | null): number | null => (value === null ? null : value.toNumber());

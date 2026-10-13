// Diesel is valued and the value is STAMPED on each issue when it is written, so a later price never silently rewrites old months.
//   1. STORE:   the Store average purchase price of the item, passed in by the Store issue hook (recordIssue ratePerLitre + rateSource STORE)
//   2. DEFAULT: the firm default rate (fleet_settings.defaultDieselRate), shown as "estimated"
//   3. nothing: left unpriced (null), shown as "set rate" - never a silent zero
// (RECEIPT_AVG, the average of tank receipts, was retired with the tank; old logs keep the value stamped then.)
import { DieselRateSource, Prisma } from '@prisma/client';
import { Db } from '../services/common';
import { D, Dec, round2 } from './decimal';

export interface Valuation {
  ratePerLitre: Dec;
  amount: Dec;
  rateSource: DieselRateSource;
}

export function valueAt(litres: Dec, rate: Dec, source: DieselRateSource): Valuation {
  const r = rate.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  return { ratePerLitre: r, amount: round2(litres.mul(r)), rateSource: source };
}

export async function valuationFor(
  db: Db,
  args: { firmId: bigint; issueDate: string; litres: Dec },
): Promise<Valuation | null> {
  // The tank (receipt average) is retired: diesel now comes from the Store, which passes its own average price with rateSource STORE.
  // Any other issue falls back to the firm default rate, else stays unpriced.
  const settings = await db.fleetSettings.findUnique({ where: { firmId: args.firmId }, select: { defaultDieselRate: true } });
  if (settings?.defaultDieselRate) return valueAt(args.litres, D(settings.defaultDieselRate), 'DEFAULT');
  return null;
}

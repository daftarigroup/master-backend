// Plain-data shapes the cost engine works on. Loaders (costQueries.ts) turn Prisma rows into these; the engine never touches
// the database, so every number can be reproduced from a fixture.
import { Dec } from './decimal';
import { Iso } from './period';

export type ReadingUnit = 'HOURS' | 'KM' | 'NONE';
export type CostCategory = 'OPERATOR' | 'TRANSPORT' | 'INSURANCE' | 'CONSUMABLES' | 'RENTAL_INVOICE' | 'OTHER';

export interface MachineFacts {
  id: string;
  ownershipType: 'OWNED' | 'RENTED';
  hireType: 'DRY' | 'WET' | null;
  readingUnit: ReadingUnit;
  /** IST date the hire starts / ends. Null for owned machines or open-ended hires. */
  rentalStartDate: Iso | null;
  rentalEndDate: Iso | null;
  /** IST date the machine entered service (owned machines), when known. */
  commissionedOn: Iso | null;
  shiftHoursPerDay: Dec | null;
  expectedConsumption: number | null;
}

export interface SettingsFacts {
  standardHoursPerDay: Dec;
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. */
  workingDays: number[];
  idleAfterDays: number;
  defaultDieselRate: Dec | null;
}

/** A COMPLETE, non-voided usage entry. Open entries are never loaded into the engine. */
export interface UsageRow {
  id: string;
  logDate: Iso;
  usage: Dec;
  wbsActivityId: string | null;
}

/** A non-voided diesel issue. */
export interface DieselRow {
  id: string;
  issueDate: Iso;
  litres: Dec;
  amount: Dec | null;
  ratePerLitre: Dec | null;
  rateSource: 'RECEIPT_AVG' | 'STORE' | 'DEFAULT' | 'MANUAL' | null;
  wbsActivityId: string | null;
  usageLogId: string | null;
}

/** What maintenanceCostProvider returns: one row per work order, already filtered to finished, billed work. */
export interface MaintenanceRow {
  workOrderId: string;
  date: Iso;
  amount: Dec;
}

/** A non-voided manual cost entry. */
export interface CostEntryRow {
  id: string;
  costDate: Iso;
  category: CostCategory;
  amount: Dec;
  wbsActivityId: string | null;
}

export interface WbsInfo {
  code: string;
  name: string;
}

export type TileStatus =
  | 'OK'
  | 'ESTIMATED' // built from a default / computed figure
  | 'PARTIAL' // some inputs could not be priced
  | 'NO_RATE' // nothing could be computed: "Set rate"
  | 'INCLUDED' // wet-rate hire: the vendor supplies the diesel
  | 'INVOICED' // a manual rental invoice replaced the computed figure
  | 'NOT_APPLICABLE'; // owned machine has no rental charge

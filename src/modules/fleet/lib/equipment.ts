import { ReadingUnit } from './usageRules';

export type EquipmentType =
  | 'EXCAVATOR' | 'BACKHOE_LOADER' | 'TIPPER' | 'TRUCK' | 'TRANSIT_MIXER' | 'ROLLER'
  | 'TRACTOR' | 'WATER_PUMP' | 'DG_SET' | 'CAR' | 'OTHER'
  | 'LOADER' | 'DOZER' | 'GRADER' | 'CRANE' | 'CONCRETE_PUMP' | 'BATCHING_PLANT' | 'COMPRESSOR' | 'WATER_TANKER';

// Single list of valid values: validators build their z.enum from this so the API cannot drift from the Prisma enum.
export const EQUIPMENT_TYPE_VALUES = [
  'EXCAVATOR', 'BACKHOE_LOADER', 'TIPPER', 'TRUCK', 'TRANSIT_MIXER', 'ROLLER',
  'TRACTOR', 'WATER_PUMP', 'DG_SET', 'CAR', 'OTHER',
  'LOADER', 'DOZER', 'GRADER', 'CRANE', 'CONCRETE_PUMP', 'BATCHING_PLANT', 'COMPRESSOR', 'WATER_TANKER',
] as const satisfies readonly EquipmentType[];

// Default meter basis by equipment type (plan §F Q3): road vehicles run on KM; earth-moving plant, cranes, pumps,
// compressors and DG sets on engine HOURS; tractors and "other" have no meter by default. A user can always override it.
const KM: ReadonlySet<EquipmentType> = new Set(['TIPPER', 'TRUCK', 'TRANSIT_MIXER', 'WATER_TANKER', 'CAR']);
const HOURS: ReadonlySet<EquipmentType> = new Set([
  'EXCAVATOR', 'BACKHOE_LOADER', 'ROLLER', 'WATER_PUMP', 'DG_SET',
  'LOADER', 'DOZER', 'GRADER', 'CRANE', 'CONCRETE_PUMP', 'BATCHING_PLANT', 'COMPRESSOR',
]);

export function defaultReadingUnit(type: EquipmentType): ReadingUnit {
  if (KM.has(type)) return 'KM';
  if (HOURS.has(type)) return 'HOURS';
  return 'NONE';
}

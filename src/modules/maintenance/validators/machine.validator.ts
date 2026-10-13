import { z } from 'zod';
import { blankToUndefined, optBigId, optDate, optNumber, optText } from '../../../utils/zodIds';
import { EQUIPMENT_TYPE_VALUES } from '../../fleet/lib/equipment';

// Used with validateParsed, so the service receives coerced, trimmed, defaulted values and unknown keys are gone.
//
// OWNED stays compatible with the payload the current Add Machine form sends (category, vendor, purchase and
// warranty details, parts, ...). RENTED is deliberately strict: a hired machine has no purchase, warranty, AMC,
// maintenance or parts fields, so sending any is an error rather than being silently stored.

const machineCategory = z.enum(['PRODUCTION', 'UTILITY', 'MATERIAL_HANDLING', 'HVAC', 'ELECTRICAL', 'INSTRUMENTATION', 'SAFETY', 'FACILITY']);
const equipmentType = z.enum(EQUIPMENT_TYPE_VALUES);
const readingUnit = z.enum(['KM', 'HOURS', 'NONE']);
const hireType = z.enum(['DRY', 'WET']);
const name = z.string().trim().min(1, 'name is required').max(200);

const meter = {
  equipmentType: equipmentType.optional(),
  readingUnit: readingUnit.optional(),
  openingReading: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional()),
  expectedConsumption: z.preprocess(blankToUndefined, z.coerce.number().positive().optional()),
  maxUsagePerEntry: z.preprocess(blankToUndefined, z.coerce.number().positive().optional()),
  capacityLabel: optText, // free text, e.g. "20 t", "1 m3", "5 kVA"
};

const ownedFields = {
  name,
  assetCode: optText,
  category: machineCategory.optional(), // deprecated taxonomy; defaults to PRODUCTION
  firmId: optBigId,
  projectId: optBigId,
  departmentId: optBigId,
  siteLocationId: optBigId,
  registrationNo: optText,
  serialNumber: optText,
  modelNumber: optText,
  manufacturer: optText,
  supplier: optText,
  vendor: optText,
  location: optText,
  locationCode: optText,
  subCategory: optText,
  criticalityLevel: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(5).optional()),
  purchaseDate: optDate,
  purchasePrice: optNumber,
  installationDate: optDate,
  warrantyExpiry: optDate,
  warrantyExpiration: optDate,
  imageUrl: optText,
  documentUrls: z.array(z.string()).optional(),
  userManualUrl: optText,
  specificationsSheetUrl: optText,
  additionalSpecifications: z.array(z.object({ name: z.string(), value: z.any() })).optional(),
  parts: z
    .array(z.object({ name: z.string().trim().min(1), partNumber: optText, description: optText, imageUrl: optText }))
    .optional(),
  ...meter,
};

const owned = z.object({ ownershipType: z.literal('OWNED'), ...ownedFields });

const rented = z
  .strictObject({
    ...meter, // equipmentType, readingUnit, expectedConsumption, maxUsagePerEntry; openingReading is re-declared below as required
    ownershipType: z.literal('RENTED'),
    name,
    registrationNo: z.string().trim().min(1, 'registration / identifier is required').max(100),
    firmId: optBigId,
    projectId: optBigId,
    rentalStartAt: z.coerce.date(),
    rentalEndAt: optDate,
    openingReading: z.coerce.number().min(0),
    // the vendor may be typed now or added after saving (plan §C.1)
    rentalVendorId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    rentalVendorName: optText,
    hireType: hireType.default('DRY'),
    departmentId: optBigId,
    siteLocationId: optBigId,
    location: optText,
    serialNumber: optText,
    imageUrl: optText,
    category: machineCategory.optional(),
  })
  .refine((v) => v.firmId !== undefined || v.projectId !== undefined, { message: 'firmId is required for a hired machine', path: ['firmId'] });

export const createMachineOwnershipSchema = z.object({
  body: z.preprocess(
    (b) => (b && typeof b === 'object' ? { ownershipType: 'OWNED', ...(b as object) } : b),
    z.discriminatedUnion('ownershipType', [owned, rented]),
  ),
});

// PATCH: every field optional, non-strict. The service applies the ownership rules to the merged result
// (switching to RENTED needs a registration and hire start; switching to OWNED clears the hire fields).
const partial = z.object({
  ...Object.fromEntries(Object.entries(ownedFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
  ownershipType: z.enum(['OWNED', 'RENTED']).optional(),
  status: z.enum(['OPERATIONAL', 'UNDER_MAINTENANCE', 'BREAKDOWN', 'IDLE', 'DECOMMISSIONED']).optional(),
  rentalStartAt: optDate,
  rentalEndAt: optDate,
  rentalVendorId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  rentalVendorName: optText,
  hireType: hireType.optional(),
});
export const updateMachineSchema = z.object({ params: z.object({ id: z.string().min(1) }), body: partial });

export const machineIdParams = z.object({ params: z.object({ id: z.string().min(1) }) });

export const listMachinesSchema = z.object({
  query: z.object({
    firmId: z.string().optional(),
    projectId: z.string().optional(),
    departmentId: z.string().optional(),
    assetId: z.string().optional(),
    status: z.string().optional(),
    category: z.string().optional(),
    ownershipType: z.enum(['OWNED', 'RENTED']).optional(),
    equipmentType: equipmentType.optional(),
    needMaintenance: z.string().optional(),
    search: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

// re-exported so callers can type the parsed body without reaching into zod
export type CreateMachineBody = z.infer<typeof owned> | z.infer<typeof rented>;

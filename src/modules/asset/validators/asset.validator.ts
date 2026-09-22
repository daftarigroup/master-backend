import { z } from 'zod';

const yesNo = z.enum(['Yes', 'No']);
const category = z.enum(['IT', 'Electronics', 'Furniture', 'Machinery', 'Tools', 'Vehicle']);
const assetType = z.enum(['Asset', 'Non-Consumable', 'Consumable']);
const status = z.enum(['Active', 'Inactive', 'Under Repair', 'Disposed']);
const priority = z.enum(['Low', 'Medium', 'High', '']);

// Shared editable fields — everything a human can actually type into the Add/Edit
// Asset forms. Rollup/cache fields (repairCount, totalRepairCost, maintenanceCount,
// lastMaintenanceDate, partNames, ...) are deliberately absent: those are only ever
// written by the service-layer cascade rules, never accepted from client input.
const assetFields = {
  productName: z.string().trim().min(1).optional(),
  firmId: z.string().nullish(),
  projectId: z.string().nullish(),
  category: category.optional(),
  type: assetType.optional(),
  brand: z.string().nullish(),
  model: z.string().nullish(),
  serialNo: z.string().nullish(),
  sku: z.string().nullish(),
  mfgDate: z.string().nullish(),
  origin: z.string().nullish(),
  status: status.optional(),
  assetDate: z.string().nullish(),
  invoiceNo: z.string().nullish(),
  cost: z.coerce.number().nullish(),
  quantity: z.coerce.number().int().nullish(),
  supplierName: z.string().nullish(),
  supplierPhone: z.string().nullish(),
  paymentMode: z.string().nullish(),
  location: z.string().nullish(),
  department: z.string().nullish(),
  assignedTo: z.string().nullish(),
  responsiblePerson: z.string().nullish(),
  warrantyAvailable: yesNo.optional(),
  warrantyEnd: z.string().nullish(),
  amc: yesNo.optional(),
  amcEnd: z.string().nullish(),
  maintenanceRequired: yesNo.optional(),
  maintenanceType: z.string().nullish(),
  frequency: z.string().nullish(),
  nextService: z.string().nullish(),
  priority: priority.optional(),
  assetValue: z.coerce.number().nullish(),
  depMethod: z.string().nullish(),
};

export const createAssetSchema = z.object({
  body: z.object({
    ...assetFields,
    productName: z.string().trim().min(1, 'productName is required'),
  }),
});

export const updateAssetSchema = z.object({
  body: z.object(assetFields),
  params: z.object({ id: z.string().min(1) }),
});

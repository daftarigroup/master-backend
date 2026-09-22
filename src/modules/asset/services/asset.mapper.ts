import { AssetCategory, AssetStatus, AssetType, DepreciationMethod, PlanFrequency, Priority } from '@prisma/client';

// Bidirectional maps between the frontend's display-friendly literal strings
// (kept exactly as-is in master-frontend/src/features/asset/asset/types/types.ts,
// so the frontend components need zero changes) and this schema's UPPER_SNAKE
// Prisma enums. This mapping layer is the "calculations/shape logic live in the
// backend" seam — the frontend stays a dumb renderer of whatever shape it already had.

const CATEGORY_TO_DB: Record<string, AssetCategory> = {
  IT: 'IT',
  Electronics: 'ELECTRONICS',
  Furniture: 'FURNITURE',
  Machinery: 'MACHINERY',
  Tools: 'TOOLS',
  Vehicle: 'VEHICLE',
};
const CATEGORY_FROM_DB: Record<AssetCategory, string> = {
  IT: 'IT',
  ELECTRONICS: 'Electronics',
  FURNITURE: 'Furniture',
  MACHINERY: 'Machinery',
  TOOLS: 'Tools',
  VEHICLE: 'Vehicle',
};

const TYPE_TO_DB: Record<string, AssetType> = {
  Asset: 'ASSET',
  'Non-Consumable': 'NON_CONSUMABLE',
  Consumable: 'CONSUMABLE',
};
const TYPE_FROM_DB: Record<AssetType, string> = {
  ASSET: 'Asset',
  NON_CONSUMABLE: 'Non-Consumable',
  CONSUMABLE: 'Consumable',
};

const STATUS_TO_DB: Record<string, AssetStatus> = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
  'Under Repair': 'UNDER_REPAIR',
  Disposed: 'DISPOSED',
};
const STATUS_FROM_DB: Record<AssetStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  UNDER_REPAIR: 'Under Repair',
  DISPOSED: 'Disposed',
};

const PRIORITY_TO_DB: Record<string, Priority | null> = {
  Low: 'LOW',
  Medium: 'MEDIUM',
  High: 'HIGH',
  '': null,
};
// CRITICAL has no frontend Asset-form equivalent (only Low/Medium/High are offered) —
// it can only land here via future cross-module cascades, so fall back to the closest
// display value rather than surfacing an enum value the frontend type doesn't declare.
const PRIORITY_FROM_DB: Record<Priority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'High',
};

const DEP_METHOD_TO_DB: Record<string, DepreciationMethod> = {
  'Straight Line': 'STRAIGHT_LINE',
  WDV: 'WDV',
};
const DEP_METHOD_FROM_DB: Record<DepreciationMethod, string> = {
  STRAIGHT_LINE: 'Straight Line',
  WDV: 'WDV',
};

const FREQUENCY_TO_DB: Record<string, PlanFrequency | null> = {
  'One Time': 'ONE_TIME',
  Daily: 'DAILY',
  Weekly: 'WEEKLY',
  Fortnightly: 'FORTNIGHTLY',
  'Alternate Days': 'ALTERNATE_DAYS',
  Monthly: 'MONTHLY',
  Quarterly: 'QUARTERLY',
  'Half Yearly': 'HALF_YEARLY',
  Yearly: 'YEARLY',
  'First Week': 'IN_FIRST_WEEK',
  'Second Week': 'IN_SECOND_WEEK',
  'Third Week': 'IN_THIRD_WEEK',
  'Fourth Week': 'IN_FOURTH_WEEK',
  'Running Hours': 'RUNNING_HOURS',
  'Meter Based': 'METER_BASED',
  ONE_TIME: 'ONE_TIME',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  FORTNIGHTLY: 'FORTNIGHTLY',
  ALTERNATE_DAYS: 'ALTERNATE_DAYS',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  HALF_YEARLY: 'HALF_YEARLY',
  YEARLY: 'YEARLY',
};

const FREQUENCY_FROM_DB: Record<PlanFrequency, string> = {
  ONE_TIME: 'One Time',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  FORTNIGHTLY: 'Fortnightly',
  ALTERNATE_DAYS: 'Alternate Days',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half Yearly',
  YEARLY: 'Yearly',
  IN_FIRST_WEEK: 'First Week',
  IN_SECOND_WEEK: 'Second Week',
  IN_THIRD_WEEK: 'Third Week',
  IN_FOURTH_WEEK: 'Fourth Week',
  RUNNING_HOURS: 'Running Hours',
  METER_BASED: 'Meter Based',
};

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateToStr(value: Date | null | undefined): string {
  if (!value) return '';
  return value.toISOString().slice(0, 10);
}

function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export const assetMapper = {
  toPrismaCreate(body: Record<string, any>) {
    const rawFirm = body.firmId ?? body.projectId;
    const firmId = rawFirm && rawFirm !== 'none' ? BigInt(rawFirm) : null;

    return {
      productName: body.productName,
      ...(firmId ? { firm: { connect: { id: firmId } } } : {}),
      category: CATEGORY_TO_DB[body.category] ?? 'IT',
      type: TYPE_TO_DB[body.type] ?? 'ASSET',
      brand: body.brand ?? null,
      model: body.model ?? null,
      serialNo: body.serialNo ?? null,
      sku: body.sku ?? null,
      mfgDate: toDate(body.mfgDate) ?? null,
      origin: body.origin ?? null,
      status: body.status ? (STATUS_TO_DB[body.status] ?? 'ACTIVE') : 'ACTIVE',
      assetDate: toDate(body.assetDate) ?? new Date(),
      invoiceNo: body.invoiceNo ?? null,
      cost: body.cost !== undefined && body.cost !== null && body.cost !== '' ? Number(body.cost) : null,
      quantity: body.quantity !== undefined && body.quantity !== null && body.quantity !== '' ? Number(body.quantity) : 1,
      supplierName: body.supplierName ?? null,
      supplierPhone: body.supplierPhone ?? null,
      paymentMode: body.paymentMode ?? null,
      location: body.location ?? null,
      department: body.department ?? null,
      assignedTo: body.assignedTo ?? null,
      responsiblePerson: body.responsiblePerson ?? null,
      warrantyAvailable: body.warrantyAvailable === 'Yes',
      warrantyEnd: toDate(body.warrantyEnd) ?? null,
      amcActive: body.amc === 'Yes',
      amcEnd: toDate(body.amcEnd) ?? null,
      maintenanceRequired: body.maintenanceRequired === 'Yes',
      maintenanceType: body.maintenanceType ?? null,
      frequency: body.frequency ? (FREQUENCY_TO_DB[body.frequency] ?? null) : null,
      nextService: toDate(body.nextService) ?? null,
      priority: body.priority !== undefined && body.priority ? (PRIORITY_TO_DB[body.priority] ?? null) : null,
      assetValue: (body.assetValue !== undefined && body.assetValue !== null && body.assetValue !== '')
        ? Number(body.assetValue)
        : (body.cost !== undefined && body.cost !== null && body.cost !== '' ? Number(body.cost) : null),
      depMethod: body.depMethod ? DEP_METHOD_TO_DB[body.depMethod] ?? null : null,
    };
  },

  // Update payload only ever carries editable fields (see asset.validator.ts) —
  // rollup/cache fields are never accepted here, only written by cascade rules.
  toPrismaUpdate(body: Record<string, any>) {
    const data: Record<string, any> = {};
    const set = (key: string, value: any) => {
      if (value !== undefined) data[key] = value;
    };

    set('productName', body.productName);
    if (body.firmId !== undefined || body.projectId !== undefined) {
      const f = body.firmId ?? body.projectId;
      if (f && f !== 'none') {
        data.firm = { connect: { id: BigInt(f) } };
      } else {
        data.firm = { disconnect: true };
      }
    }
    if (body.category !== undefined) set('category', CATEGORY_TO_DB[body.category] ?? 'IT');
    if (body.type !== undefined) set('type', TYPE_TO_DB[body.type] ?? 'ASSET');
    if (body.brand !== undefined) set('brand', body.brand || null);
    if (body.model !== undefined) set('model', body.model || null);
    if (body.serialNo !== undefined) set('serialNo', body.serialNo || null);
    if (body.sku !== undefined) set('sku', body.sku || null);
    if (body.mfgDate !== undefined) set('mfgDate', toDate(body.mfgDate));
    if (body.origin !== undefined) set('origin', body.origin || null);
    if (body.status !== undefined) set('status', STATUS_TO_DB[body.status] ?? 'ACTIVE');
    if (body.assetDate !== undefined) set('assetDate', toDate(body.assetDate));
    if (body.invoiceNo !== undefined) set('invoiceNo', body.invoiceNo || null);
    if (body.cost !== undefined) set('cost', body.cost !== null && body.cost !== '' ? Number(body.cost) : null);
    if (body.quantity !== undefined) set('quantity', body.quantity !== null && body.quantity !== '' ? Number(body.quantity) : 1);
    if (body.supplierName !== undefined) set('supplierName', body.supplierName || null);
    if (body.supplierPhone !== undefined) set('supplierPhone', body.supplierPhone || null);
    if (body.paymentMode !== undefined) set('paymentMode', body.paymentMode || null);
    if (body.location !== undefined) set('location', body.location || null);
    if (body.department !== undefined) set('department', body.department || null);
    if (body.assignedTo !== undefined) set('assignedTo', body.assignedTo || null);
    if (body.responsiblePerson !== undefined) set('responsiblePerson', body.responsiblePerson || null);
    if (body.warrantyAvailable !== undefined) set('warrantyAvailable', body.warrantyAvailable === 'Yes');
    if (body.warrantyEnd !== undefined) set('warrantyEnd', toDate(body.warrantyEnd));
    if (body.amc !== undefined) set('amcActive', body.amc === 'Yes');
    if (body.amcEnd !== undefined) set('amcEnd', toDate(body.amcEnd));
    if (body.maintenanceRequired !== undefined) set('maintenanceRequired', body.maintenanceRequired === 'Yes');
    if (body.maintenanceType !== undefined) set('maintenanceType', body.maintenanceType || null);
    if (body.frequency !== undefined) set('frequency', body.frequency ? (FREQUENCY_TO_DB[body.frequency] ?? null) : null);
    if (body.nextService !== undefined) set('nextService', toDate(body.nextService));
    if (body.priority !== undefined) set('priority', body.priority ? (PRIORITY_TO_DB[body.priority] ?? null) : null);
    if (body.assetValue !== undefined) set('assetValue', body.assetValue !== null && body.assetValue !== '' ? Number(body.assetValue) : null);
    if (body.depMethod !== undefined) set('depMethod', body.depMethod ? DEP_METHOD_TO_DB[body.depMethod] ?? null : null);

    return data;
  },

  // DB row (with `createdBy` User relation optionally included) -> the exact shape
  // master-frontend/src/features/asset/asset/types/types.ts#Asset expects.
  toDTO(row: any) {
    return {
      id: row.id,
      sn: row.assetCode,
      firmId: row.firmId ? String(row.firmId) : null,
      firmName: row.firm?.firm_name ?? '',
      productName: row.productName,
      category: CATEGORY_FROM_DB[row.category as AssetCategory] ?? row.category,
      type: TYPE_FROM_DB[row.type as AssetType] ?? row.type,
      brand: row.brand ?? '',
      model: row.model ?? '',
      serialNo: row.serialNo ?? '',
      sku: row.sku ?? '',
      mfgDate: dateToStr(row.mfgDate),
      origin: row.origin ?? '',
      status: STATUS_FROM_DB[row.status as AssetStatus] ?? row.status,
      assetDate: dateToStr(row.assetDate),
      invoiceNo: row.invoiceNo ?? '',
      cost: decimalToNumber(row.cost),
      quantity: row.quantity ?? 0,
      supplierName: row.supplierName ?? '',
      supplierPhone: row.supplierPhone ?? '',
      paymentMode: row.paymentMode ?? '',
      location: row.location ?? '',
      department: row.department ?? '',
      assignedTo: row.assignedTo ?? '',
      responsiblePerson: row.responsiblePerson ?? '',
      warrantyAvailable: row.warrantyAvailable ? 'Yes' : 'No',
      warrantyEnd: dateToStr(row.warrantyEnd),
      amc: row.amcActive ? 'Yes' : 'No',
      amcEnd: dateToStr(row.amcEnd),
      maintenanceRequired: row.maintenanceRequired ? 'Yes' : 'No',
      maintenanceType: row.maintenanceType ?? '',
      frequency: row.frequency ? (FREQUENCY_FROM_DB[row.frequency as PlanFrequency] ?? row.frequency) : '',
      maintenanceCount: row.maintenanceCount ?? 0,
      lastMaintenanceDate: dateToStr(row.lastMaintenanceDate),
      nextService: dateToStr(row.nextService),
      priority: row.priority ? PRIORITY_FROM_DB[row.priority as Priority] ?? '' : '',
      repairCount: row.repairCount ?? 0,
      lastRepairDate: dateToStr(row.lastRepairDate),
      repairCost: decimalToNumber(row.lastRepairCost),
      partChanged: row.partsChanged ? 'Yes' : 'No',
      partNames: Array.isArray(row.partNames) ? row.partNames : [],
      totalRepairCost: decimalToNumber(row.totalRepairCost),
      assetValue: decimalToNumber(row.assetValue),
      depMethod: row.depMethod ? DEP_METHOD_FROM_DB[row.depMethod as DepreciationMethod] ?? '' : '',
      createdBy: row.createdBy?.name || row.createdBy?.user_name || row.responsiblePerson || (row.createdById ? 'Admin' : ''),
    };
  },
};

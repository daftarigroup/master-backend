import { parseBigIntId } from '../../../utils/firmScope';
import { decimalToNumber, decimalToNumberOrNull, dateToISO, dateToISODate } from './mapUtils';
import { workOrderMapper } from './workOrder.mapper';

// Machine's frontend type ("aligned with EMMS backend schema", machines/types/types.ts)
// already uses the same UPPER_SNAKE category/status enums and camelCase field names
// as this schema — so unlike Asset, this is mostly a pass-through/reshape, not a
// vocabulary translation.

/** '' / null / undefined -> null; a bigint or numeric id -> bigint; junk ('all', 'abc') -> 400, never a 500. */
const big = (v: unknown, label: string): bigint | null => {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'bigint' ? v : parseBigIntId(v, label);
};

export const machineMapper = {
  toDTO(row: any) {
    return {
      id: row.id,
      tenantId: row.firmId ? String(row.firmId) : '1',
      firmId: row.firmId ? String(row.firmId) : null,
      firm: row.firm ? { id: String(row.firm.id), name: row.firm.firm_name } : null,
      firmName: row.firm?.firm_name ?? null,
      assignment: row.assignments?.[0]
        ? {
            id: String(row.assignments[0].id),
            firmId: String(row.assignments[0].firmId),
            firmName: row.assignments[0].firm?.firm_name ?? null,
            firm: row.assignments[0].firm ? { id: String(row.assignments[0].firm.id), name: row.assignments[0].firm.firm_name } : null,
            user: row.assignments[0].responsible
              ? {
                  id: String(row.assignments[0].responsible.id),
                  name: row.assignments[0].responsible.name ?? '',
                  email: row.assignments[0].responsible.employee?.email ?? '',
                }
              : null,
          }
        : null,
      assignments: row.assignments
        ? row.assignments.map((a: any) => ({
            id: String(a.id),
            firmId: String(a.firmId),
            firmName: a.firm?.firm_name ?? null,
            firm: a.firm ? { id: String(a.firm.id), name: a.firm.firm_name } : null,
            user: a.responsible
              ? {
                  id: String(a.responsible.id),
                  name: a.responsible.name ?? '',
                  email: a.responsible.employee?.email ?? '',
                }
              : null,
          }))
        : undefined,
      departmentId: row.departmentId ? String(row.departmentId) : null,
      department: row.department ? { id: String(row.department.id), name: row.department.name } : null,
      name: row.name,
      assetCode: row.assetCode,
      qrCode: row.qrCode,
      serialNumber: row.serialNumber,
      modelNumber: row.modelNumber,
      manufacturer: row.manufacturer,
      supplier: row.supplier,
      category: row.category,
      subCategory: row.subCategory,
      criticalityLevel: row.criticalityLevel,
      location: row.location,
      locationCode: row.locationCode,
      purchaseDate: dateToISODate(row.purchaseDate),
      purchasePrice: decimalToNumberOrNull(row.purchasePrice),
      installationDate: dateToISODate(row.installationDate),
      warrantyExpiry: dateToISODate(row.warrantyExpiry),
      status: row.status,
      statusChangedAt: dateToISO(row.statusChangedAt),
      runningHours: decimalToNumber(row.runningHours), // deprecated: superseded by openingReading + usage logs
      // fleet_v1: ownership and reading basis
      ownershipType: row.ownershipType,
      equipmentType: row.equipmentType,
      readingUnit: row.readingUnit,
      openingReading: decimalToNumber(row.openingReading),
      expectedConsumption: decimalToNumberOrNull(row.expectedConsumption),
      maxUsagePerEntry: decimalToNumberOrNull(row.maxUsagePerEntry),
      registrationNo: row.registrationNo ?? null,
      capacityLabel: row.capacityLabel ?? null,
      siteLocationId: row.siteLocationId ? String(row.siteLocationId) : null,
      siteLocation: row.siteLocation ? { id: String(row.siteLocation.id), location: row.siteLocation.location } : null,
      rentalStartAt: dateToISO(row.rentalStartAt),
      rentalEndAt: dateToISO(row.rentalEndAt),
      rentalVendorId: row.rentalVendorId ?? null,
      rentalVendorName: row.rentalVendorName ?? null,
      hireType: row.hireType ?? null,
      specifications: row.specifications ?? null,
      isActive: row.isActive,
      imageUrl: row.imageUrl,
      documentUrls: row.documentUrls ?? [],
      createdAt: dateToISO(row.createdAt),
      updatedAt: dateToISO(row.updatedAt),
      parts: row.parts ? row.parts.map(machinePartMapper.toDTO) : undefined,
      maintenancePlans: row.maintenancePlans,
      breakdownReports: row.breakdownReports,
      workOrders: row.workOrders ? row.workOrders.map(workOrderMapper.toDTO) : undefined,
      _count: row._count
        ? {
            workOrders: row._count.workOrders,
            breakdownReports: row._count.breakdownReports,
            downTimeLogs: 0,
            parts: row._count.parts,
            maintenancePlans: row._count.maintenancePlans,
          }
        : undefined,
    };
  },

  toPrismaCreate(body: Record<string, any>) {
    const warranty = body.warrantyExpiry ?? body.warrantyExpiration;
    return {
      name: body.name,
      category: body.category ?? 'PRODUCTION',
      firmId: big(body.firmId ?? body.projectId, 'firmId'),
      departmentId: big(body.departmentId, 'departmentId'),
      siteLocationId: big(body.siteLocationId, 'siteLocationId'),
      serialNumber: body.serialNumber ?? null,
      modelNumber: body.modelNumber ?? null,
      manufacturer: body.manufacturer ?? null,
      supplier: body.supplier ?? body.vendor ?? null,
      subCategory: body.subCategory ?? null,
      criticalityLevel: body.criticalityLevel ?? 1,
      location: body.location ?? null,
      locationCode: body.locationCode ?? null,
      purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null,
      purchasePrice: body.purchasePrice ?? null,
      installationDate: body.installationDate ? new Date(body.installationDate) : null,
      warrantyExpiry: warranty ? new Date(warranty) : null, // (was a precedence bug: `a ?? b ? x : null`)
      imageUrl: body.imageUrl ?? null,
      // documentUrls is deprecated (fleet_v4_documents): files go to machine_documents via documentService.registerMachineFormFiles
      specifications: Array.isArray(body.additionalSpecifications)
        ? Object.fromEntries(body.additionalSpecifications.map((s: any) => [s.name, s.value]))
        : undefined,
    };
  },

  toPrismaUpdate(body: Record<string, any>) {
    const data: Record<string, any> = {};
    const set = (key: string, value: any) => {
      if (value !== undefined) data[key] = value;
    };
    set('name', body.name);
    set('category', body.category);
    if (body.firmId !== undefined || body.projectId !== undefined) {
      set('firmId', big(body.firmId ?? body.projectId, 'firmId'));
    }
    if (body.departmentId !== undefined) set('departmentId', big(body.departmentId, 'departmentId'));
    if (body.siteLocationId !== undefined) set('siteLocationId', big(body.siteLocationId, 'siteLocationId'));
    set('serialNumber', body.serialNumber);
    set('modelNumber', body.modelNumber);
    set('manufacturer', body.manufacturer);
    if (body.supplier !== undefined || body.vendor !== undefined) set('supplier', body.supplier ?? body.vendor ?? null);
    set('subCategory', body.subCategory);
    set('criticalityLevel', body.criticalityLevel);
    set('location', body.location);
    set('locationCode', body.locationCode);
    set('registrationNo', body.registrationNo);
    if (body.purchaseDate !== undefined) set('purchaseDate', body.purchaseDate ? new Date(body.purchaseDate) : null);
    set('purchasePrice', body.purchasePrice);
    if (body.installationDate !== undefined) set('installationDate', body.installationDate ? new Date(body.installationDate) : null);
    if (body.warrantyExpiry !== undefined || body.warrantyExpiration !== undefined) {
      const v = body.warrantyExpiry ?? body.warrantyExpiration;
      set('warrantyExpiry', v ? new Date(v) : null);
    }
    set('imageUrl', body.imageUrl);
    if (body.status !== undefined) {
      data.status = body.status;
      data.statusChangedAt = new Date();
    }
    // fleet_v1
    set('equipmentType', body.equipmentType);
    set('readingUnit', body.readingUnit);
    set('openingReading', body.openingReading);
    set('expectedConsumption', body.expectedConsumption);
    set('maxUsagePerEntry', body.maxUsagePerEntry);
    set('capacityLabel', body.capacityLabel);
    if (body.rentalStartAt !== undefined) set('rentalStartAt', body.rentalStartAt ? new Date(body.rentalStartAt) : null);
    if (body.rentalEndAt !== undefined) set('rentalEndAt', body.rentalEndAt ? new Date(body.rentalEndAt) : null);
    set('rentalVendorId', body.rentalVendorId);
    set('rentalVendorName', body.rentalVendorName);
    set('hireType', body.hireType);
    return data;
  },
};

export const machinePartMapper = {
  toDTO(row: any) {
    return {
      id: row.id,
      tenantId: '1',
      machineId: row.machineId,
      machine: row.machine ? { id: row.machine.id, name: row.machine.name, assetCode: row.machine.assetCode } : undefined,
      name: row.name,
      partNumber: row.partNumber,
      description: row.description,
      imageUrl: row.imageUrl,
      isActive: row.isActive,
      createdAt: dateToISO(row.createdAt),
      updatedAt: dateToISO(row.updatedAt),
      workOrders: row.workOrders,
      breakdowns: row.breakdowns,
    };
  },
};

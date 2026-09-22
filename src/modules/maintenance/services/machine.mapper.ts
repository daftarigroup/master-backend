import { decimalToNumber, decimalToNumberOrNull, dateToISO, dateToISODate } from './mapUtils';

// Machine's frontend type ("aligned with EMMS backend schema", machines/types/types.ts)
// already uses the same UPPER_SNAKE category/status enums and camelCase field names
// as this schema — so unlike Asset, this is mostly a pass-through/reshape, not a
// vocabulary translation.
export const machineMapper = {
  toDTO(row: any) {
    return {
      id: row.id,
      tenantId: row.firmId ? String(row.firmId) : '1',
      firmId: row.firmId ? String(row.firmId) : null,
      firm: row.firm ? { id: String(row.firm.id), name: row.firm.firm_name } : null,
      firmName: row.firm?.firm_name ?? null,
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
      runningHours: decimalToNumber(row.runningHours),
      specifications: row.specifications ?? null,
      isActive: row.isActive,
      imageUrl: row.imageUrl,
      documentUrls: row.documentUrls ?? [],
      createdAt: dateToISO(row.createdAt),
      updatedAt: dateToISO(row.updatedAt),
      parts: row.parts ? row.parts.map(machinePartMapper.toDTO) : undefined,
      maintenancePlans: row.maintenancePlans,
      breakdownReports: row.breakdownReports,
      workOrders: row.workOrders,
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
    return {
      name: body.name,
      category: body.category,
      firmId: body.firmId ? BigInt(body.firmId) : (body.projectId ? BigInt(body.projectId) : null),
      departmentId: body.departmentId ? BigInt(body.departmentId) : null,
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
      warrantyExpiry: body.warrantyExpiry ?? body.warrantyExpiration ? new Date(body.warrantyExpiry ?? body.warrantyExpiration) : null,
      imageUrl: body.imageUrl ?? null,
      documentUrls: [
        ...(Array.isArray(body.documentUrls) ? body.documentUrls : []),
        ...(body.userManualUrl ? [body.userManualUrl] : []),
        ...(body.specificationsSheetUrl ? [body.specificationsSheetUrl] : []),
      ],
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
      const f = body.firmId ?? body.projectId;
      set('firmId', f ? BigInt(f) : null);
    }
    if (body.departmentId !== undefined) set('departmentId', body.departmentId ? BigInt(body.departmentId) : null);
    set('serialNumber', body.serialNumber);
    set('modelNumber', body.modelNumber);
    set('manufacturer', body.manufacturer);
    if (body.supplier !== undefined || body.vendor !== undefined) set('supplier', body.supplier ?? body.vendor ?? null);
    set('subCategory', body.subCategory);
    set('criticalityLevel', body.criticalityLevel);
    set('location', body.location);
    set('locationCode', body.locationCode);
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
    if (Array.isArray(body.documentUrls)) set('documentUrls', body.documentUrls);
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
    };
  },
};

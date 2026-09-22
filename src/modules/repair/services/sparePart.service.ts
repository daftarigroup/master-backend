import { prisma } from '../../../database/prisma';
import { decimalToNumber } from './mapUtils';

// Matches mockRepairStore.ts#PartAndVendor — the spares master/inventory, also
// consumed at repair-completion time via RepairIndentPart.
function toDTO(row: any) {
  return {
    id: row.id,
    partName: row.partName,
    partCode: row.partCode ?? '',
    machineType: row.machineType ?? '',
    vendorName: row.vendor?.name ?? '',
    unitPrice: decimalToNumber(row.unitPrice),
    stockQty: row.stockQty,
    minStockQty: row.minStockQty,
    unit: row.unit ?? '',
    description: row.description ?? '',
  };
}

export const sparePartService = {
  async list() {
    const rows = await prisma.sparePart.findMany({ include: { vendor: true }, orderBy: { partName: 'asc' } });
    return rows.map(toDTO);
  },

  async create(data: { partName: string; partCode?: string; machineType?: string; vendorName?: string; vendorId?: string; unitPrice?: number; stockQty?: number; minStockQty?: number; unit?: string; description?: string }) {
    let vendorId = data.vendorId ?? null;
    if (!vendorId && data.vendorName) {
      const vendor = await prisma.repairVendor.findFirst({ where: { name: data.vendorName } });
      vendorId = vendor?.id ?? null;
    }
    const row = await prisma.sparePart.create({
      data: {
        partName: data.partName || 'Spare Part',
        partCode: data.partCode ?? `PRT-${Date.now().toString().slice(-6)}`,
        machineType: data.machineType ?? null,
        vendorId,
        unitPrice: data.unitPrice ?? 0,
        stockQty: data.stockQty ?? 0,
        minStockQty: data.minStockQty ?? 1,
        unit: data.unit ?? 'Pcs',
        description: data.description ?? null,
      },
      include: { vendor: true },
    });
    return toDTO(row);
  },

  async uniqueVendorNames() {
    const vendors = await prisma.repairVendor.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    return vendors.map((v) => v.name);
  },

  async uniquePartNames() {
    const parts = await prisma.sparePart.findMany({ select: { partName: true }, orderBy: { partName: 'asc' } });
    return parts.map((p) => p.partName);
  },

  async uniqueMachineTypes() {
    const parts = await prisma.sparePart.findMany({ select: { machineType: true }, distinct: ['machineType'] });
    return parts.filter((p) => p.machineType).map((p) => ({ type_name: p.machineType as string }));
  },

  async delete(id: string) {
    await prisma.sparePart.delete({ where: { id } });
  },
};

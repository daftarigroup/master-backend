import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';

// Matches mockRepairStore.ts#Vendor / repairSystemApi.ts#Vendor exactly.
function toDTO(row: any) {
  return {
    id: row.id,
    name: row.name,
    type: row.type ?? '',
    gstNumber: row.gstNumber ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    mobileNumber: row.mobileNumber ?? '',
    contactName: row.contactName ?? '',
  };
}

export const vendorService = {
  async list() {
    const rows = await prisma.repairVendor.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toDTO);
  },

  async create(data: { name: string; type?: string; gstNumber?: string; email?: string; address?: string; mobileNumber?: string; contactName?: string }) {
    if (!data.name?.trim()) throw ApiError.badRequest('name is required');
    const row = await prisma.repairVendor.create({
      data: {
        name: data.name.trim(),
        type: data.type ?? 'Spares Supplier',
        gstNumber: data.gstNumber ?? null,
        email: data.email ?? null,
        address: data.address ?? null,
        mobileNumber: data.mobileNumber ?? null,
        contactName: data.contactName ?? null,
      },
    });
    return toDTO(row);
  },
};

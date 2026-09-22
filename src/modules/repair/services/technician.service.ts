import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { paginationMeta, parsePagination } from './mapUtils';

// Matches repairSystemApi.ts#Technician — replaces the frontend's hardcoded
// 3-technician stub (getAllTechnicians/createTechnician never actually persisted).
function toDTO(row: any) {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact ?? undefined,
    whatsapp: row.whatsapp ?? undefined,
    department: row.department?.name ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt?.toISOString(),
  };
}

export const technicianService = {
  async list() {
    const rows = await prisma.technician.findMany({ where: { isActive: true }, include: { department: true }, orderBy: { name: 'asc' } });
    return rows.map(toDTO);
  },

  async page(query: Record<string, any>) {
    const { page, limit, skip } = parsePagination(query);
    const where = query.search ? { name: { contains: String(query.search), mode: 'insensitive' as const } } : {};
    const [rows, total] = await Promise.all([
      prisma.technician.findMany({ where, include: { department: true }, orderBy: { name: 'asc' }, skip, take: limit }),
      prisma.technician.count({ where }),
    ]);
    const { totalPages } = paginationMeta(page, limit, total);
    return { items: rows.map(toDTO), total, totalPages };
  },

  async create(data: { name: string; contact?: string; whatsapp?: string; departmentId?: string }) {
    if (!data.name?.trim()) throw ApiError.badRequest('name is required');
    const row = await prisma.technician.create({
      data: {
        name: data.name.trim(),
        contact: data.contact ?? null,
        whatsapp: data.whatsapp ?? null,
        departmentId: data.departmentId ? BigInt(data.departmentId) : null,
      },
      include: { department: true },
    });
    return toDTO(row);
  },

  async update(id: string, data: { name?: string; contact?: string; whatsapp?: string; isActive?: boolean }) {
    const row = await prisma.technician.update({ where: { id }, data, include: { department: true } });
    return toDTO(row);
  },

  async delete(id: string) {
    // Soft-delete — technicians stay referenced by historical RepairIndent rows.
    await prisma.technician.update({ where: { id }, data: { isActive: false } });
  },
};

import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';

// Matches activityTypes/types/types.ts#ActivityType exactly (tenantId is a display
// artifact of the multi-tenant frontend — we surface firmId in its place).
function toDTO(row: any) {
  return { id: row.id, tenantId: row.firmId ? String(row.firmId) : '1', name: row.name, code: row.code, isSystem: row.isSystem };
}

export const activityTypeService = {
  async list() {
    let rows = await prisma.activityType.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
    const hasRepair = rows.some((r) => r.code === 'REPAIR' || r.name?.toLowerCase() === 'repair');
    if (!hasRepair) {
      try {
        const created = await prisma.activityType.create({
          data: { name: 'Repair', code: 'REPAIR', isSystem: true },
        });
        rows = [created, ...rows];
      } catch (_e) {
        // Ignore unique collision in race conditions
      }
    }
    return rows.map(toDTO);
  },

  async create(name: string) {
    const trimmed = name?.trim();
    if (!trimmed) throw ApiError.badRequest('name is required');
    const row = await prisma.activityType.create({ data: { name: trimmed } });
    return toDTO(row);
  },

  async delete(id: string) {
    const row = await prisma.activityType.findUnique({ where: { id } });
    if (!row) throw ApiError.notFound('Activity type not found');
    if (row.isSystem) throw ApiError.badRequest('System activity types cannot be deleted');
    await prisma.activityType.delete({ where: { id } });
  },
};

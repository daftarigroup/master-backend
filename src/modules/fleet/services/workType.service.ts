// Work types: a short per-firm lookup (Excavation, Backfilling, ...) for the Work Type field of a work log. A firm that has none yet
// gets the default set the first time its list is read; an admin can add and retire types.
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable, requireSingleFirm } from '../../../utils/firmScope';
import { isAdminRole } from '../../../middleware/requireCostAccess';
import { isUniqueViolation } from './common';

export const DEFAULT_WORK_TYPES = ['Excavation', 'Backfilling', 'Loading', 'Hauling', 'Levelling', 'Lifting', 'Pumping', 'Other'];

const map = (w: { id: string; name: string; sortOrder: number; isActive: boolean }) => ({ id: w.id, name: w.name, sortOrder: w.sortOrder, isActive: w.isActive });

export const workTypeService = {
  async list(ctx: UserAuthContext, firmIdInput: unknown, includeInactive = false) {
    const firmId = requireSingleFirm(ctx, firmIdInput);
    const count = await prisma.workType.count({ where: { firmId } });
    if (count === 0) {
      await prisma.workType.createMany({ data: DEFAULT_WORK_TYPES.map((name, i) => ({ firmId, name, sortOrder: i + 1 })), skipDuplicates: true });
    }
    const rows = await prisma.workType.findMany({ where: { firmId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return rows.map(map);
  },

  async create(ctx: UserAuthContext, body: { firmId: bigint; name: string }) {
    if (!isAdminRole(ctx.role)) throw ApiError.forbidden('Only an admin can add work types');
    assertFirmWritable(ctx, body.firmId);
    const last = await prisma.workType.aggregate({ where: { firmId: body.firmId }, _max: { sortOrder: true } });
    try {
      return map(await prisma.workType.create({ data: { firmId: body.firmId, name: body.name.trim(), sortOrder: (last._max.sortOrder ?? 0) + 1 } }));
    } catch (e) {
      if (isUniqueViolation(e)) throw ApiError.conflict(`Work type "${body.name}" already exists`);
      throw e;
    }
  },

  async update(ctx: UserAuthContext, id: string, body: { name?: string; isActive?: boolean; sortOrder?: number }) {
    if (!isAdminRole(ctx.role)) throw ApiError.forbidden('Only an admin can change work types');
    const row = await prisma.workType.findUnique({ where: { id } });
    if (!row) throw ApiError.notFound('Work type not found');
    assertFirmWritable(ctx, row.firmId);
    try {
      return map(await prisma.workType.update({ where: { id }, data: { ...(body.name ? { name: body.name.trim() } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}), ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}) } }));
    } catch (e) {
      if (isUniqueViolation(e)) throw ApiError.conflict('A work type with that name already exists');
      throw e;
    }
  },
};

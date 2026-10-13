import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable, firmWhere } from '../../../utils/firmScope';
import { Db, isUniqueViolation, scopeOf } from './common';

/** A WBS activity that usage, diesel or a cost entry may be tagged to: same firm, and still open. */
export async function assertWbsUsable(db: Db, firmId: bigint, wbsActivityId: string | null | undefined): Promise<string | null> {
  if (!wbsActivityId) return null;
  const row = await db.wbsActivity.findFirst({ where: { id: wbsActivityId, firmId }, select: { status: true } });
  if (!row) throw ApiError.badRequest('Unknown WBS activity for this firm');
  if (row.status !== 'ACTIVE') throw ApiError.badRequest('This WBS activity is closed');
  return wbsActivityId;
}

const map = (w: Prisma.WbsActivityGetPayload<object>) => ({
  id: w.id,
  firmId: String(w.firmId),
  code: w.code,
  name: w.name,
  parentId: w.parentId,
  status: w.status,
  siteLocationId: w.siteLocationId ? String(w.siteLocationId) : null,
});

export const wbsService = {
  /** Readable by everyone who can open Daily Entry: a WBS code is not cost data. */
  async list(ctx: UserAuthContext, q: { firmId?: unknown; includeClosed?: boolean; q?: string }) {
    const rows = await prisma.wbsActivity.findMany({
      where: {
        ...firmWhere(scopeOf(ctx, q.firmId)),
        ...(q.includeClosed ? {} : { status: 'ACTIVE' }),
        ...(q.q ? { OR: [{ code: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { code: 'asc' },
      take: 500,
    });
    return rows.map(map);
  },

  async create(ctx: UserAuthContext, body: { firmId: bigint; code: string; name: string; parentId?: string | null; siteLocationId?: bigint | null }) {
    assertFirmWritable(ctx, body.firmId);
    if (body.parentId) {
      const parent = await prisma.wbsActivity.findFirst({ where: { id: body.parentId, firmId: body.firmId } });
      if (!parent) throw ApiError.badRequest('Unknown parent activity');
    }
    try {
      return map(
        await prisma.wbsActivity.create({
          data: { firmId: body.firmId, code: body.code, name: body.name, parentId: body.parentId ?? null, siteLocationId: body.siteLocationId ?? null },
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw ApiError.conflict(`Activity code ${body.code} already exists for this firm`);
      throw e;
    }
  },

  async update(ctx: UserAuthContext, id: string, body: { name?: string; status?: 'ACTIVE' | 'CLOSED' }) {
    const row = await prisma.wbsActivity.findFirst({ where: { id, ...firmWhere(scopeOf(ctx)) } });
    if (!row) throw ApiError.notFound('WBS activity not found');
    assertFirmWritable(ctx, row.firmId);
    return map(await prisma.wbsActivity.update({ where: { id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.status ? { status: body.status } : {}) } }));
  },
};

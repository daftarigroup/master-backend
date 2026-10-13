import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable, firmWhere } from '../../../utils/firmScope';
import { toIstDateString } from '../lib/istDate';
import { canViewCost } from '../../../middleware/requireCostAccess';
import { num, pageOf, requireUserId, scopeOf } from './common';

export const dieselReceiptService = {
  async list(ctx: UserAuthContext, q: { firmId?: unknown; from?: string; to?: string; includeVoided?: boolean; limit?: number; offset?: number }) {
    const where: Prisma.DieselReceiptWhereInput = {
      ...firmWhere(scopeOf(ctx, q.firmId)),
      ...(q.from || q.to
        ? { receiptDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
      ...(q.includeVoided ? {} : { voidedAt: null }),
    };
    const { take, skip } = pageOf(q);
    const [rows, total] = await Promise.all([
      prisma.dieselReceipt.findMany({ where, orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }], take, skip }),
      prisma.dieselReceipt.count({ where }),
    ]);
    const withCost = await canViewCost(ctx);
    return { total, rows: rows.map((r) => mapReceipt(r, withCost)) };
  },

  async void(ctx: UserAuthContext, id: string, reason: string) {
    const userId = requireUserId(ctx);
    const row = await prisma.dieselReceipt.findFirst({ where: { id, ...firmWhere(scopeOf(ctx)) } });
    if (!row) throw ApiError.notFound('Receipt not found');
    assertFirmWritable(ctx, row.firmId);
    if (row.voidedAt) throw ApiError.conflict('Already voided');
    await prisma.dieselReceipt.update({ where: { id }, data: { voidedAt: new Date(), voidedById: userId, voidReason: reason } });
    return { id, voided: true };
  },

};

function mapReceipt(r: Prisma.DieselReceiptGetPayload<object>, withCost = false) {
  return {
    ...(withCost ? { ratePerLitre: num(r.ratePerLitre), totalAmount: num(r.totalAmount) } : {}),
    id: r.id,
    firmId: String(r.firmId),
    kind: r.kind,
    source: (r as any).source ?? 'MANUAL',
    externalRef: (r as any).externalRef ?? null,
    issuerName: (r as any).issuerName ?? null,
    receivedAt: r.receivedAt.toISOString(),
    receiptDate: toIstDateString(r.receivedAt),
    litres: num(r.litres),
    supplierName: r.supplierName,
    reference: r.reference,
    note: r.note,
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidReason: r.voidReason,
  };
}

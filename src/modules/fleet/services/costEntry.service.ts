import { CostEntryCategory } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable, firmWhere } from '../../../utils/firmScope';
import { loadMachineInScope, num, requireUserId, resolveMachineWriteFirm, scopeOf } from './common';
import { assertWbsUsable } from './wbs.service';

export interface CostEntryBody {
  machineId: string;
  costDate: string; // IST day
  category: CostEntryCategory;
  amount: number;
  wbsActivityId?: string | null;
  description?: string | null;
  attachmentUrl?: string | null;
}

const map = (r: { id: string; machineId: string; costDate: Date; category: CostEntryCategory; amount: unknown; description: string | null; wbsActivityId: string | null }) => ({
  id: r.id, machineId: r.machineId, date: r.costDate.toISOString().slice(0, 10), category: r.category, amount: num(r.amount as never), description: r.description, wbsActivityId: r.wbsActivityId,
});

export const costEntryService = {
  async create(ctx: UserAuthContext, body: CostEntryBody) {
    const userId = requireUserId(ctx);
    const machine = await loadMachineInScope(prisma, ctx, body.machineId);
    // booked to the firm the machine is working for today (its active assignment), else its owner
    const firmId = await resolveMachineWriteFirm(prisma, ctx, machine, null);
    if (body.category === 'RENTAL_INVOICE' && machine.ownershipType !== 'RENTED') throw ApiError.badRequest('A rental invoice only applies to a rented machine');
    await assertWbsUsable(prisma, firmId, body.wbsActivityId);
    return map(
      await prisma.machineCostEntry.create({
        data: {
          firmId,
          machineId: machine.id,
          costDate: new Date(body.costDate),
          category: body.category,
          amount: body.amount,
          wbsActivityId: body.wbsActivityId ?? null,
          description: body.description?.trim() || null,
          attachmentUrl: body.attachmentUrl?.trim() || null,
          createdById: userId,
        },
      }),
    );
  },

  async update(ctx: UserAuthContext, id: string, body: Partial<Omit<CostEntryBody, 'machineId'>>) {
    const row = await prisma.machineCostEntry.findFirst({ where: { id, ...firmWhere(scopeOf(ctx)) } });
    if (!row) throw ApiError.notFound('Cost entry not found');
    assertFirmWritable(ctx, row.firmId);
    if (row.voidedAt) throw ApiError.conflict('A voided entry cannot be edited');
    if (body.category === 'RENTAL_INVOICE') {
      const machine = await prisma.machine.findUniqueOrThrow({ where: { id: row.machineId }, select: { ownershipType: true } });
      if (machine.ownershipType !== 'RENTED') throw ApiError.badRequest('A rental invoice only applies to a rented machine');
    }
    if (body.wbsActivityId !== undefined) await assertWbsUsable(prisma, row.firmId, body.wbsActivityId);
    return map(
      await prisma.machineCostEntry.update({
        where: { id },
        data: {
          ...(body.costDate ? { costDate: new Date(body.costDate) } : {}),
          ...(body.category ? { category: body.category } : {}),
          ...(body.amount !== undefined ? { amount: body.amount } : {}),
          ...(body.wbsActivityId !== undefined ? { wbsActivityId: body.wbsActivityId } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(body.attachmentUrl !== undefined ? { attachmentUrl: body.attachmentUrl?.trim() || null } : {}),
        },
      }),
    );
  },

  /** Voided entries are excluded everywhere (tiles, tabs, exports). */
  async void(ctx: UserAuthContext, id: string, reason: string) {
    const userId = requireUserId(ctx);
    const row = await prisma.machineCostEntry.findFirst({ where: { id, ...firmWhere(scopeOf(ctx)) } });
    if (!row) throw ApiError.notFound('Cost entry not found');
    assertFirmWritable(ctx, row.firmId);
    if (row.voidedAt) throw ApiError.conflict('Already voided');
    await prisma.machineCostEntry.update({ where: { id }, data: { voidedAt: new Date(), voidedById: userId, voidReason: reason } });
    return { id, voided: true };
  },
};

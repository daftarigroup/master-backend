import { OutsourceStatus, Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable } from '../../../utils/firmScope';
import { workOrderMapper } from './workOrder.mapper';
import { WORK_ORDER_INCLUDE } from '../repositories/workOrder.repository';
import { adjustRolledUpCost, applyRepairRollupOnce } from './repairRollup';
import { canSeeFirm, resolveVendorId } from './workOrder.service';
import { documentService } from '../../fleet/services/document.service';

type Tx = Prisma.TransactionClient;

// The simplified outsourced-repair track on a work order, replacing the four-stage indent -> dispatch ->
// store-in -> payment pipeline:   TO_SEND -> SENT -> RECEIVED -> PAID
//   send     vendor + date the machine left
//   receive  date it came back, bill number, bill amount, bill photo   (the machine is back: rollups apply here)
//   pay      date paid (and the amount, if it differs from the bill)
// Transporter, vehicle, driver, weighment slip, inspection, bill type, partial payments and competing vendor
// offers are intentionally not captured (plan §D.2); old records stay readable in the legacy tables.

const NEXT: Record<'send' | 'receive' | 'pay', { from: OutsourceStatus; to: OutsourceStatus; label: string }> = {
  send: { from: 'TO_SEND', to: 'SENT', label: 'sent to the vendor' },
  receive: { from: 'SENT', to: 'RECEIVED', label: 'received back' },
  pay: { from: 'RECEIVED', to: 'PAID', label: 'paid' },
};

async function loadForTransition(tx: Tx, ctx: UserAuthContext, id: string, step: keyof typeof NEXT) {
  const wo = await tx.maintenanceWorkOrder.findUnique({ where: { id }, include: { machine: { select: { firmId: true, assetId: true } }, repairParts: { select: { id: true } } } });
  const firmId = wo?.firmId ?? wo?.machine.firmId ?? null;
  // another firm's work order is a 404: its existence is not disclosed
  if (!wo || !canSeeFirm(ctx, firmId)) throw ApiError.notFound('Work order not found');
  if (firmId !== null) assertFirmWritable(ctx, firmId);
  else if (ctx.role !== 'SUPER_ADMIN') throw ApiError.forbidden('Only a super admin can change a work order that has no firm');

  const rule = NEXT[step];
  if (wo.outsourceStatus === null) throw ApiError.conflict('This work order is not outsourced');
  if (wo.outsourceStatus !== rule.from) {
    throw new ApiError(409, `This job is ${wo.outsourceStatus}; it can only be ${rule.label} from ${rule.from}.`, ['WRONG_OUTSOURCE_STATE', wo.outsourceStatus]);
  }
  return wo;
}

/**
 * The old Sent Machines / Store In / Payment screens advance an out-source job through the RepairIndent tables. While
 * they still exist, every stage they record is mirrored onto the linked work order so there is ONE source of truth
 * for the job's state and ONE place that rolls the repair up (repairRollup.ts). Returns false when the indent has no
 * work order (a standalone legacy indent), so the caller can keep its old behaviour for those.
 */
export async function syncWorkOrderFromIndent(
  tx: Tx,
  indentId: string,
  stage: 'SENT' | 'RECEIVED' | 'PAID',
  data: { at?: Date; billNo?: string | null; billUrl?: string | null; amount?: number | null },
): Promise<boolean> {
  const indent = await tx.repairIndent.findUnique({ where: { id: indentId }, select: { workOrderId: true } });
  if (!indent?.workOrderId) return false;
  const wo = await tx.maintenanceWorkOrder.findUnique({ where: { id: indent.workOrderId }, include: { repairParts: { select: { id: true } } } });
  if (!wo) return false;
  const at = data.at ?? new Date();
  const billed = wo.cost === null ? 0 : Number(wo.cost);

  if (stage === 'SENT') {
    await tx.maintenanceWorkOrder.update({ where: { id: wo.id }, data: { outsourceStatus: 'SENT', sentAt: at } });
  } else if (stage === 'RECEIVED') {
    const amount = data.amount ?? billed;
    await tx.maintenanceWorkOrder.update({
      where: { id: wo.id },
      data: { outsourceStatus: 'RECEIVED', receivedAt: at, cost: amount, ...(data.billNo ? { billNo: data.billNo } : {}), ...(data.billUrl ? { billUrl: data.billUrl } : {}) },
    });
    await applyRepairRollupOnce(tx, wo, amount, wo.repairParts.length > 0);
    await documentService.mirrorWorkOrderFile(tx, { workOrderId: wo.id, field: 'billUrl', url: data.billUrl, actorId: null });
  } else {
    const paid = data.amount ?? billed;
    // Normally already rolled up when the machine was received. If this step is reached first it is rolled up now,
    // otherwise only the difference between the bill and what was paid is corrected.
    const applied = await applyRepairRollupOnce(tx, wo, paid, wo.repairParts.length > 0);
    if (!applied) await adjustRolledUpCost(tx, wo.machineId, billed, paid);
    await tx.maintenanceWorkOrder.update({ where: { id: wo.id }, data: { outsourceStatus: 'PAID', paidAt: at, cost: paid } });
  }
  return true;
}

export const outsourceService = {
  async send(ctx: UserAuthContext, id: string, body: { vendorId?: string | null; vendorName?: string | null; sentAt?: Date | null }) {
    return prisma.$transaction(async (tx) => {
      const wo = await loadForTransition(tx, ctx, id, 'send');
      let vendorId = wo.vendorId;
      if (body.vendorId) {
        const v = await tx.repairVendor.findUnique({ where: { id: body.vendorId }, select: { id: true } });
        if (!v) throw ApiError.badRequest('Unknown vendor');
        vendorId = v.id;
      } else if (body.vendorName?.trim()) {
        vendorId = await resolveVendorId(tx, body.vendorName);
      }
      if (!vendorId) throw ApiError.badRequest('Say which vendor the machine is going to');

      const updated = await tx.maintenanceWorkOrder.update({
        where: { id },
        data: { outsourceStatus: 'SENT', sentAt: body.sentAt ?? new Date(), vendor: { connect: { id: vendorId } } },
        include: WORK_ORDER_INCLUDE,
      });
      await tx.workOrderStatusLog.create({ data: { workOrderId: id, fromStatus: wo.status, toStatus: wo.status, note: `Sent to vendor ${updated.vendor?.name ?? ''}`.trim(), changedByUserId: ctx.userId } });
      return workOrderMapper.toDTO(updated);
    });
  },

  async receive(ctx: UserAuthContext, id: string, body: { receivedAt?: Date | null; billNo?: string | null; billAmount: number; billUrl?: string | null }) {
    return prisma.$transaction(async (tx) => {
      const wo = await loadForTransition(tx, ctx, id, 'receive');
      const updated = await tx.maintenanceWorkOrder.update({
        where: { id },
        data: {
          outsourceStatus: 'RECEIVED',
          receivedAt: body.receivedAt ?? new Date(),
          billNo: body.billNo ?? null,
          cost: body.billAmount,
          ...(body.billUrl ? { billUrl: body.billUrl } : {}),
        },
        include: WORK_ORDER_INCLUDE,
      });
      // The machine is back: this is when the repair is counted and the machine/asset return to service (once).
      await applyRepairRollupOnce(tx, wo, body.billAmount, wo.repairParts.length > 0);
      await documentService.mirrorWorkOrderFile(tx, { workOrderId: id, field: 'billUrl', url: body.billUrl, actorId: ctx.userId });
      await tx.workOrderStatusLog.create({ data: { workOrderId: id, fromStatus: wo.status, toStatus: wo.status, note: `Received back from vendor, bill ${body.billNo ?? '-'} of ${body.billAmount}`, changedByUserId: ctx.userId } });
      return workOrderMapper.toDTO(updated);
    });
  },

  async pay(ctx: UserAuthContext, id: string, body: { paidAt?: Date | null; amount?: number | null }) {
    return prisma.$transaction(async (tx) => {
      const wo = await loadForTransition(tx, ctx, id, 'pay');
      const billed = wo.cost === null ? 0 : Number(wo.cost);
      const paid = body.amount === null || body.amount === undefined ? billed : body.amount;
      // The bill was rolled up when the machine came back. If less/more was actually paid, correct the running total
      // by the difference rather than counting the job again.
      await adjustRolledUpCost(tx, wo.machineId, billed, paid);
      const updated = await tx.maintenanceWorkOrder.update({
        where: { id },
        data: { outsourceStatus: 'PAID', paidAt: body.paidAt ?? new Date(), cost: paid },
        include: WORK_ORDER_INCLUDE,
      });
      await tx.workOrderStatusLog.create({ data: { workOrderId: id, fromStatus: wo.status, toStatus: wo.status, note: `Paid ${paid}`, changedByUserId: ctx.userId } });
      return workOrderMapper.toDTO(updated);
    });
  },
};

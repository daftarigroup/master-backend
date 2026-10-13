// What the assigned person does on a work order besides marking it done: tick the service checklist, record parts used.
// Both are changes to an OPEN work order by someone allowed to work on it (checked by the caller with workOrderGuard).
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { isOpenStatus } from '../lib/workOrderAccess';
import { workOrderMapper } from './workOrder.mapper';
import { workOrderRepository } from '../repositories/workOrder.repository';

function assertOpen(status: string) {
  if (!isOpenStatus(status)) throw ApiError.conflict('This work order is already closed');
}

export const workOrderTaskService = {
  /** Done / Pending / Issue for one checklist row. An Issue needs a note (also a database CHECK). Keeps the old `done` flag in step. */
  async setChecklistItem(workOrderId: string, itemId: string, userId: bigint, body: { state: 'PENDING' | 'DONE' | 'ISSUE'; note?: string | null; photoUrl?: string | null }) {
    const wo = await prisma.maintenanceWorkOrder.findUnique({ where: { id: workOrderId }, select: { status: true } });
    if (!wo) throw ApiError.notFound('Work order not found');
    assertOpen(wo.status);
    const item = await prisma.workOrderChecklistItem.findFirst({ where: { id: itemId, workOrderId } });
    if (!item) throw ApiError.notFound('Checklist item not found');
    const note = body.note?.trim() || null;
    if (body.state === 'ISSUE' && !note) throw ApiError.badRequest('Describe the problem: an item marked Issue needs a note');

    await prisma.workOrderChecklistItem.update({
      where: { id: itemId },
      data: {
        state: body.state,
        done: body.state === 'DONE',
        note: body.state === 'PENDING' ? null : note,
        doneById: body.state === 'PENDING' ? null : userId,
        doneAt: body.state === 'PENDING' ? null : new Date(),
        ...(body.photoUrl !== undefined ? { photoUrl: body.photoUrl } : {}),
      },
    });
    return workOrderMapper.toDTO(await workOrderRepository.findById(workOrderId));
  },

  async addPart(
    workOrderId: string,
    body: { partName: string; quantity: number; unitCost?: number | null; vendorName?: string | null; machinePartId?: string | null; warrantyFromDate?: Date | null; warrantyToDate?: Date | null },
  ) {
    const wo = await prisma.maintenanceWorkOrder.findUnique({ where: { id: workOrderId }, select: { status: true, machineId: true } });
    if (!wo) throw ApiError.notFound('Work order not found');
    assertOpen(wo.status);
    let resolvedPartId = body.machinePartId ?? null;
    if (resolvedPartId) {
      const part = await prisma.machinePart.findFirst({ where: { id: resolvedPartId, machineId: wo.machineId }, select: { id: true } });
      if (!part) throw ApiError.badRequest('That part does not belong to this machine');
    } else if (body.partName) {
      const part = await prisma.machinePart.findFirst({
        where: { machineId: wo.machineId, name: { equals: body.partName.trim(), mode: 'insensitive' } },
        select: { id: true },
      });
      if (part) resolvedPartId = part.id;
    }
    await prisma.workOrderRepairPart.create({
      data: {
        workOrderId,
        partName: body.partName,
        quantity: body.quantity ?? 1,
        unitCost: body.unitCost ?? null,
        vendorName: body.vendorName ?? null,
        machinePartId: resolvedPartId,
        warrantyFromDate: body.warrantyFromDate ?? null,
        warrantyToDate: body.warrantyToDate ?? null,
      },
    });
    return workOrderMapper.toDTO(await workOrderRepository.findById(workOrderId));
  },

  async removePart(workOrderId: string, partId: string) {
    const wo = await prisma.maintenanceWorkOrder.findUnique({ where: { id: workOrderId }, select: { status: true } });
    if (!wo) throw ApiError.notFound('Work order not found');
    assertOpen(wo.status);
    const res = await prisma.workOrderRepairPart.deleteMany({ where: { id: partId, workOrderId } });
    if (res.count === 0) throw ApiError.notFound('Part not found');
    return workOrderMapper.toDTO(await workOrderRepository.findById(workOrderId));
  },
};

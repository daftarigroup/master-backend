// Service schedules (what is due when) and Schedule Service (turn a due schedule into a work order with its checklist).
//
//   * "Last service" only moves forward when a service work order is APPROVED (workOrder.service approve), never when it is created.
//   * Schedule Service is idempotent: a schedule has at most one open work order (also a partial unique index), so pressing the button
//     twice returns the same one.
//   * Hired machines are not maintenance-tracked (same rule as work-order create): no schedules for them.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { isAdminRole } from '../../../middleware/requireCostAccess';
import { loadMachineInScope, requireUserId, resolveMachineWriteFirm } from '../../fleet/services/common';
import { dueForMachines } from '../../fleet/services/serviceDue.service';
import { workOrderService } from './workOrder.service';
import { workOrderMapper } from './workOrder.mapper';
import { workOrderRepository } from '../repositories/workOrder.repository';

const dec = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export interface ScheduleBody {
  machineId: string;
  name: string;
  intervalValue?: number | null;
  intervalDays?: number | null;
  leadValue?: number | null;
  leadDays?: number | null;
  lastServiceAt?: string | null;
  lastServiceReading?: number | null;
  checklistTemplateId?: string | null;
}

function mapSchedule(s: Prisma.MachineServiceScheduleGetPayload<{ include: { template: { select: { id: true; name: true } } } }>) {
  return {
    id: s.id,
    machineId: s.machineId,
    name: s.name,
    intervalValue: dec(s.intervalValue),
    intervalDays: s.intervalDays,
    leadValue: dec(s.leadValue),
    leadDays: s.leadDays,
    lastServiceAt: day(s.lastServiceAt),
    lastServiceReading: dec(s.lastServiceReading),
    checklistTemplate: s.template ? { id: s.template.id, name: s.template.name } : null,
    isActive: s.isActive,
  };
}
const SCHEDULE_INCLUDE = { template: { select: { id: true, name: true } } } as const;

async function assertMayManage(ctx: UserAuthContext) {
  if (!isAdminRole(ctx.role)) throw ApiError.forbidden('Only an admin can change service schedules');
}

async function assertTemplate(firmId: bigint, templateId: string | null | undefined) {
  if (!templateId) return;
  const t = await prisma.checklistTemplate.findFirst({ where: { id: templateId, firmId, isActive: true }, select: { id: true } });
  if (!t) throw ApiError.badRequest('Unknown checklist template for this firm');
}

export const scheduleService = {
  /** Schedules with their due status. */
  async list(ctx: UserAuthContext, q: { machineId: string }) {
    const machine = await loadMachineInScope(prisma, ctx, q.machineId);
    const rows = await prisma.machineServiceSchedule.findMany({ where: { machineId: machine.id }, include: SCHEDULE_INCLUDE, orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] });
    const due = (await dueForMachines(prisma, [machine])).get(machine.id);
    const open = await prisma.maintenanceWorkOrder.findMany({ where: { scheduleId: { in: rows.map((r) => r.id) }, status: { notIn: ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED', 'MISSED'] } }, select: { id: true, scheduleId: true, workOrderCode: true } });
    return rows.map((r) => ({
      ...mapSchedule(r),
      due: due?.schedules.find((s) => s.id === r.id)?.due ?? null,
      openWorkOrder: open.find((o) => o.scheduleId === r.id) ? { id: open.find((o) => o.scheduleId === r.id)!.id, code: open.find((o) => o.scheduleId === r.id)!.workOrderCode } : null,
    }));
  },

  async create(ctx: UserAuthContext, body: ScheduleBody) {
    await assertMayManage(ctx);
    const userId = requireUserId(ctx);
    const machine = await loadMachineInScope(prisma, ctx, body.machineId);
    if (machine.ownershipType === 'RENTED') throw ApiError.badRequest('A hired machine is not maintenance-tracked, so it has no service schedule');
    if (!(body.intervalValue && body.intervalValue > 0) && !(body.intervalDays && body.intervalDays > 0)) throw ApiError.badRequest('Give a service interval in hours / km, in days, or both');
    if (body.intervalValue && machine.readingUnit === 'NONE') throw ApiError.badRequest('This machine has no meter: schedule it by days');
    const firmId = await resolveMachineWriteFirm(prisma, ctx, machine, null);
    await assertTemplate(firmId, body.checklistTemplateId);
    const row = await prisma.machineServiceSchedule.create({
      data: {
        firmId,
        machineId: machine.id,
        name: body.name.trim(),
        intervalValue: body.intervalValue ?? null,
        intervalDays: body.intervalDays ?? null,
        leadValue: body.leadValue ?? null,
        leadDays: body.leadDays ?? null,
        lastServiceAt: body.lastServiceAt ? new Date(body.lastServiceAt) : null,
        lastServiceReading: body.lastServiceReading ?? null,
        checklistTemplateId: body.checklistTemplateId ?? null,
        createdById: userId,
      },
      include: SCHEDULE_INCLUDE,
    });
    return mapSchedule(row);
  },

  async update(ctx: UserAuthContext, id: string, body: Partial<Omit<ScheduleBody, 'machineId'>> & { isActive?: boolean }) {
    await assertMayManage(ctx);
    const row = await prisma.machineServiceSchedule.findUnique({ where: { id } });
    if (!row) throw ApiError.notFound('Schedule not found');
    await loadMachineInScope(prisma, ctx, row.machineId); // 404 for another firm's machine
    await assertTemplate(row.firmId, body.checklistTemplateId);
    const intervalValue = body.intervalValue === undefined ? dec(row.intervalValue) : body.intervalValue;
    const intervalDays = body.intervalDays === undefined ? row.intervalDays : body.intervalDays;
    if (!(intervalValue && intervalValue > 0) && !(intervalDays && intervalDays > 0)) throw ApiError.badRequest('A schedule needs an interval in hours / km or in days');
    const updated = await prisma.machineServiceSchedule.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.intervalValue !== undefined ? { intervalValue: body.intervalValue } : {}),
        ...(body.intervalDays !== undefined ? { intervalDays: body.intervalDays } : {}),
        ...(body.leadValue !== undefined ? { leadValue: body.leadValue } : {}),
        ...(body.leadDays !== undefined ? { leadDays: body.leadDays } : {}),
        ...(body.lastServiceAt !== undefined ? { lastServiceAt: body.lastServiceAt ? new Date(body.lastServiceAt) : null } : {}),
        ...(body.lastServiceReading !== undefined ? { lastServiceReading: body.lastServiceReading } : {}),
        ...(body.checklistTemplateId !== undefined ? { checklistTemplateId: body.checklistTemplateId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      include: SCHEDULE_INCLUDE,
    });
    return mapSchedule(updated);
  },

  /**
   * Creates the SCHEDULED work order for a schedule, with the checklist copied from its template. Assigned To defaults to the
   * machine's default mechanic and Responsible to the assignment's responsible person (workOrderService.create rules). Returns the
   * open one when it already exists.
   */
  async scheduleService(
    ctx: UserAuthContext,
    scheduleId: string,
    body: { dueAt?: Date | null; assigneeId?: bigint | null; responsibleId?: bigint | null; estPartsCost?: number | null; estLabourCost?: number | null; serviceMode?: 'IN_HOUSE' | 'VENDOR'; vendorId?: string | null },
  ) {
    const userId = requireUserId(ctx);
    const schedule = await prisma.machineServiceSchedule.findUnique({ where: { id: scheduleId }, include: { template: { include: { items: { orderBy: { sortOrder: 'asc' } } } } } });
    if (!schedule || !schedule.isActive) throw ApiError.notFound('Schedule not found');
    const machine = await loadMachineInScope(prisma, ctx, schedule.machineId);
    if (machine.ownershipType === 'RENTED') throw ApiError.badRequest('A hired machine is not maintenance-tracked');
    if (!isAdminRole(ctx.role)) {
      const a = await prisma.machineAssignment.findFirst({ where: { machineId: machine.id, endedAt: null }, select: { responsibleUserId: true } });
      const mine = a?.responsibleUserId === userId || machine.defaultResponsibleId === userId;
      if (!mine) throw ApiError.forbidden('Only an admin or the machine\'s responsible person can schedule a service');
    }

    const existing = await prisma.maintenanceWorkOrder.findFirst({ where: { scheduleId, status: { notIn: ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED', 'MISSED'] } }, select: { id: true } });
    if (existing) return { workOrder: workOrderMapper.toDTO(await workOrderRepository.findById(existing.id)), created: false };

    const created = await workOrderService.create(ctx, {
      type: 'SCHEDULED',
      machineId: machine.id,
      title: schedule.name,
      description: null,
      dueAt: body.dueAt ?? new Date(),
      assigneeId: body.assigneeId ?? null,
      responsibleId: body.responsibleId ?? null,
      scheduleId,
      serviceMode: body.serviceMode,
      vendorId: body.vendorId ?? null,
      estPartsCost: body.estPartsCost ?? null,
      estLabourCost: body.estLabourCost ?? null,
    }).catch(async (e) => {
      // a double click racing the check above: the partial unique index let one through, so return that one
      if ((e as { code?: string })?.code === 'P2002') return null;
      throw e;
    });
    if (!created) {
      const winner = await prisma.maintenanceWorkOrder.findFirstOrThrow({ where: { scheduleId, status: { notIn: ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED', 'MISSED'] } }, select: { id: true } });
      return { workOrder: workOrderMapper.toDTO(await workOrderRepository.findById(winner.id)), created: false };
    }

    const items = schedule.template?.items ?? [];
    if (items.length > 0) {
      await prisma.workOrderChecklistItem.createMany({ data: items.map((i, idx) => ({ workOrderId: created.id, text: i.text, sortOrder: i.sortOrder ?? idx })) });
    }
    return { workOrder: workOrderMapper.toDTO(await workOrderRepository.findById(created.id)), created: true };
  },

  // ---- checklist templates (admin) ---------------------------------------------------------------------------------------------
  async listTemplates(ctx: UserAuthContext, firmId: bigint) {
    if (!ctx.permittedFirms.includes(firmId) && ctx.role !== 'SUPER_ADMIN') throw ApiError.forbidden('No access to this firm');
    const rows = await prisma.checklistTemplate.findMany({ where: { firmId }, include: { items: { orderBy: { sortOrder: 'asc' } } }, orderBy: { name: 'asc' } });
    return rows.map((t) => ({ id: t.id, name: t.name, isActive: t.isActive, items: t.items.map((i) => ({ id: i.id, text: i.text, sortOrder: i.sortOrder })) }));
  },

  /** Creates a template, or replaces its items and name (an existing work order keeps the checklist it was created with). */
  async saveTemplate(ctx: UserAuthContext, body: { id?: string; firmId: bigint; name: string; items: string[]; isActive?: boolean }) {
    await assertMayManage(ctx);
    if (ctx.role !== 'SUPER_ADMIN' && !ctx.permittedFirms.includes(body.firmId)) throw ApiError.forbidden('No access to this firm');
    const items = body.items.map((t) => t.trim()).filter(Boolean);
    if (items.length === 0) throw ApiError.badRequest('A checklist needs at least one item');
    try {
      const id = await prisma.$transaction(async (tx) => {
        const t = body.id
          ? await tx.checklistTemplate.update({ where: { id: body.id }, data: { name: body.name.trim(), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) } })
          : await tx.checklistTemplate.create({ data: { firmId: body.firmId, name: body.name.trim() } });
        if (t.firmId !== body.firmId) throw ApiError.badRequest('That template belongs to another firm');
        await tx.checklistTemplateItem.deleteMany({ where: { templateId: t.id } });
        await tx.checklistTemplateItem.createMany({ data: items.map((text, i) => ({ templateId: t.id, text, sortOrder: i + 1 })) });
        return t.id;
      });
      return (await this.listTemplates(ctx, body.firmId)).find((t) => t.id === id)!;
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') throw ApiError.conflict('A checklist with that name already exists');
      throw e;
    }
  },
};


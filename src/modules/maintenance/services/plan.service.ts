import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { planRepository } from '../repositories/plan.repository';
import { planMapper } from './plan.mapper';
import { parsePagination, paginationMeta } from './mapUtils';
import { priorityFromNumber } from './priority';
import { workOrderService } from './workOrder.service';
import { UserAuthContext } from '../../../utils/currentUser';
import { machineRowFirmFilter, parseBigIntId } from '../../../utils/firmScope';

export const planService = {
  async list(query: Record<string, any>, auth?: UserAuthContext | null) {
    const { page, limit, skip } = parsePagination(query);
    const andConditions: Prisma.MaintenancePlanWhereInput[] = [];

    if (query.machineId) andConditions.push({ machineId: query.machineId });
    if (query.frequency) andConditions.push({ frequency: query.frequency });
    if (query.status) andConditions.push({ status: query.status });
    if (query.search) andConditions.push({ title: { contains: query.search, mode: 'insensitive' } });

    if (auth) {
      const firmFilter = machineRowFirmFilter(auth, query.firmId ?? query.projectId);
      if (firmFilter) andConditions.push(firmFilter);
    }

    const where: Prisma.MaintenancePlanWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};
    const [rows, total] = await Promise.all([planRepository.findMany(where, skip, limit), planRepository.count(where)]);
    return { data: rows.map(planMapper.toDTO), pagination: paginationMeta(page, limit, total) };
  },

  async getById(id: string) {
    const row = await planRepository.findById(id);
    if (!row) throw ApiError.notFound('Plan not found');
    return planMapper.toDTO(row);
  },

  async create(body: Record<string, any>, createdById: bigint | null) {
    return prisma.$transaction(async (tx) => {
      const machine = await tx.machine.findUnique({ where: { id: body.machineId } });
      if (!machine) throw ApiError.badRequest('machineId does not reference an existing machine');

      const planCode = body.planCode?.trim() || (await documentSequenceService.next({ prefix: 'PLN', year: 0, pad: 3 }, tx));

      const data = planMapper.toPrismaCreate(body);
      const plan = await tx.maintenancePlan.create({
        data: {
          ...data,
          planCode,
          priority: priorityFromNumber(body.priority),
          machine: { connect: { id: body.machineId } },
          ...(body.activityTypeId ? { activityType: { connect: { id: body.activityTypeId } } } : {}),
          ...(body.machinePartId ? { machinePart: { connect: { id: body.machinePartId } } } : {}),
          ...(body.assignedToId ? { assignedTo: { connect: { id: parseBigIntId(body.assignedToId, 'assignedToId') } } } : {}),
          ...(createdById ? { createdBy: { connect: { id: createdById } } } : {}),
        },
        include: {
          activityType: true,
          machinePart: { select: { id: true, name: true, partNumber: true } },
          machine: { select: { id: true, name: true, assetCode: true, status: true } },
          assignedTo: { select: { id: true, name: true, user_name: true, employee: { select: { email: true } } } },
          _count: { select: { workOrders: true } },
        },
      });

      // Maintenance rollup cache on the linked Asset — see architecture doc §5 rule 3.
      if (machine.assetId) {
        await tx.asset.update({
          where: { id: machine.assetId },
          data: {
            maintenanceRequired: true,
            maintenanceType: 'Preventive',
            frequency: plan.frequency,
            nextService: plan.startDate,
            priority: plan.priority,
          },
        });
      }

      // Automatically generate the initial work order for this assigned plan
      const workOrderType =
        body.isRepair === true || body.workOrderType === 'REPAIR'
          ? 'REPAIR'
          : plan.frequency === 'ONE_TIME'
            ? 'ONE_TIME'
            : 'SCHEDULED';

      await workOrderService.createInternal(tx, {
        machineId: plan.machineId,
        // plans never carry a firm, so the work order takes its machine's (it used to be left empty)
        firmId: plan.firmId ?? machine.firmId,
        planId: plan.id,
        machinePartId: plan.machinePartId,
        currentAssigneeUserId: plan.assignedToUserId,
        type: workOrderType,
        priority: plan.priority,
        actualDueDate: plan.startDate,
        // the work order carries its own content from now on
        title: plan.title,
        description: plan.description,
        activityTypeId: plan.activityTypeId,
        documentUrl: plan.documentUrl,
        requestedById: createdById,
      });

      return planMapper.toDTO(plan);
    });
  },

  async update(id: string, body: Record<string, any>) {
    await this.assertExists(id);
    const data = planMapper.toPrismaUpdate(body);
    if (body.priority !== undefined) (data as any).priority = priorityFromNumber(body.priority);
    if (body.activityTypeId !== undefined) (data as any).activityType = { connect: { id: body.activityTypeId } };
    if (body.machinePartId !== undefined) (data as any).machinePart = body.machinePartId ? { connect: { id: body.machinePartId } } : { disconnect: true };
    if (body.machineId !== undefined) (data as any).machine = { connect: { id: body.machineId } };
    if (body.assignedToId !== undefined) (data as any).assignedTo = { connect: { id: parseBigIntId(body.assignedToId, 'assignedToId') } };
    const row = await planRepository.update(id, data);

    // Work orders own their content now (and always carried their own assignee, machine and due date), so a plan
    // edit has to reach the ones that are still open. Before, the Edit modals changed the plan only and the
    // work order kept its old machine, assignee and due date.
    const open: Prisma.MaintenanceWorkOrderUpdateManyMutationInput & Record<string, unknown> = {};
    if (body.title !== undefined) open.title = body.title;
    if (body.description !== undefined) open.description = body.description;
    if (body.documentUrl !== undefined) open.documentUrl = body.documentUrl;
    if (body.priority !== undefined) open.priority = priorityFromNumber(body.priority);
    if (body.activityTypeId !== undefined) open.activityTypeId = body.activityTypeId;
    if (body.machineId !== undefined) open.machineId = body.machineId;
    if (body.machinePartId !== undefined) open.machinePartId = body.machinePartId || null;
    if (body.assignedToId !== undefined) open.currentAssigneeUserId = parseBigIntId(body.assignedToId, 'assignedToId');
    if (body.startDate !== undefined && row.frequency === 'ONE_TIME') {
      open.actualDueDate = new Date(body.startDate);
      open.scheduledDate = new Date(body.startDate);
    }
    if (Object.keys(open).length > 0) {
      await prisma.maintenanceWorkOrder.updateMany({
        where: { planId: id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        data: open as Prisma.MaintenanceWorkOrderUncheckedUpdateManyInput,
      });
    }
    return planMapper.toDTO(row);
  },

  async setStatus(id: string, status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED') {
    await this.assertExists(id);
    const row = await planRepository.update(id, { status });
    return planMapper.toDTO(row);
  },

  async assertExists(id: string) {
    const row = await planRepository.findById(id);
    if (!row) throw ApiError.notFound('Plan not found');
    return row;
  },
};

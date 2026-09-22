import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

const USER_SELECT = { select: { id: true, name: true, user_name: true, employee: { select: { email: true } } } };

export const WORK_ORDER_INCLUDE = {
  machine: { select: { id: true, name: true, assetCode: true, firmId: true, firm: { select: { id: true, firm_name: true } } } },
  machinePart: { select: { id: true, name: true, partNumber: true } },
  breakdownReport: true,
  currentAssignee: USER_SELECT,
  completedBy: USER_SELECT,
  plan: {
    include: {
      activityType: true,
      machinePart: { select: { id: true, name: true, partNumber: true } },
      createdBy: { select: { id: true, name: true, user_name: true } },
    },
  },
  transfers: { include: { fromUser: { select: { name: true } }, toUser: { select: { name: true } } }, orderBy: { createdAt: 'desc' as const } },
  approvalRequests: {
    orderBy: { requestedAt: 'desc' as const },
    take: 1,
    include: {
      submittedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
  },
  statusLogs: { orderBy: { createdAt: 'desc' as const }, take: 20, include: { changedBy: { select: { id: true, name: true } } } },
  checklistItems: true,
  replacementParts: true,
  repairParts: true,
} satisfies Prisma.MaintenanceWorkOrderInclude;

export const workOrderRepository = {
  findMany(where: Prisma.MaintenanceWorkOrderWhereInput, skip: number, take: number, orderBy: Prisma.MaintenanceWorkOrderOrderByWithRelationInput = { actualDueDate: 'desc' }) {
    return prisma.maintenanceWorkOrder.findMany({ where, include: WORK_ORDER_INCLUDE, orderBy, skip, take });
  },
  count(where: Prisma.MaintenanceWorkOrderWhereInput) {
    return prisma.maintenanceWorkOrder.count({ where });
  },
  findById(id: string) {
    return prisma.maintenanceWorkOrder.findUnique({ where: { id }, include: WORK_ORDER_INCLUDE });
  },
  create(data: Prisma.MaintenanceWorkOrderCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.maintenanceWorkOrder.create({ data, include: WORK_ORDER_INCLUDE });
  },
  update(id: string, data: Prisma.MaintenanceWorkOrderUpdateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.maintenanceWorkOrder.update({ where: { id }, data, include: WORK_ORDER_INCLUDE });
  },
};

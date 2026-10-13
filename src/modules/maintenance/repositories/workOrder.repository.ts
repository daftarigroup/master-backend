import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

const USER_SELECT = { select: { id: true, name: true, user_name: true, employee: { select: { email: true } } } };

export const WORK_ORDER_INCLUDE = {
  machine: {
    select: {
      id: true,
      name: true,
      assetCode: true,
      firmId: true,
      firm: { select: { id: true, firm_name: true } },
      assignments: {
        where: { endedAt: null },
        select: { id: true, firmId: true, firm: { select: { id: true, firm_name: true } } },
      },
    },
  },
  machinePart: { select: { id: true, name: true, partNumber: true } },
  breakdownReport: true,
  activityType: true, // the work order's own activity type (no longer only via its plan)
  requestedBy: USER_SELECT,
  vendor: { select: { id: true, name: true } }, // out-source vendor
  currentAssignee: USER_SELECT,
  responsible: USER_SELECT,
  schedule: { select: { id: true, name: true } },
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
  checklistItems: { orderBy: { sortOrder: 'asc' as const } },
  replacementParts: true,
  repairParts: true,
  // fleet_v7_repair_parts: the Store parts this repair needs, with their live issues (one query for the whole list)
  partRequirements: {
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'asc' as const },
    include: {
      issues: { where: { voidedAt: null } },
      storeIssues: { select: { id: true, quantity: true, status: true } },
      indents: { select: { id: true, indent_number: true, approved_vendor_name: true, vendor_name1: true } },
    },
  },
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

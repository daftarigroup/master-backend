import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

export const PLAN_INCLUDE = {
  activityType: true,
  machinePart: { select: { id: true, name: true, partNumber: true } },
  machine: { select: { id: true, name: true, assetCode: true, status: true } },
  assignedTo: { select: { id: true, name: true, user_name: true, employee: { select: { email: true } } } },
  _count: { select: { workOrders: true } },
} satisfies Prisma.MaintenancePlanInclude;

export const planRepository = {
  findMany(where: Prisma.MaintenancePlanWhereInput, skip: number, take: number) {
    return prisma.maintenancePlan.findMany({ where, include: PLAN_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take });
  },
  count(where: Prisma.MaintenancePlanWhereInput) {
    return prisma.maintenancePlan.count({ where });
  },
  findById(id: string) {
    return prisma.maintenancePlan.findUnique({
      where: { id },
      include: {
        ...PLAN_INCLUDE,
        workOrders: {
          take: 10,
          orderBy: { actualDueDate: 'desc' },
          include: { currentAssignee: { select: { id: true, name: true, user_name: true } } },
        },
      },
    });
  },
  create(data: Prisma.MaintenancePlanCreateInput) {
    return prisma.maintenancePlan.create({ data, include: PLAN_INCLUDE });
  },
  update(id: string, data: Prisma.MaintenancePlanUpdateInput) {
    return prisma.maintenancePlan.update({ where: { id }, data, include: PLAN_INCLUDE });
  },
  delete(id: string) {
    return prisma.maintenancePlan.delete({ where: { id } });
  },
};

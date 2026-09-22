import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

export const MACHINE_INCLUDE = {
  department: true,
  firm: { select: { id: true, firm_name: true } },
  _count: { select: { workOrders: true, breakdownReports: true, parts: true, maintenancePlans: true } },
} satisfies Prisma.MachineInclude;

export const machineRepository = {
  findMany(where: Prisma.MachineWhereInput, skip: number, take: number) {
    return prisma.machine.findMany({ where, include: MACHINE_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take });
  },

  count(where: Prisma.MachineWhereInput) {
    return prisma.machine.count({ where });
  },

  findById(id: string) {
    return prisma.machine.findUnique({
      where: { id },
      include: {
        ...MACHINE_INCLUDE,
        parts: true,
        maintenancePlans: { take: 10, orderBy: { createdAt: 'desc' } },
        breakdownReports: { take: 10, orderBy: { reportedAt: 'desc' } },
        workOrders: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });
  },

  findByAssetCode(assetCode: string) {
    return prisma.machine.findUnique({ where: { assetCode } });
  },

  create(data: Prisma.MachineCreateInput) {
    return prisma.machine.create({ data, include: MACHINE_INCLUDE });
  },

  update(id: string, data: Prisma.MachineUpdateInput) {
    return prisma.machine.update({ where: { id }, data, include: MACHINE_INCLUDE });
  },

  delete(id: string) {
    return prisma.machine.delete({ where: { id } });
  },
};

import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

const INCLUDE = { machine: { select: { id: true, name: true, assetCode: true } } } satisfies Prisma.MachinePartInclude;

export const machinePartRepository = {
  findMany(where: Prisma.MachinePartWhereInput, skip: number, take: number) {
    return prisma.machinePart.findMany({ where, include: INCLUDE, orderBy: { createdAt: 'desc' }, skip, take });
  },
  count(where: Prisma.MachinePartWhereInput) {
    return prisma.machinePart.count({ where });
  },
  findById(id: string) {
    return prisma.machinePart.findUnique({ where: { id }, include: INCLUDE });
  },
  create(data: Prisma.MachinePartCreateInput) {
    return prisma.machinePart.create({ data, include: INCLUDE });
  },
  update(id: string, data: Prisma.MachinePartUpdateInput) {
    return prisma.machinePart.update({ where: { id }, data, include: INCLUDE });
  },
  delete(id: string) {
    return prisma.machinePart.delete({ where: { id } });
  },
};

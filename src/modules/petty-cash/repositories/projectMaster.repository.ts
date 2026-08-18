import { prisma } from '../../../database/prisma';
import { Prisma } from '@prisma/client';

export const projectMasterRepository = {
  findMany(type?: string) {
    return prisma.projectMaster.findMany({
      where: type ? { type } : {},
      orderBy: { value: 'asc' },
    });
  },

  findById(id: string) {
    return prisma.projectMaster.findUnique({ where: { id } });
  },

  findByTypeValue(type: string, value: string) {
    return prisma.projectMaster.findUnique({
      where: {
        type_value: { type, value },
      },
    });
  },

  create(data: Prisma.ProjectMasterCreateInput) {
    return prisma.projectMaster.create({ data });
  },

  update(id: string, data: Prisma.ProjectMasterUpdateInput) {
    return prisma.projectMaster.update({ where: { id }, data });
  },

  remove(id: string) {
    return prisma.projectMaster.delete({ where: { id } });
  },
};

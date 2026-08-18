import { prisma } from '../../../database/prisma';
import { Prisma } from '@prisma/client';

export const creditsRepository = {
  findMany(filters: { personName?: string; projectName?: string; fromDate?: string; toDate?: string } = {}) {
    const where: Prisma.CreditWhereInput = {
      ...(filters.personName ? { personName: filters.personName } : {}),
      ...(filters.projectName ? { projectName: filters.projectName } : {}),
      ...(filters.fromDate || filters.toDate
        ? {
            date: {
              ...(filters.fromDate ? { gte: new Date(filters.fromDate) } : {}),
              ...(filters.toDate ? { lte: new Date(filters.toDate) } : {}),
            },
          }
        : {}),
    };
    return prisma.credit.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  },

  findById(id: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.credit.findUnique({ where: { id } });
  },

  findBySn(sn: string) {
    return prisma.credit.findUnique({ where: { sn } });
  },

  create(data: Prisma.CreditCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.credit.create({ data });
  },

  update(id: string, data: Prisma.CreditUpdateInput) {
    return prisma.credit.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.credit.delete({ where: { id } });
  },
};

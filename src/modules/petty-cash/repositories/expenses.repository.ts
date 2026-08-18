import { prisma } from '../../../database/prisma';
import { Prisma, PettyCashEntryStatus } from '@prisma/client';

export const expensesRepository = {
  findMany(filters: { status?: PettyCashEntryStatus; personName?: string; projectName?: string; groupHead?: string; fromDate?: string; toDate?: string } = {}) {
    const where: Prisma.ExpenseWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.personName ? { personName: filters.personName } : {}),
      ...(filters.projectName ? { projectName: filters.projectName } : {}),
      ...(filters.groupHead ? { groupHead: filters.groupHead } : {}),
      ...(filters.fromDate || filters.toDate
        ? {
            date: {
              ...(filters.fromDate ? { gte: new Date(filters.fromDate) } : {}),
              ...(filters.toDate ? { lte: new Date(filters.toDate) } : {}),
            },
          }
        : {}),
    };
    return prisma.expense.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  },

  findById(id: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.expense.findUnique({ where: { id } });
  },

  create(data: Prisma.ExpenseCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.expense.create({ data });
  },

  update(id: string, data: Prisma.ExpenseUpdateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.expense.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.expense.delete({ where: { id } });
  },
};

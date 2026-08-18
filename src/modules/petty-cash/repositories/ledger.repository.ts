import { prisma } from '../../../database/prisma';
import { Prisma } from '@prisma/client';

export const ledgerRepository = {
  findLastByPerson(personName: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.ledgerEntry.findFirst({
      where: { personName },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  },

  create(data: Prisma.LedgerEntryCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.ledgerEntry.create({ data });
  },

  findMany(where: Prisma.LedgerEntryWhereInput = {}, { skip = 0, take = 20 }: { skip?: number; take?: number } = {}) {
    return prisma.ledgerEntry.findMany({
      where,
      skip,
      take,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: {
        credit: { select: { sn: true } },
        expense: { select: { sn: true } },
      },
    });
  },

  count(where: Prisma.LedgerEntryWhereInput = {}) {
    return prisma.ledgerEntry.count({ where });
  },
};

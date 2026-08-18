import { prisma } from '../../../database/prisma';
import { Prisma } from '@prisma/client';

export const docCounterRepository = {
  incrementCounter(key: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docCounter.upsert({
      where: { key },
      create: { key, value: 1 },
      update: { value: { increment: 1 } },
    });
  },
};

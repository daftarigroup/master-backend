import { docCounterRepository } from '../repositories/docCounter.repository';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

export const docCounterService = {
  async nextDocSerial(key: string, prefix: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    const counter = await docCounterRepository.incrementCounter(key, client);
    return `${prefix}-${String(counter.value).padStart(3, '0')}`;
  },
};

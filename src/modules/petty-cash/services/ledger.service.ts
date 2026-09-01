import { ledgerRepository } from '../repositories/ledger.repository';
import { PettyCashLedgerType, Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

export const ledgerService = {
  async getCurrentBalance(personName: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    const lastEntry = await ledgerRepository.findLastByPerson(personName, client);
    return lastEntry ? Number(lastEntry.balance) : 0;
  },

  async recordEntry({
    tx,
    personName,
    type,
    amount,
    date,
    creditId,
    expenseId,
  }: {
    tx: Prisma.TransactionClient;
    personName: string;
    type: PettyCashLedgerType;
    amount: number | Prisma.Decimal;
    date: Date;
    creditId?: string;
    expenseId?: string;
  }) {
    const currentBalance = await this.getCurrentBalance(personName, tx);
    const signedAmount = type === 'CREDIT' ? Number(amount) : -Number(amount);
    const balance = currentBalance + signedAmount;

    return ledgerRepository.create(
      {
        personName,
        type,
        amount,
        date,
        balance,
        ...(creditId ? { credit: { connect: { id: creditId } } } : {}),
        ...(expenseId ? { expense: { connect: { id: expenseId } } } : {}),
      },
      tx
    );
  },

  async listLedger({
    personName,
    type,
    fromDate,
    toDate,
    page = 1,
    limit = 20,
  }: {
    personName?: string;
    type?: PettyCashLedgerType;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Prisma.LedgerEntryWhereInput = {
      ...(personName ? { personName } : {}),
      ...(type ? { type } : {}),
      ...(fromDate || toDate
        ? {
            date: {
              ...(fromDate ? { gte: new Date(fromDate) } : {}),
              ...(toDate ? { lte: new Date(toDate) } : {}),
            },
          }
        : {}),
    };

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 500);
    const safePage = Math.max(Number(page) || 1, 1);

    const [rows, total] = await Promise.all([
      ledgerRepository.findMany(where, { skip: (safePage - 1) * safeLimit, take: safeLimit }),
      ledgerRepository.count(where),
    ]);

    const entries = rows.map(({ credit, expense, ...entry }) => ({
      ...entry,
      referenceId: credit?.sn || expense?.sn || null,
    }));

    return { entries, total, page: safePage, limit: safeLimit };
  },

  async getBalance(personName: string) {
    const balance = await this.getCurrentBalance(personName);
    return { personName, balance };
  },
};

import { prisma } from '../../../database/prisma';
import { Prisma } from '@prisma/client';

export const loanListSelect = {
  id: true,
  sn: true,
  loanName: true,
  bankName: true,
  amount: true,
  emi: true,
  startDate: true,
  endDate: true,
  providedDocument: true,
  remarks: true,
  file: true,
  foreclosureStatus: true,
  requestDate: true,
  requesterName: true,
  documentStatus: true,
  documentCollectionRemarks: true,
  closerRequestDate: true,
  collectNocStatus: true,
  finalSettlementStatus: true,
  nextDate: true,
  settlementDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface LoanFilters {
  bankName?: string;
  foreclosureStatus?: string;
  documentStatus?: string;
  collectNocStatus?: string;
  search?: string;
  skip?: number;
  take?: number;
  includeContent?: boolean;
}

export const loansRepository = {
  async findMany(filters: LoanFilters = {}) {
    const search = filters.search?.trim();
    const where: Prisma.DocLoanWhereInput = {
      ...(filters.bankName ? { bankName: { contains: filters.bankName, mode: 'insensitive' } } : {}),
      ...(filters.foreclosureStatus ? { foreclosureStatus: filters.foreclosureStatus } : {}),
      ...(filters.documentStatus ? { documentStatus: filters.documentStatus } : {}),
      ...(filters.collectNocStatus ? { collectNocStatus: filters.collectNocStatus } : {}),
      ...(search
        ? {
            OR: [
              { loanName: { contains: search, mode: 'insensitive' } },
              { bankName: { contains: search, mode: 'insensitive' } },
              { requesterName: { contains: search, mode: 'insensitive' } },
              { sn: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (filters.take !== undefined) {
      const [items, total] = await Promise.all([
        prisma.docLoan.findMany({
          where,
          select: filters.includeContent ? undefined : loanListSelect,
          orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
          skip: filters.skip || 0,
          take: filters.take,
        }),
        prisma.docLoan.count({ where }),
      ]);
      return { items, total };
    }

    const items = await prisma.docLoan.findMany({
      where,
      select: filters.includeContent ? undefined : loanListSelect,
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });
    return { items, total: items.length };
  },

  findById(id: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docLoan.findUnique({ where: { id } });
  },

  create(data: Prisma.DocLoanCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docLoan.create({ data });
  },

  update(id: string, data: Prisma.DocLoanUpdateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docLoan.update({ where: { id }, data });
  },

  remove(id: string) {
    return prisma.docLoan.delete({ where: { id } });
  },
};

import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { loansRepository } from '../repositories/loans.repository';
import { docCounterService } from './docCounter.service';

function safeDate(val: any, fallback: Date | null = null): Date | null {
  if (!val) return fallback;
  const d = val instanceof Date ? val : new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

export const loansService = {
  async listLoans(filters: any = {}) {
    const page = filters.page ? Math.max(1, parseInt(String(filters.page), 10) || 1) : undefined;
    const limit = filters.limit ? Math.max(1, parseInt(String(filters.limit), 10) || 25) : undefined;
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit;

    const { items, total } = await loansRepository.findMany({
      ...filters,
      skip,
      take,
    });

    if (page && limit) {
      return {
        items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }
    return items;
  },

  async getLoanById(id: string) {
    const loan = await loansRepository.findById(id);
    if (!loan) throw ApiError.notFound('Loan not found');
    return loan;
  },

  async createLoan({
    loanName,
    bankName,
    amount,
    emi,
    startDate,
    endDate,
    providedDocument,
    remarks,
    file,
    fileContent,
  }: {
    loanName: string;
    bankName: string;
    amount: string;
    emi: string;
    startDate: string | Date;
    endDate: string | Date;
    providedDocument: string;
    remarks?: string;
    file?: string;
    fileContent?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const sn = await docCounterService.nextDocSerial('loan', 'SN', tx);
      return loansRepository.create(
        {
          sn,
          loanName,
          bankName,
          amount,
          emi,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          providedDocument,
          remarks,
          file,
          fileContent,
        },
        tx
      );
    });
  },

  async updateLoan(id: string, data: any) {
    await this.getLoanById(id);
    const {
      loanName,
      bankName,
      amount,
      emi,
      startDate,
      endDate,
      providedDocument,
      remarks,
      file,
      fileContent,
    } = data;
    return loansRepository.update(id, {
      ...(loanName !== undefined ? { loanName } : {}),
      ...(bankName !== undefined ? { bankName } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(emi !== undefined ? { emi } : {}),
      ...(startDate !== undefined ? { startDate: new Date(startDate) } : {}),
      ...(endDate !== undefined ? { endDate: new Date(endDate) } : {}),
      ...(providedDocument !== undefined ? { providedDocument } : {}),
      ...(remarks !== undefined ? { remarks } : {}),
      ...(file !== undefined ? { file } : {}),
      ...(fileContent !== undefined ? { fileContent } : {}),
    });
  },

  async deleteLoan(id: string) {
    await this.getLoanById(id);
    await loansRepository.remove(id);
  },

  async requestForeclosure(id: string, { requesterName }: { requesterName?: string }) {
    await this.getLoanById(id);
    return loansRepository.update(id, {
      foreclosureStatus: 'Pending',
      requestDate: new Date(),
      requesterName,
    });
  },

  async collectDocuments(
    id: string,
    { documentCollectionRemarks }: { documentCollectionRemarks?: string }
  ) {
    const loan = await this.getLoanById(id);
    if (loan.foreclosureStatus !== 'Pending') {
      throw ApiError.badRequest('Foreclosure must be requested before collecting documents');
    }
    return loansRepository.update(id, {
      documentStatus: 'Yes',
      documentCollectionRemarks,
      closerRequestDate: new Date(),
    });
  },

  async collectNoc(id: string) {
    const loan = await this.getLoanById(id);
    if (loan.documentStatus !== 'Yes') {
      throw ApiError.badRequest('Documents must be collected before collecting NOC');
    }
    return loansRepository.update(id, { collectNocStatus: 'Yes' });
  },

  async settleLoan(
    id: string,
    { settlementDate, nextDate }: { settlementDate?: string | Date | null; nextDate?: string | Date | null }
  ) {
    const loan = await this.getLoanById(id);
    if (loan.collectNocStatus !== 'Yes') {
      throw ApiError.badRequest('NOC must be collected before final settlement');
    }
    if (settlementDate) {
      return loansRepository.update(id, {
        finalSettlementStatus: 'Yes',
        settlementDate: new Date(settlementDate),
      });
    }
    return loansRepository.update(id, {
      finalSettlementStatus: 'No',
      nextDate: nextDate ? new Date(nextDate) : null,
    });
  },
};

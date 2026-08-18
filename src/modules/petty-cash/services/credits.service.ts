import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { creditsRepository } from '../repositories/credits.repository';
import { settingsService } from './settings.service';
import { ledgerService } from './ledger.service';

export const creditsService = {
  async listCredits(filters = {}) {
    return creditsRepository.findMany(filters);
  },

  async getCreditById(id: string) {
    const credit = await creditsRepository.findById(id);
    if (!credit) throw ApiError.notFound('Credit not found');
    return credit;
  },

  async createCredit({
    personName,
    projectName,
    date,
    amount,
    paymentMode,
    image,
    remarks,
  }: {
    personName: string;
    projectName?: string;
    date: string | Date;
    amount: number;
    paymentMode: string;
    image?: string;
    remarks?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const sn = await settingsService.nextSerialNumber('SN', tx);

      const credit = await creditsRepository.create(
        {
          sn,
          personName,
          projectName,
          date: new Date(date),
          amount,
          paymentMode,
          image,
          remarks,
          status: 'APPROVED',
        },
        tx
      );

      await ledgerService.recordEntry({
        tx,
        personName,
        type: 'CREDIT',
        amount,
        date: credit.date,
        creditId: credit.id,
      });

      return credit;
    });
  },

  async updateCredit(
    id: string,
    {
      paymentMode,
      projectName,
      remarks,
      image,
    }: {
      paymentMode?: string;
      projectName?: string;
      remarks?: string;
      image?: string;
    }
  ) {
    await this.getCreditById(id);
    return creditsRepository.update(id, {
      ...(paymentMode !== undefined ? { paymentMode } : {}),
      ...(projectName !== undefined ? { projectName } : {}),
      ...(remarks !== undefined ? { remarks } : {}),
      ...(image !== undefined ? { image } : {}),
    });
  },
};

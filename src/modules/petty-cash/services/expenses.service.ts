import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { PettyCashEntryStatus } from '@prisma/client';
import { expensesRepository } from '../repositories/expenses.repository';
import { settingsService } from './settings.service';
import { ledgerService } from './ledger.service';

export const expensesService = {
  async listExpenses(filters = {}) {
    return expensesRepository.findMany(filters);
  },

  async getExpenseById(id: string) {
    const expense = await expensesRepository.findById(id);
    if (!expense) throw ApiError.notFound('Expense not found');
    return expense;
  },

  async createExpense({
    personName,
    projectName,
    date,
    amount,
    paymentMode,
    groupHead,
    image,
    remarks,
  }: {
    personName: string;
    projectName?: string;
    date: string | Date;
    amount: number;
    paymentMode: string;
    groupHead: string;
    image?: string;
    remarks?: string;
  }) {
    const sn = await settingsService.nextSerialNumber('EXP');
    return expensesRepository.create({
      sn,
      personName,
      projectName,
      date: new Date(date),
      amount,
      paymentMode,
      groupHead,
      image,
      remarks,
      status: 'PENDING',
    });
  },

  async updateExpense(
    id: string,
    {
      paymentMode,
      groupHead,
      projectName,
      remarks,
      image,
    }: {
      paymentMode?: string;
      groupHead?: string;
      projectName?: string;
      remarks?: string;
      image?: string;
    }
  ) {
    const expense = await this.getExpenseById(id);
    if (expense.status !== 'PENDING') {
      throw ApiError.badRequest('Only pending expenses can be edited');
    }
    return expensesRepository.update(id, {
      ...(paymentMode !== undefined ? { paymentMode } : {}),
      ...(groupHead !== undefined ? { groupHead } : {}),
      ...(projectName !== undefined ? { projectName } : {}),
      ...(remarks !== undefined ? { remarks } : {}),
      ...(image !== undefined ? { image } : {}),
    });
  },

  async updateExpenseStatus(id: string, status: PettyCashEntryStatus, approverName?: string) {
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      throw ApiError.badRequest('Status must be APPROVED or REJECTED');
    }

    return prisma.$transaction(async (tx) => {
      const expense = await expensesRepository.findById(id, tx);
      if (!expense) throw ApiError.notFound('Expense not found');
      if (expense.status !== 'PENDING') {
        throw ApiError.badRequest(`Expense is already ${expense.status.toLowerCase()}`);
      }

      const updated = await expensesRepository.update(
        id,
        { status, approvedBy: approverName || 'Admin' },
        tx
      );

      if (status === 'APPROVED') {
        await ledgerService.recordEntry({
          tx,
          personName: expense.personName,
          type: 'EXPENSE',
          amount: expense.amount,
          date: expense.date,
          expenseId: expense.id,
        });
      }

      return updated;
    });
  },
};

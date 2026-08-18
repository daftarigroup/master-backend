import { prisma } from '../../../database/prisma';

export const dashboardRepository = {
  sumAllCredits() {
    return prisma.credit.aggregate({ _sum: { amount: true } });
  },

  sumApprovedExpenses() {
    return prisma.expense.aggregate({
      where: { status: 'APPROVED' },
      _sum: { amount: true },
    });
  },

  countPendingExpenses() {
    return prisma.expense.count({ where: { status: 'PENDING' } });
  },

  sumCreditsInRange(start: Date, end: Date) {
    return prisma.credit.aggregate({
      where: { date: { gte: start, lt: end } },
      _sum: { amount: true },
    });
  },

  sumApprovedExpensesInRange(start: Date, end: Date) {
    return prisma.expense.aggregate({
      where: { status: 'APPROVED', date: { gte: start, lt: end } },
      _sum: { amount: true },
    });
  },
};

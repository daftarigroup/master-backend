import { dashboardRepository } from '../repositories/dashboard.repository';

function todayRange() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export const dashboardService = {
  async getSummary() {
    const { start, end } = todayRange();

    const [creditTotal, approvedExpenseTotal, pendingCount, todayCreditTotal, todayExpenseTotal] =
      await Promise.all([
        dashboardRepository.sumAllCredits(),
        dashboardRepository.sumApprovedExpenses(),
        dashboardRepository.countPendingExpenses(),
        dashboardRepository.sumCreditsInRange(start, end),
        dashboardRepository.sumApprovedExpensesInRange(start, end),
      ]);

    const totalCredits = Number(creditTotal._sum.amount || 0);
    const totalApprovedExpenses = Number(approvedExpenseTotal._sum.amount || 0);

    return {
      totalCredits,
      totalApprovedExpenses,
      totalBalance: totalCredits - totalApprovedExpenses,
      pendingExpensesCount: pendingCount,
      todaysCredits: Number(todayCreditTotal._sum.amount || 0),
      todaysExpenses: Number(todayExpenseTotal._sum.amount || 0),
    };
  },
};

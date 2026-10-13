import { parseFirmId, resolveFirmScope, firmWhere } from '../../../utils/firmScope';
import type { UserAuthContext } from '../../../utils/currentUser';
import { istMonthOf } from '../../fleet/lib/istDate';
import { prisma } from '../../../database/prisma';
import { decimalToNumber } from './mapUtils';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Start of an IST calendar month as an instant (the sites run on IST, so a month starts at 00:00 IST).
function istMonthStart(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex, 1) - IST_OFFSET_MS);
}

function timeframeStart(timeframe: string): Date {
  const [y, m] = istMonthOf(new Date()).split('-').map(Number);
  if (timeframe === 'lastQuarter') return istMonthStart(y, m - 1 - 3);
  if (timeframe === 'thisYear') return istMonthStart(y, 0);
  return istMonthStart(y, m - 1); // thisMonth (default)
}

export const reportsService = {
  async costAnalysis(ctx: UserAuthContext | null, query: { timeframe?: string; departmentId?: string; firmId?: string }) {
    const from = timeframeStart(query.timeframe ?? 'thisMonth');
    const scope = resolveFirmScope(ctx, query.firmId);
    const departmentId = parseFirmId(query.departmentId);
    // Only finished work with a bill counts, and an out-sourced job only once it is back from the vendor (RECEIVED/PAID):
    // before that its cost is an estimate and it would be counted again when the final bill lands.
    const finished: Array<Record<string, unknown>> = [
      { outsourceStatus: null, completedAt: { gte: from } },
      { outsourceStatus: { in: ['RECEIVED', 'PAID'] }, receivedAt: { gte: from } },
    ];
    const workOrders = await prisma.maintenanceWorkOrder.findMany({
      where: {
        cost: { not: null },
        status: { in: ['COMPLETED', 'COMPLETED_LATE'] },
        AND: [
          { OR: finished },
          ...(departmentId !== null ? [{ machine: { departmentId } }] : []),
          ...(scope.all ? [] : [{ OR: [firmWhere(scope), firmWhere(scope, 'machine.firmId')] }]),
        ],
      } as any,
      select: { cost: true, completedAt: true, receivedAt: true, outsourceStatus: true, machine: { select: { department: { select: { name: true } } } } },
    });

    const monthlyMap = new Map<string, number>();
    const deptMap = new Map<string, number>();
    let totalCost = 0;

    for (const wo of workOrders) {
      const cost = decimalToNumber(wo.cost);
      totalCost += cost;
      const when = wo.outsourceStatus ? wo.receivedAt : wo.completedAt;
      const monthKey = when ? istMonthOf(when) : 'unknown';
      monthlyMap.set(monthKey, (monthlyMap.get(monthKey) ?? 0) + cost);
      const deptName = wo.machine?.department?.name ?? 'Unassigned';
      deptMap.set(deptName, (deptMap.get(deptName) ?? 0) + cost);
    }

    return {
      monthlyCosts: [...monthlyMap.entries()].map(([month, cost]) => ({ month, cost })).sort((a, b) => a.month.localeCompare(b.month)),
      departmentCosts: [...deptMap.entries()].map(([department, cost]) => ({ department, cost })),
      totalCost,
    };
  },

  async machineReliability(ctx: UserAuthContext | null, query: { timeframe?: string; departmentId?: string; firmId?: string }) {
    const from = timeframeStart(query.timeframe ?? 'thisMonth');
    const machines = await prisma.machine.findMany({
      where: {
        ...(parseFirmId(query.departmentId) !== null ? { departmentId: parseFirmId(query.departmentId)! } : {}),
        ...firmWhere(resolveFirmScope(ctx, query.firmId)),
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            workOrders: { where: { createdAt: { gte: from } } },
            breakdownReports: { where: { reportedAt: { gte: from } } },
          },
        },
      },
    });

    const points = machines.map((m) => {
      const totalWorkOrders = m._count.workOrders;
      const breakdownCount = m._count.breakdownReports;
      // Simple reliability heuristic: 100 minus a penalty per breakdown relative to
      // total maintenance activity — no historical MTBF data exists yet to do better.
      const reliabilityScore = totalWorkOrders === 0 ? 100 : Math.max(0, Math.round(100 - (breakdownCount / Math.max(totalWorkOrders, 1)) * 100));
      const status: 'Excellent' | 'Good' | 'Needs Attention' = reliabilityScore >= 85 ? 'Excellent' : reliabilityScore >= 60 ? 'Good' : 'Needs Attention';
      return { machineId: m.id, machineName: m.name, reliabilityScore, status, totalWorkOrders, breakdownCount, tenant: null };
    });

    return { machines: points };
  },
};

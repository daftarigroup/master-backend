import { prisma } from '../../../database/prisma';
import { decimalToNumber } from './mapUtils';

function timeframeStart(timeframe: string): Date {
  const now = new Date();
  if (timeframe === 'lastQuarter') return new Date(now.getFullYear(), now.getMonth() - 3, 1);
  if (timeframe === 'thisYear') return new Date(now.getFullYear(), 0, 1);
  return new Date(now.getFullYear(), now.getMonth(), 1); // thisMonth (default)
}

export const reportsService = {
  async costAnalysis(query: { timeframe?: string; departmentId?: string; firmId?: string }) {
    const from = timeframeStart(query.timeframe ?? 'thisMonth');
    const workOrders = await prisma.maintenanceWorkOrder.findMany({
      where: {
        cost: { not: null },
        completedAt: { gte: from },
        ...(query.departmentId ? { machine: { departmentId: BigInt(query.departmentId) } } : {}),
        ...(query.firmId ? { OR: [{ firmId: BigInt(query.firmId) }, { machine: { firmId: BigInt(query.firmId) } }] } : {}),
      },
      select: { cost: true, completedAt: true, machine: { select: { department: { select: { name: true } } } } },
    });

    const monthlyMap = new Map<string, number>();
    const deptMap = new Map<string, number>();
    let totalCost = 0;

    for (const wo of workOrders) {
      const cost = decimalToNumber(wo.cost);
      totalCost += cost;
      const monthKey = wo.completedAt ? wo.completedAt.toISOString().slice(0, 7) : 'unknown';
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

  async machineReliability(query: { timeframe?: string; departmentId?: string; firmId?: string }) {
    const from = timeframeStart(query.timeframe ?? 'thisMonth');
    const machines = await prisma.machine.findMany({
      where: {
        ...(query.departmentId ? { departmentId: BigInt(query.departmentId) } : {}),
        ...(query.firmId ? { firmId: BigInt(query.firmId) } : {}),
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

import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';

export class DashboardController {
  /**
   * GET /dashboard/stats
   */
  stats = asyncHandler(async (_req: Request, res: Response) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayStart = new Date(`${todayStr}T00:00:00.000Z`);

    const [
      totalEmployees,
      activeEmployees,
      presentToday,
      onLeaveToday,
      activeCandidates,
      pendingLeaves,
      pendingAdvances,
      todayGatePasses,
      allCandidates,
      departments,
      employeesWithDates,
    ] = await Promise.all([
      prisma.employee.count(),
      prisma.employee.count({ where: { status: 'active' } }),
      prisma.hrAttendance.count({ where: { date: todayStr, status: 'present' } }),
      prisma.hrAttendance.count({ where: { date: todayStr, status: 'leave' } }),
      prisma.hrCandidate.count({ where: { status: { notIn: ['rejected', 'joined'] } } }),
      prisma.hrLeave.count({ where: { status: 'pending' } }),
      prisma.hrAdvanceRequest.count({ where: { status: 'pending' } }),
      prisma.hrGatePass.count({ where: { created_at: { gte: todayStart } } }),
      prisma.hrCandidate.findMany({ select: { status: true } }),
      prisma.department.findMany({
        select: {
          name: true,
          _count: { select: { employees: true } },
        },
      }),
      prisma.employee.findMany({
        where: { status: 'active' },
        select: { name: true, joining_date: true, department: { select: { name: true } } },
      }),
    ]);

    // Funnel counts
    const funnelCounts: Record<string, number> = {
      pending: 0,
      shortlisted: 0,
      interview_scheduled: 0,
      interviewed: 0,
      selected: 0,
      joining_initiated: 0,
      joined: 0,
      rejected: 0,
    };
    for (const c of allCandidates) {
      const st = c.status?.toLowerCase() || 'pending';
      if (funnelCounts[st] !== undefined) {
        funnelCounts[st]++;
      } else {
        funnelCounts[st] = (funnelCounts[st] || 0) + 1;
      }
    }

    // Work anniversaries this month
    const curMonth = new Date().getMonth();
    const curYear = new Date().getFullYear();
    const workAnniversaries = employeesWithDates
      .filter((e) => e.joining_date && e.joining_date.getMonth() === curMonth)
      .map((e) => {
        const joinYear = e.joining_date!.getFullYear();
        const years = Math.max(1, curYear - joinYear);
        return {
          name: e.name,
          years,
          date: `${e.joining_date!.getDate()}th ${e.joining_date!.toLocaleString('en-US', { month: 'short' })}`,
          department: e.department?.name || 'Operations',
        };
      })
      .slice(0, 5);

    const upcomingBirthdays = [
      { name: 'Amit Bhardwaj', date: '14th Sep', department: 'Engineering' },
      { name: 'Sneha Kulkarni', date: '22nd Sep', department: 'Quality' },
    ];

    const departmentBreakdown = departments.map((d) => ({
      department: d.name,
      count: d._count.employees,
    }));

    res.json({
      success: true,
      data: {
        totalEmployees,
        activeEmployees,
        presentToday,
        onLeaveToday,
        openIndents: 2,
        activeCandidates,
        pendingLeaves,
        pendingAdvances,
        todayGatePasses,
        upcomingBirthdays,
        workAnniversaries,
        funnelCounts,
        departmentBreakdown,
      },
    });
  });
}

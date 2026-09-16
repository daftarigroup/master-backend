import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { HrAuditService } from '../services/hrAudit.service';

export class LeavingController {
  private formatLeavingEmployee(e: any) {
    const activeLoans = Array.isArray(e.loans) ? e.loans : [];
    const totalOutstanding = activeLoans.reduce((sum: number, l: any) => sum + Number(l.outstanding_balance || 0), 0);

    return {
      id: Number(e.id),
      employeeId: e.employee_id,
      empCode: e.emp_code || null,
      name: e.name,
      email: e.email || null,
      phone: e.phone || null,
      designation: e.designation || null,
      department: e.department ? { id: e.department.id.toString(), name: e.department.name } : null,
      status: e.status,
      resignationDate: e.resignation_date ? e.resignation_date.toISOString().slice(0, 10) : null,
      terminationDate: e.termination_date ? e.termination_date.toISOString().slice(0, 10) : null,
      separationType: e.separation_type || null,
      lastWorkingDay: e.last_working_day ? e.last_working_day.toISOString().slice(0, 10) : null,
      leavingReason: e.leaving_reason || null,
      exitChecklist: e.exit_checklist && typeof e.exit_checklist === 'object' ? e.exit_checklist : {},
      advancePaymentTaken: activeLoans.length > 0,
      advancePaymentAmount: totalOutstanding,
      advancePaymentSettled: totalOutstanding === 0,
      experienceLetterIssued: false,
      userAccount: e.user ? { id: e.user.id.toString(), active: Boolean(e.user.name) } : null,
      loans: activeLoans.map((l: any) => ({
        id: l.id,
        amount: Number(l.amount),
        outstandingBalance: Number(l.outstanding_balance),
        purpose: l.purpose || null,
        status: l.status,
      })),
      createdAt: e.created_at?.toISOString(),
    };
  }

  /**
   * GET /employee/leaving and GET /leaving
   */
  listLeaving = asyncHandler(async (_req: Request, res: Response) => {
    const leaving = await prisma.employee.findMany({
      where: {
        OR: [
          { status: { in: ['on_notice', 'exit_interview', 'left', 'completed', 'resigned', 'terminated'] } },
          { last_working_day: { not: null } },
        ],
      },
      include: {
        department: true,
        user: true,
        loans: { where: { status: 'active' } },
      },
      orderBy: { updated_at: 'desc' },
    });

    res.json({
      success: true,
      data: leaving.map((e: any) => this.formatLeavingEmployee(e)),
    });
  });

  /**
   * GET /leaving/my-status
   */
  myStatus = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = (req as any).employee?.employeeId;
    if (!employeeId) throw new ApiError(400, 'No employee record linked to your account');

    const emp = await prisma.employee.findFirst({
      where: { employee_id: employeeId },
      include: { department: true, user: true, loans: { where: { status: 'active' } } },
    });

    if (!emp) throw new ApiError(404, 'Employee record not found');

    res.json({
      success: true,
      data: this.formatLeavingEmployee(emp),
    });
  });

  /**
   * POST /employee/resign and POST /leaving/resign
   */
  resign = asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, resignationDate, lastWorkingDay, leavingReason } = req.body;

    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          /^\d+$/.test(String(employeeId)) ? { id: BigInt(employeeId) } : {},
          { employee_id: String(employeeId) },
        ],
      },
      include: { department: true, user: true, loans: { where: { status: 'active' } } },
    });

    if (!emp) throw new ApiError(404, 'Employee not found');

    const updated = await prisma.employee.update({
      where: { id: emp.id },
      data: {
        status: 'on_notice',
        last_working_day: new Date(lastWorkingDay),
        leaving_reason: leavingReason || null,
      },
      include: { department: true, user: true, loans: { where: { status: 'active' } } },
    });

    await HrAuditService.log({
      entityType: 'employee',
      entityId: emp.employee_id,
      eventType: 'RESIGNATION_RECORDED',
      performedBy: (req as any).user?.name || emp.name,
      notes: `Resignation submitted for ${emp.name}. LWD: ${lastWorkingDay}. Reason: ${leavingReason || 'None'}`,
    });

    res.status(201).json({
      success: true,
      message: 'Resignation recorded successfully. Employee moved to on_notice stage.',
      data: this.formatLeavingEmployee(updated),
    });
  });

  /**
   * PATCH /employee/:id/process-exit and PATCH /leaving/:id
   */
  processExit = asyncHandler(async (req: Request, res: Response) => {
    const idParam = String(req.params.id);
    const body = req.body;
    const actorName = (req as any).user?.name || 'Admin';

    const where: any = /^\d+$/.test(idParam)
      ? { OR: [{ id: BigInt(idParam) }, { employee_id: idParam }] }
      : { employee_id: idParam };

    const emp = await prisma.employee.findFirst({
      where,
      include: { department: true, user: true, loans: { where: { status: 'active' } } },
    });

    if (!emp) throw new ApiError(404, 'Employee not found');

    const targetStatus = body.status || emp.status;

    // Loan settlement check: HARD BLOCK if advancing to 'left' or 'completed' with active loans
    if (targetStatus === 'left' || targetStatus === 'completed') {
      const activeLoans = await prisma.hrEmployeeLoan.findMany({
        where: { employee_id: emp.employee_id, status: 'active' },
      });
      const totalOutstanding = activeLoans.reduce((sum, l) => sum + Number(l.outstanding_balance), 0);

      if (totalOutstanding > 0 && !body.advancePaymentSettled) {
        throw new ApiError(
          400,
          `Cannot mark as "${targetStatus}" — ₹${totalOutstanding.toLocaleString('en-IN')} advance is still outstanding`
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const updateData: any = {};
      if (body.status !== undefined) updateData.status = body.status;
      if (body.exitChecklist !== undefined) updateData.exit_checklist = body.exitChecklist;

      // If completing exit and linked user exists, deactivate login
      if (targetStatus === 'completed' && emp.user_id) {
        await tx.user.update({
          where: { id: emp.user_id },
          data: {
            page_access: [],
            system_access: {},
          },
        });
      }

      const updated = await tx.employee.update({
        where: { id: emp.id },
        data: updateData,
        include: { department: true, user: true, loans: { where: { status: 'active' } } },
      });

      await HrAuditService.log(
        {
          entityType: 'employee',
          entityId: emp.employee_id,
          eventType: 'EXIT_PROCESSED',
          performedBy: actorName,
          notes: `Exit process updated to stage "${targetStatus}". ${targetStatus === 'completed' && emp.user_id ? 'Linked User login deactivated.' : ''}`,
        },
        tx
      );

      return updated;
    });

    res.json({
      success: true,
      message: 'Exit workflow updated successfully',
      data: this.formatLeavingEmployee(result),
    });
  });

  /**
   * PATCH /employee/:id/deactivate-user
   */
  deactivateUser = asyncHandler(async (req: Request, res: Response) => {
    const idParam = String(req.params.id);

    const where: any = /^\d+$/.test(idParam)
      ? { OR: [{ id: BigInt(idParam) }, { employee_id: idParam }] }
      : { employee_id: idParam };

    const emp: any = await prisma.employee.findFirst({
      where,
      include: { user: true },
    });

    if (!emp) throw new ApiError(404, 'Employee not found');
    if (!emp.user_id) throw new ApiError(400, 'No linked user account exists for this employee');

    await prisma.user.update({
      where: { id: emp.user_id },
      data: {
        page_access: [],
        system_access: {},
      },
    });

    await HrAuditService.log({
      entityType: 'employee',
      entityId: emp.employee_id,
      eventType: 'USER_ACCOUNT_DEACTIVATED',
      performedBy: (req as any).user?.name || 'Admin',
      notes: `Deactivated linked user login for ${emp.name}`,
    });

    res.json({
      success: true,
      message: 'Linked user login deactivated successfully',
      data: {
        id: emp.user_id.toString(),
        isActive: false,
        email: emp.email || emp.user?.user_name || '',
      },
    });
  });
}

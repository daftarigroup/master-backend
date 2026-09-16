import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { HrAuditService } from '../services/hrAudit.service';

export class AdvanceController {
  private formatAdvance(a: any) {
    return {
      id: Number(a.id),
      employeeId: a.employee_id,
      employeeName: a.employee_name || a.employee?.name || 'Employee',
      empCode: a.emp_code || a.employee?.emp_code || null,
      department: a.employee?.department ? { id: String(a.employee.department.id), name: a.employee.department.name } : (a.department_name ? { id: '', name: a.department_name } : null),
      departmentName: a.department_name || a.employee?.department?.name || null,
      requestAmount: Number(a.request_amount),
      monthlyDeduction: Number(a.monthly_deduction),
      noOfMonths: a.no_of_months,
      reason: a.reason,
      status: a.status,
      remarks: a.remarks || null,
      approvedAmount: a.approved_amount ? Number(a.approved_amount) : null,
      approvedMonthlyDeduction: a.approved_monthly_deduction ? Number(a.approved_monthly_deduction) : null,
      approvedNoOfMonths: a.approved_no_of_months || null,
      requestDate: a.request_date instanceof Date ? a.request_date.toISOString().slice(0, 10) : a.request_date,
      approvedDate: a.approved_date ? a.approved_date.toISOString().slice(0, 10) : null,
      startDeductionMonth: a.start_deduction_month || null,
      loanId: a.loan_id || null,
      createdAt: a.created_at?.toISOString(),
      updatedAt: a.updated_at?.toISOString(),
    };
  }

  /**
   * GET /advance-request
   */
  list = asyncHandler(async (req: Request, res: Response) => {
    const { status, employeeId } = req.query as any;
    const where: any = {};
    if (status && status !== 'all') where.status = status;
    if (employeeId) where.employee_id = employeeId;

    const requests = await prisma.hrAdvanceRequest.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: { employee: { include: { department: true } } },
    });

    res.json({
      success: true,
      data: requests.map((r: any) => this.formatAdvance(r)),
    });
  });

  /**
   * GET /advance-request/stats
   */
  stats = asyncHandler(async (_req: Request, res: Response) => {
    const allRequests = await prisma.hrAdvanceRequest.findMany({
      include: {
        employee: { include: { department: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    const approvedRequests = allRequests.filter((r) => r.status === 'approved' || r.status === 'completed');
    const loanIds = approvedRequests.filter((r) => r.loan_id).map((r) => r.loan_id as string);
    const loans = loanIds.length
      ? await prisma.hrEmployeeLoan.findMany({
          where: { id: { in: loanIds } },
        })
      : [];

    const loanMap = new Map(loans.map((l) => [l.id, l]));

    const totalDisbursed = approvedRequests.reduce(
      (s, r) => s + Number(r.approved_amount || r.request_amount || 0),
      0
    );
    const totalOutstanding = loans.reduce(
      (s, l) => s + (l.status === 'settled' || l.status === 'paid' ? 0 : Number(l.outstanding_balance || 0)),
      0
    );
    const totalCollected = Math.max(0, totalDisbursed - totalOutstanding);
    const recoveryRate =
      totalDisbursed > 0 ? Math.round((totalCollected / totalDisbursed) * 1000) / 10 : 0;

    const activeLoanCount = loans.filter((l) => l.status === 'active').length;
    const paidLoanCount = loans.filter((l) => l.status === 'paid' || l.status === 'settled').length;

    // Department breakdown
    const deptMap: Record<string, { name: string; count: number; amount: number }> = {};
    for (const req of approvedRequests) {
      const deptName = req.employee?.department?.name || req.department_name || 'No Department';
      if (!deptMap[deptName]) deptMap[deptName] = { name: deptName, count: 0, amount: 0 };
      deptMap[deptName].count++;
      deptMap[deptName].amount += Number(req.approved_amount || req.request_amount || 0);
    }

    // Monthly disbursement trend (last 6 months)
    const now = new Date();
    const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const bucket = approvedRequests.filter((r) => {
        const rd = new Date(r.approved_date || r.request_date);
        return rd.getMonth() + 1 === m && rd.getFullYear() === y;
      });
      return {
        label: d.toLocaleDateString('en-IN', {
          month: 'short',
          year: '2-digit',
        }),
        disbursed: bucket.reduce(
          (s, r) => s + Number(r.approved_amount || r.request_amount || 0),
          0
        ),
        count: bucket.length,
      };
    });

    // Per-employee loan summary
    const employeeSummary = approvedRequests.map((r) => {
      const loan = r.loan_id ? loanMap.get(r.loan_id) : undefined;
      const loanStatus = loan?.status || (r.status === 'completed' ? 'paid' : 'active');
      const loanAmount = loan?.amount ? Number(loan.amount) : Number(r.approved_amount || r.request_amount || 0);
      const outstandingBalance = loan?.outstanding_balance !== undefined ? Number(loan.outstanding_balance) : 0;
      return {
        advanceId: Number(r.id),
        employeeId: r.employee_id,
        empCode: r.emp_code || r.employee?.emp_code || null,
        employeeName: r.employee_name || r.employee?.name || 'Employee',
        department: r.employee?.department?.name || r.department_name || null,
        disbursedAmount: loanAmount,
        newlyDisbursedAmount: Number(r.approved_amount || r.request_amount || 0),
        priorRolledIn: 0,
        monthlyEmi: Number(r.approved_monthly_deduction || r.monthly_deduction || 0),
        totalMonths: r.approved_no_of_months || r.no_of_months,
        startDeductionMonth: r.start_deduction_month,
        approvedDate: r.approved_date ? r.approved_date.toISOString().slice(0, 10) : null,
        loanId: r.loan_id || null,
        outstandingBalance,
        loanStatus,
        collected: Math.max(0, loanAmount - outstandingBalance),
        createdAt: r.created_at?.toISOString(),
      };
    });

    const totalRequested = allRequests.reduce((s, r) => s + Number(r.request_amount || 0), 0);
    const pendingCount = allRequests.filter((r) => r.status === 'pending').length;

    res.json({
      success: true,
      data: {
        totalDisbursed,
        totalOutstanding,
        totalCollected,
        recoveryRate,
        activeLoanCount,
        paidLoanCount,
        totalApprovedCount: approvedRequests.length,
        departmentBreakdown: Object.values(deptMap).sort((a, b) => b.amount - a.amount),
        monthlyTrend,
        employeeSummary,
        // Legacy fields
        totalRequested,
        totalApproved: totalDisbursed,
        pendingCount,
        activeLoansCount: activeLoanCount,
        totalOutstandingBalance: totalOutstanding,
      },
    });
  });

  /**
   * GET /advance-request/:id
   */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const request = await prisma.hrAdvanceRequest.findUnique({
      where: { id },
      include: { employee: { include: { department: true } } },
    });

    if (!request) throw new ApiError(404, 'Advance request not found');

    res.json({
      success: true,
      data: this.formatAdvance(request),
    });
  });

  /**
   * GET /advance-request/employee/:employeeId
   */
  getByEmployee = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId);
    const requests = await prisma.hrAdvanceRequest.findMany({
      where: { employee_id: employeeId },
      orderBy: { created_at: 'desc' },
      include: { employee: { include: { department: true } } },
    });

    res.json({
      success: true,
      data: requests.map((r: any) => this.formatAdvance(r)),
    });
  });

  /**
   * POST /advance-request/submit
   */
  submit = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;

    const employee = await prisma.employee.findFirst({
      where: { employee_id: body.employeeId },
      include: { department: true },
    });

    const requestAmount = Number(body.requestAmount);
    const monthlyDeduction = Number(body.monthlyDeduction);
    const noOfMonths = body.noOfMonths
      ? Number(body.noOfMonths)
      : (requestAmount > 0 && monthlyDeduction > 0 ? Math.ceil(requestAmount / monthlyDeduction) : 1);

    const request = await prisma.hrAdvanceRequest.create({
      data: {
        employee_id: body.employeeId,
        employee_name: body.employeeName || employee?.name || 'Employee',
        emp_code: body.empCode || employee?.emp_code || null,
        department_name: body.departmentName || employee?.department?.name || null,
        request_amount: requestAmount,
        monthly_deduction: monthlyDeduction,
        no_of_months: noOfMonths,
        reason: body.reason,
        status: 'pending',
      },
      include: { employee: { include: { department: true } } },
    });

    await HrAuditService.log({
      entityType: 'advance',
      entityId: request.id.toString(),
      eventType: 'ADVANCE_REQUEST_SUBMITTED',
      performedBy: (req as any).user?.name || body.employeeName,
      notes: `Advance requested: ₹${requestAmount} (${noOfMonths} months at ₹${monthlyDeduction}/mo) for: ${body.reason}`,
    });

    res.status(201).json({
      success: true,
      message: 'Advance request submitted successfully',
      data: this.formatAdvance(request),
    });
  });

  /**
   * PATCH /advance-request/:id/status
   */
  updateStatus = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body;
    const approverName = (req as any).user?.name || 'Admin';

    const reqRecord = await prisma.hrAdvanceRequest.findUnique({ where: { id } });
    if (!reqRecord) throw new ApiError(404, 'Advance request not found');

    const result = await prisma.$transaction(async (tx) => {
      let loanId = reqRecord.loan_id;

      if (body.status === 'approved') {
        const approvedAmount = body.approvedAmount !== undefined ? Number(body.approvedAmount) : Number(reqRecord.request_amount);
        const approvedMonthlyDeduction = body.approvedMonthlyDeduction !== undefined ? Number(body.approvedMonthlyDeduction) : Number(reqRecord.monthly_deduction);
        const approvedNoOfMonths = body.approvedNoOfMonths !== undefined
          ? Number(body.approvedNoOfMonths)
          : (approvedAmount > 0 && approvedMonthlyDeduction > 0 ? Math.ceil(approvedAmount / approvedMonthlyDeduction) : reqRecord.no_of_months);
        const startMonth = body.startDeductionMonth || new Date().toISOString().slice(0, 7);

        if (!loanId) {
          const year = new Date().getFullYear();
          const loanCount = await tx.hrEmployeeLoan.count();
          loanId = `LN-${year}-${String(loanCount + 1).padStart(3, '0')}`;
        }

        // Create or update active loan
        await tx.hrEmployeeLoan.upsert({
          where: { id: loanId },
          create: {
            id: loanId,
            employee_id: reqRecord.employee_id,
            amount: approvedAmount,
            emi_amount: approvedMonthlyDeduction,
            outstanding_balance: approvedAmount,
            purpose: reqRecord.reason,
            status: 'active',
          },
          update: {
            amount: approvedAmount,
            emi_amount: approvedMonthlyDeduction,
            outstanding_balance: approvedAmount,
            status: 'active',
          },
        });

        const updated = await tx.hrAdvanceRequest.update({
          where: { id },
          data: {
            status: 'approved',
            remarks: body.remarks !== undefined ? body.remarks : reqRecord.remarks,
            approved_amount: approvedAmount,
            approved_monthly_deduction: approvedMonthlyDeduction,
            approved_no_of_months: approvedNoOfMonths,
            approved_date: new Date(),
            start_deduction_month: startMonth,
            loan_id: loanId,
          },
          include: { employee: { include: { department: true } } },
        });

        await HrAuditService.log(
          {
            entityType: 'advance',
            entityId: id.toString(),
            eventType: 'ADVANCE_REQUEST_APPROVED',
            performedBy: approverName,
            notes: `Approved advance of ₹${approvedAmount} (Loan #${loanId})`,
          },
          tx
        );

        return updated;
      } else {
        const updated = await tx.hrAdvanceRequest.update({
          where: { id },
          data: {
            status: body.status,
            remarks: body.remarks !== undefined ? body.remarks : reqRecord.remarks,
          },
          include: { employee: { include: { department: true } } },
        });

        await HrAuditService.log(
          {
            entityType: 'advance',
            entityId: id.toString(),
            eventType: `ADVANCE_REQUEST_${body.status.toUpperCase()}`,
            performedBy: approverName,
            notes: `Advance request #${id} updated to ${body.status}`,
          },
          tx
        );

        return updated;
      }
    });

    res.json({
      success: true,
      message: `Advance request ${body.status} successfully`,
      data: this.formatAdvance(result),
    });
  });

  /**
   * PATCH /advance-request/:id
   */
  update = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body;

    const data: any = {};
    if (body.requestAmount !== undefined) data.request_amount = Number(body.requestAmount);
    if (body.monthlyDeduction !== undefined) data.monthly_deduction = Number(body.monthlyDeduction);
    if (body.noOfMonths !== undefined) data.no_of_months = Number(body.noOfMonths);
    if (body.approvedAmount !== undefined) data.approved_amount = Number(body.approvedAmount);
    if (body.approvedMonthlyDeduction !== undefined) data.approved_monthly_deduction = Number(body.approvedMonthlyDeduction);
    if (body.approvedNoOfMonths !== undefined) data.approved_no_of_months = Number(body.approvedNoOfMonths);
    if (body.startDeductionMonth !== undefined) data.start_deduction_month = body.startDeductionMonth;
    if (body.remarks !== undefined) data.remarks = body.remarks;
    if (body.reason !== undefined) data.reason = body.reason;
    if (body.status !== undefined) data.status = body.status;

    const updated = await prisma.hrAdvanceRequest.update({
      where: { id },
      data,
      include: { employee: { include: { department: true } } },
    });

    res.json({
      success: true,
      message: 'Advance request updated successfully',
      data: this.formatAdvance(updated),
    });
  });

  /**
   * DELETE /advance-request/:id
   */
  delete = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    await prisma.hrAdvanceRequest.delete({ where: { id } });
    res.json({ success: true, message: 'Advance request deleted successfully' });
  });

  /**
   * GET /advance-request/:id/loan-history
   */
  getLoanHistory = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const reqRecord = await prisma.hrAdvanceRequest.findUnique({ where: { id } });
    if (!reqRecord || !reqRecord.loan_id) {
      res.json({ success: true, data: null });
      return;
    }

    const loan = await prisma.hrEmployeeLoan.findUnique({
      where: { id: reqRecord.loan_id },
    });

    if (!loan) {
      res.json({ success: true, data: null });
      return;
    }

    // Query payslips where loan_deduction was applied for this employee
    const payslips = await prisma.hrPayslip.findMany({
      where: {
        employee_id: loan.employee_id,
        loan_deduction: { gt: 0 },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    let runningBal = Number(loan.amount);
    const deductions = payslips.map((p) => {
      const ded = Number(p.loan_deduction);
      runningBal = Math.max(0, runningBal - ded);
      return {
        month: p.month,
        year: p.year,
        deductionAmount: ded,
        balanceAfter: runningBal,
        date: p.paid_date ? p.paid_date.toISOString().slice(0, 10) : `${p.year}-${String(p.month).padStart(2, '0')}-01`,
      };
    });

    res.json({
      success: true,
      data: {
        loanId: loan.id,
        employeeId: loan.employee_id,
        amount: Number(loan.amount),
        emiAmount: Number(loan.emi_amount),
        outstandingBalance: Number(loan.outstanding_balance),
        status: loan.status,
        startDate: loan.start_date.toISOString().slice(0, 10),
        deductions,
      },
    });
  });

  /**
   * PATCH /advance-request/:id/complete
   */
  markComplete = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const reqRecord = await prisma.hrAdvanceRequest.findUnique({ where: { id } });
    if (!reqRecord) throw new ApiError(404, 'Advance request not found');

    const result = await prisma.$transaction(async (tx) => {
      if (reqRecord.loan_id) {
        await tx.hrEmployeeLoan.update({
          where: { id: reqRecord.loan_id },
          data: { status: 'settled', outstanding_balance: 0 },
        });
      }

      return tx.hrAdvanceRequest.update({
        where: { id },
        data: { status: 'completed' },
        include: { employee: { include: { department: true } } },
      });
    });

    res.json({
      success: true,
      message: 'Advance loan marked as complete',
      data: this.formatAdvance(result),
    });
  });

  /**
   * PATCH /advance-request/loan/:loanId/settle
   */
  settleLoan = asyncHandler(async (req: Request, res: Response) => {
    const loanId = String(req.params.loanId);
    const loan = await prisma.hrEmployeeLoan.findUnique({ where: { id: loanId } });
    if (!loan) throw new ApiError(404, 'Loan record not found');

    await prisma.$transaction(async (tx) => {
      await tx.hrEmployeeLoan.update({
        where: { id: loanId },
        data: { status: 'settled', outstanding_balance: 0 },
      });

      await tx.hrAdvanceRequest.updateMany({
        where: { loan_id: loanId },
        data: { status: 'completed' },
      });

      await HrAuditService.log(
        {
          entityType: 'advance',
          entityId: loanId,
          eventType: 'LOAN_SETTLED',
          performedBy: (req as any).user?.name || 'Admin',
          notes: `Loan #${loanId} fully settled. Outstanding balance set to 0.`,
        },
        tx
      );
    });

    res.json({
      success: true,
      message: `Loan #${loanId} settled successfully`,
    });
  });
}

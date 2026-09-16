import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { HrAuditService } from '../services/hrAudit.service';
import {
  computePayslip,
  computeStructureBreakdown,
  DeductionDef,
  PayPolicyRates,
  StructurePercents,
} from '../services/salaryCalc.service';

const DEFAULT_STRUCTURE: StructurePercents = {
  basicPercent: 40,
  hraPercent: 20,
  conveyancePercent: 10,
  medicalPercent: 5,
  specialAllowancePercent: 25,
};

export class SalaryController {
  private getDaysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
  }

  private async resolveEmployeeId(req: Request): Promise<string | null> {
    const fromReq = (req as any).employee?.employeeId;
    if (fromReq) return fromReq;

    const user = (req as any).user;
    if (!user) return null;

    try {
      const orConditions: any[] = [];
      if (user.id && !isNaN(Number(user.id))) {
        orConditions.push({ user_id: BigInt(user.id) });
      }
      if (user.email) {
        orConditions.push({ email: user.email });
      }
      if (orConditions.length > 0) {
        const emp = await prisma.employee.findFirst({
          where: { OR: orConditions },
        });
        if (emp) return emp.employee_id;
      }
    } catch {
      // ignore lookup failure
    }
    return null;
  }

  /**
   * Resolves the effective salary structure for an employee: their own
   * override, falling back to the global structure, falling back to
   * hardcoded defaults if neither has ever been saved.
   */
  private async resolveStructure(
    employeeId: string
  ): Promise<{ id: number | null; structure: StructurePercents; deductions: DeductionDef[] }> {
    const [own, global] = await Promise.all([
      prisma.hrSalaryStructure.findUnique({ where: { employee_id: employeeId } }),
      prisma.hrSalaryStructure.findUnique({ where: { employee_id: '__GLOBAL__' } }),
    ]);

    const source = own || global;
    if (!source) {
      return { id: null, structure: DEFAULT_STRUCTURE, deductions: [] };
    }

    return {
      id: Number(source.id),
      structure: {
        basicPercent: Number(source.basic_percent),
        hraPercent: Number(source.hra_percent),
        conveyancePercent: Number(source.conveyance_percent),
        medicalPercent: Number(source.medical_percent),
        specialAllowancePercent: Number(source.special_allowance_percent),
      },
      deductions: Array.isArray(source.deductions) ? (source.deductions as unknown as DeductionDef[]) : [],
    };
  }

  /**
   * Resolves the singleton pay policy row, lazily creating a default one if
   * it has never been saved (mirrors HrAttendanceConfig's convention).
   */
  private async resolvePayPolicy(): Promise<PayPolicyRates & { row: any }> {
    let row = await prisma.hrPayPolicy.findFirst();
    if (!row) {
      row = await prisma.hrPayPolicy.create({ data: {} });
    }
    return {
      row,
      otEnabled: row.ot_enabled,
      standardShiftHours: Number(row.standard_shift_hours),
      overtimeRateMultiplier: Number(row.overtime_rate_multiplier),
      pfEnabled: row.pf_enabled,
      pfEmployeeRate: Number(row.pf_employee_rate),
      pfEmployerRate: Number(row.pf_employer_rate),
      esiEnabled: row.esi_enabled,
      esiEmployeeRate: Number(row.esi_employee_rate),
      esiEmployerRate: Number(row.esi_employer_rate),
      esiGrossLimit: Number(row.esi_gross_limit),
    };
  }

  private mapPayPolicyResponse(row: any) {
    return {
      otEnabled: row.ot_enabled,
      otMode: row.ot_mode,
      standardShiftHours: Number(row.standard_shift_hours),
      overtimeRateMultiplier: Number(row.overtime_rate_multiplier),
      weekendOtMultiplier: Number(row.weekend_ot_multiplier),
      holidayOtMultiplier: Number(row.holiday_ot_multiplier),
      weekendWorkMultiplier: Number(row.weekend_work_multiplier),
      holidayWorkMultiplier: Number(row.holiday_work_multiplier),
      lateGraceMinutes: row.late_grace_minutes,
      lateDeductType: row.late_deduct_type,
      halfDayAfterLateMinutes: row.half_day_after_late_minutes,
      punchMisTreatment: row.punch_mis_treatment,
      pfEnabled: row.pf_enabled,
      pfEmployeeRate: Number(row.pf_employee_rate),
      pfEmployerRate: Number(row.pf_employer_rate),
      esiEnabled: row.esi_enabled,
      esiEmployeeRate: Number(row.esi_employee_rate),
      esiEmployerRate: Number(row.esi_employer_rate),
      esiGrossLimit: Number(row.esi_gross_limit),
      professionalTaxEnabled: row.professional_tax_enabled,
    };
  }

  /**
   * GET /salary/payroll?month=&year=
   */
  getPayroll = asyncHandler(async (req: Request, res: Response) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const daysInMonth = this.getDaysInMonth(year, month);

    const [employees, attendances, payslips, structures, policy] = await Promise.all([
      prisma.employee.findMany({
        where: { status: 'active' },
        include: { department: true, home_firm: true, loans: { where: { status: 'active' } } },
        orderBy: { name: 'asc' },
      }),
      prisma.hrAttendance.findMany({ where: { date: { startsWith: prefix } } }),
      prisma.hrPayslip.findMany({ where: { month, year } }),
      prisma.hrSalaryStructure.findMany(),
      this.resolvePayPolicy(),
    ]);

    const globalStructure = structures.find((s) => s.employee_id === '__GLOBAL__') || null;
    const structureByEmployee = new Map(structures.map((s) => [s.employee_id, s]));

    const employeesOut = employees.map((emp: any) => {
      const empAtt = attendances.filter((a: any) => a.employee_id === emp.employee_id);
      const presentDays = empAtt.filter((a: any) => a.status === 'present').length;
      const leaveDays = empAtt.filter((a: any) => a.status === 'leave').length;
      const halfDays = empAtt.filter((a: any) => a.status === 'half-day').length;
      const absentDays = Math.max(0, daysInMonth - (presentDays + leaveDays + halfDays));
      const totalOtHours = empAtt.reduce((sum: number, a: any) => sum + Number(a.overtime || 0), 0);

      const structureRow = structureByEmployee.get(emp.employee_id) || globalStructure;
      const structure: StructurePercents = structureRow
        ? {
            basicPercent: Number(structureRow.basic_percent),
            hraPercent: Number(structureRow.hra_percent),
            conveyancePercent: Number(structureRow.conveyance_percent),
            medicalPercent: Number(structureRow.medical_percent),
            specialAllowancePercent: Number(structureRow.special_allowance_percent),
          }
        : DEFAULT_STRUCTURE;
      const deductions: DeductionDef[] = structureRow && Array.isArray(structureRow.deductions)
        ? (structureRow.deductions as unknown as DeductionDef[])
        : [];

      const activeLoan = emp.loans && emp.loans[0] ? emp.loans[0] : null;

      const calc = computePayslip({
        monthlySalary: Number(emp.monthly_salary || 30000),
        pfEligible: Boolean(emp.pf_eligible),
        esicEligible: Boolean(emp.esic_eligible),
        daysInMonth,
        presentDays,
        leaveDays,
        halfDays,
        overtimeHours: totalOtHours,
        structure,
        deductions,
        policy,
        loanEmi: activeLoan ? Number(activeLoan.emi_amount) : 0,
        loanOutstanding: activeLoan ? Number(activeLoan.outstanding_balance) : 0,
      });

      const matchedPayslip = payslips.find((p: any) => p.employee_id === emp.employee_id);

      return {
        id: Number(emp.id),
        employeeId: emp.employee_id,
        empCode: emp.emp_code || null,
        name: emp.name,
        email: emp.email || null,
        designation: emp.designation || null,
        department: emp.department ? { id: String(emp.department.id), name: emp.department.name } : null,
        joiningDate: emp.joining_date ? emp.joining_date.toISOString().slice(0, 10) : null,
        status: emp.status,
        salaryOnHold: Boolean(emp.salary_on_hold),
        salaryHoldReason: emp.salary_hold_reason || null,
        monthlySalary: Number(emp.monthly_salary || 30000),
        daysPresent: presentDays,
        workingDays: daysInMonth,
        overtimeHours: Number(totalOtHours.toFixed(2)),
        weekendWorkDays: 0,
        holidayWorkDays: 0,
        weekOffDays: 0,
        elapsedWeekOffDays: 0,
        holidays: 0,
        elapsedHolidays: 0,
        payslip: matchedPayslip
          ? {
              id: Number(matchedPayslip.id),
              month: matchedPayslip.month,
              year: matchedPayslip.year,
              daysPresent: Number(matchedPayslip.present_days),
              calculationDays: Number(matchedPayslip.calculation_days),
              monthlyCTC: Number(matchedPayslip.monthly_ctc),
              grossEarnings: Number(matchedPayslip.gross_salary),
              totalDeductions: Number(matchedPayslip.total_deductions),
              netPay: Number(matchedPayslip.net_salary),
              overtimeHours: Number(matchedPayslip.overtime_hours),
              weekendWorkDays: 0,
              holidayWorkDays: 0,
              otPay: Number(matchedPayslip.overtime_pay),
              weekendPay: 0,
              holidayPay: 0,
              deductionBreakdown: Array.isArray(matchedPayslip.deduction_breakdown)
                ? matchedPayslip.deduction_breakdown
                : [],
              status: matchedPayslip.status,
              paidDate: matchedPayslip.paid_date?.toISOString().slice(0, 10) || null,
              remarks: null,
            }
          : null,
        company: emp.home_firm?.firm_name || null,
        location: emp.work_location || null,
        mode: emp.payment_mode || null,
        bankName: emp.bank_branch_name || null,
        bankAccount: emp.bank_account || null,
        ifscCode: emp.ifsc_code || null,
        uan: emp.past_pf_no || null,
        insuranceId: emp.esic_no || null,
        salaryBreakdown: {
          basic: calc.basic,
          hra: calc.hra,
          conveyance: calc.conveyance,
          medicalAllowance: calc.medicalAllowance,
          specialAllowance: calc.specialAllowance,
          grossEarnings: calc.grossEarnings,
          empPF: calc.empPF,
          erPF: calc.erPF,
          empESIC: calc.empESIC,
          erESIC: calc.erESIC,
          isPreview: !matchedPayslip,
        },
        _calc: calc,
        _absentDays: absentDays,
      };
    });

    const totalGrossPayroll = employeesOut.reduce((s, e) => s + (e.payslip?.grossEarnings ?? e._calc.grossEarnings), 0);
    const totalNetPayroll = employeesOut.reduce((s, e) => s + (e.payslip?.netPay ?? e._calc.netPay), 0);
    const totalDeductions = employeesOut.reduce((s, e) => s + (e.payslip?.totalDeductions ?? e._calc.totalDeductions), 0);

    const employeesResponse = employeesOut.map(({ _calc, _absentDays, ...rest }) => rest);

    res.json({
      success: true,
      data: {
        month,
        year,
        workingDays: daysInMonth,
        totalEmployees: employeesResponse.length,
        totalGrossPayroll: Math.round(totalGrossPayroll * 100) / 100,
        totalNetPayroll: Math.round(totalNetPayroll * 100) / 100,
        totalDeductions: Math.round(totalDeductions * 100) / 100,
        employees: employeesResponse,
      },
    });
  });

  /**
   * GET /salary/structure
   */
  getGlobalStructure = asyncHandler(async (_req: Request, res: Response) => {
    const structure = await prisma.hrSalaryStructure.findUnique({
      where: { employee_id: '__GLOBAL__' },
    });

    if (!structure) {
      return res.json({
        success: true,
        data: {
          basicPercent: 40,
          hraPercent: 20,
          conveyancePercent: 10,
          medicalPercent: 5,
          specialAllowancePercent: 25,
          deductions: [],
        },
      });
    }

    res.json({
      success: true,
      data: {
        basicPercent: Number(structure.basic_percent),
        hraPercent: Number(structure.hra_percent),
        conveyancePercent: Number(structure.conveyance_percent),
        medicalPercent: Number(structure.medical_percent),
        specialAllowancePercent: Number(structure.special_allowance_percent),
        deductions: Array.isArray(structure.deductions) ? structure.deductions : [],
      },
    });
  });

  /**
   * POST /salary/structure
   */
  saveGlobalStructure = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    await prisma.hrSalaryStructure.upsert({
      where: { employee_id: '__GLOBAL__' },
      create: {
        employee_id: '__GLOBAL__',
        basic_percent: body.basicPercent ?? 40,
        hra_percent: body.hraPercent ?? 20,
        conveyance_percent: body.conveyancePercent ?? 10,
        medical_percent: body.medicalPercent ?? 5,
        special_allowance_percent: body.specialAllowancePercent ?? 25,
        deductions: body.deductions || [],
      },
      update: {
        basic_percent: body.basicPercent ?? 40,
        hra_percent: body.hraPercent ?? 20,
        conveyance_percent: body.conveyancePercent ?? 10,
        medical_percent: body.medicalPercent ?? 5,
        special_allowance_percent: body.specialAllowancePercent ?? 25,
        deductions: body.deductions || [],
      },
    });

    res.json({ success: true, message: 'Salary structure updated', data: body });
  });

  /**
   * GET /salary/structure/employee/:employeeId
   */
  getEmployeeStructure = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId);
    const structure = await prisma.hrSalaryStructure.findUnique({
      where: { employee_id: employeeId },
    });

    if (!structure) {
      res.json({ success: true, data: null });
      return;
    }

    res.json({
      success: true,
      data: {
        id: Number(structure.id),
        employeeId: structure.employee_id,
        basicPercent: Number(structure.basic_percent),
        hraPercent: Number(structure.hra_percent),
        conveyancePercent: Number(structure.conveyance_percent),
        medicalPercent: Number(structure.medical_percent),
        specialAllowancePercent: Number(structure.special_allowance_percent),
        deductions: Array.isArray(structure.deductions) ? structure.deductions : [],
      },
    });
  });

  /**
   * POST /salary/structure/employee/:employeeId
   */
  upsertEmployeeStructure = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId);
    const body = req.body;

    const structure = await prisma.hrSalaryStructure.upsert({
      where: { employee_id: employeeId },
      create: {
        employee_id: employeeId,
        basic_percent: body.basicPercent,
        hra_percent: body.hraPercent,
        conveyance_percent: body.conveyancePercent,
        medical_percent: body.medicalPercent,
        special_allowance_percent: body.specialAllowancePercent,
        deductions: body.deductions || [],
      },
      update: {
        basic_percent: body.basicPercent,
        hra_percent: body.hraPercent,
        conveyance_percent: body.conveyancePercent,
        medical_percent: body.medicalPercent,
        special_allowance_percent: body.specialAllowancePercent,
        deductions: body.deductions || [],
      },
    });

    res.json({
      success: true,
      message: 'Employee salary structure updated successfully',
      data: {
        id: Number(structure.id),
        employeeId: structure.employee_id,
        basicPercent: Number(structure.basic_percent),
        hraPercent: Number(structure.hra_percent),
        conveyancePercent: Number(structure.conveyance_percent),
        medicalPercent: Number(structure.medical_percent),
        specialAllowancePercent: Number(structure.special_allowance_percent),
      },
    });
  });

  /**
   * POST /salary/structure/preview
   * Server-side version of the ₹50k-CTC structure preview shown while
   * editing Basic/HRA/Conveyance/Medical/Special % — replaces the
   * duplicated client-side calculation in both structure-editor modals.
   */
  previewStructure = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    const structure: StructurePercents = {
      basicPercent: body.basicPercent,
      hraPercent: body.hraPercent,
      conveyancePercent: body.conveyancePercent,
      medicalPercent: body.medicalPercent,
      specialAllowancePercent: body.specialAllowancePercent,
    };
    const breakdown = computeStructureBreakdown(50000, structure, body.deductions || []);
    res.json({ success: true, data: breakdown });
  });

  /**
   * PATCH /salary/hold/:employeeId
   */
  holdSalary = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId);
    const { hold, reason } = req.body;

    const emp = await prisma.employee.findFirst({
      where: { employee_id: employeeId },
    });
    if (!emp) throw new ApiError(404, 'Employee not found');

    const updated = await prisma.employee.update({
      where: { id: emp.id },
      data: {
        salary_on_hold: Boolean(hold),
        salary_hold_reason: hold ? reason || 'Administrative hold' : null,
      },
    });

    await HrAuditService.log({
      entityType: 'salary',
      entityId: employeeId,
      eventType: hold ? 'SALARY_HELD' : 'SALARY_RELEASED',
      performedBy: (req as any).user?.name || 'Admin',
      notes: hold ? `Salary put on hold. Reason: ${reason}` : 'Salary hold released',
    });

    res.json({
      success: true,
      message: `Salary for ${updated.name} ${hold ? 'put on hold' : 'released'}`,
      data: {
        employeeId: updated.employee_id,
        isSalaryOnHold: Boolean(updated.salary_on_hold),
        holdReason: updated.salary_hold_reason,
      },
    });
  });

  /**
   * POST /salary/payslips/generate
   */
  generatePayslip = asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, month, year } = req.body;
    const daysInMonth = this.getDaysInMonth(year, month);
    const prefix = `${year}-${String(month).padStart(2, '0')}`;

    const where: any = { status: 'active' };
    if (employeeId) where.employee_id = employeeId;

    const employees = await prisma.employee.findMany({
      where,
      include: { loans: { where: { status: 'active' } } },
    });

    const attendances = await prisma.hrAttendance.findMany({
      where: { date: { startsWith: prefix } },
    });

    const policy = await this.resolvePayPolicy();
    const generated: any[] = [];

    await prisma.$transaction(async (tx) => {
      for (const emp of employees) {
        const empAtt = attendances.filter((a: any) => a.employee_id === emp.employee_id);
        const presentDays = empAtt.filter((a: any) => a.status === 'present').length;
        const leaveDays = empAtt.filter((a: any) => a.status === 'leave').length;
        const halfDays = empAtt.filter((a: any) => a.status === 'half-day').length;
        const totalOtHours = empAtt.reduce((sum: number, a: any) => sum + Number(a.overtime || 0), 0);

        const { id: structureId, structure, deductions } = await this.resolveStructure(emp.employee_id);
        const activeLoan = emp.loans && emp.loans[0] ? emp.loans[0] : null;

        const calc = computePayslip({
          monthlySalary: Number(emp.monthly_salary || 30000),
          pfEligible: Boolean(emp.pf_eligible),
          esicEligible: Boolean(emp.esic_eligible),
          daysInMonth,
          presentDays,
          leaveDays,
          halfDays,
          overtimeHours: totalOtHours,
          structure,
          deductions,
          policy,
          loanEmi: activeLoan ? Number(activeLoan.emi_amount) : 0,
          loanOutstanding: activeLoan ? Number(activeLoan.outstanding_balance) : 0,
        });

        const data = {
          total_working_days: daysInMonth,
          present_days: presentDays,
          leave_days: leaveDays,
          overtime_hours: totalOtHours,
          overtime_pay: calc.overtimePay,
          gross_salary: calc.grossEarnings,
          total_deductions: calc.totalDeductions,
          loan_deduction: calc.loanDeduction,
          net_salary: calc.netPay,
          structure_id: structureId !== null ? BigInt(structureId) : null,
          monthly_ctc: calc.monthlyCtc,
          calculation_days: calc.calculationDays,
          basic: calc.basic,
          hra: calc.hra,
          conveyance: calc.conveyance,
          medical_allowance: calc.medicalAllowance,
          special_allowance: calc.specialAllowance,
          employer_pf: calc.erPF,
          employer_esic: calc.erESIC,
          deduction_breakdown: calc.deductionBreakdown as any,
        };

        const payslip = await tx.hrPayslip.upsert({
          where: {
            employee_id_month_year: {
              employee_id: emp.employee_id,
              month,
              year,
            },
          },
          create: {
            employee_id: emp.employee_id,
            month,
            year,
            status: 'pending',
            ...data,
          },
          update: data,
        });

        generated.push(payslip);
      }

      await HrAuditService.log(
        {
          entityType: 'salary',
          entityId: `payroll_${year}_${month}`,
          eventType: 'PAYSLIPS_GENERATED',
          performedBy: (req as any).user?.name || 'Admin',
          notes: `Generated ${generated.length} payslips for ${prefix}`,
        },
        tx
      );
    });

    res.json({
      success: true,
      message: `Generated ${generated.length} payslip(s) for ${prefix}`,
      data: generated.map((p) => ({
        id: Number(p.id),
        employeeId: p.employee_id,
        month: p.month,
        year: p.year,
        netPay: Number(p.net_salary),
        status: p.status,
      })),
    });
  });

  private async mapPayslip(p: any) {
    const structureRow = p.structure_id
      ? await prisma.hrSalaryStructure.findUnique({ where: { id: BigInt(p.structure_id) } })
      : await prisma.hrSalaryStructure.findUnique({ where: { employee_id: p.employee_id } })
        || (await prisma.hrSalaryStructure.findUnique({ where: { employee_id: '__GLOBAL__' } }));

    // Payslip.salaryStructure is non-optional on the frontend (the PDF
    // renderer dereferences it directly) — always return a structure, even
    // if nothing was ever saved for this employee or globally.
    const salaryStructure = structureRow
      ? {
          id: Number(structureRow.id),
          basicPercent: Number(structureRow.basic_percent),
          hraPercent: Number(structureRow.hra_percent),
          conveyancePercent: Number(structureRow.conveyance_percent),
          medicalPercent: Number(structureRow.medical_percent),
          specialAllowancePercent: Number(structureRow.special_allowance_percent),
          deductions: Array.isArray(structureRow.deductions) ? structureRow.deductions : [],
          company: null,
          location: null,
          createdAt: structureRow.created_at?.toISOString(),
          updatedAt: structureRow.updated_at?.toISOString(),
        }
      : {
          id: 0,
          ...DEFAULT_STRUCTURE,
          deductions: [],
          company: null,
          location: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

    return {
      id: Number(p.id),
      employeeId: p.employee_id,
      structureId: p.structure_id ? Number(p.structure_id) : null,
      salaryStructure,
      month: p.month,
      year: p.year,
      daysPresent: Number(p.present_days),
      calculationDays: Number(p.calculation_days),
      monthlyCTC: Number(p.monthly_ctc),
      basic: Number(p.basic),
      hra: Number(p.hra),
      conveyance: Number(p.conveyance),
      medicalAllowance: Number(p.medical_allowance),
      specialAllowance: Number(p.special_allowance),
      otherAllowances: Number(p.other_allowances),
      additionalSalary: Number(p.additional_salary),
      grossEarnings: Number(p.gross_salary),
      deductionBreakdown: Array.isArray(p.deduction_breakdown) ? p.deduction_breakdown : [],
      totalDeductions: Number(p.total_deductions),
      netPay: Number(p.net_salary),
      overtimeHours: Number(p.overtime_hours),
      weekendWorkDays: 0,
      holidayWorkDays: 0,
      otPay: Number(p.overtime_pay),
      weekendPay: 0,
      holidayPay: 0,
      lateMinutes: 0,
      punchMisDays: 0,
      status: p.status,
      paidDate: p.paid_date?.toISOString().slice(0, 10) || null,
      remarks: null,
      createdAt: p.created_at?.toISOString(),
      updatedAt: p.updated_at?.toISOString(),
    };
  }

  /**
   * GET /salary/payslips/me
   */
  getMyPayslips = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = await this.resolveEmployeeId(req);
    if (!employeeId) throw new ApiError(400, 'No employee record linked to your account');

    const payslips = await prisma.hrPayslip.findMany({
      where: { employee_id: employeeId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    res.json({ success: true, data: await Promise.all(payslips.map((p: any) => this.mapPayslip(p))) });
  });

  /**
   * GET /salary/payslips/:employeeId
   */
  getEmployeePayslips = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId);
    const payslips = await prisma.hrPayslip.findMany({
      where: { employee_id: employeeId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    res.json({ success: true, data: await Promise.all(payslips.map((p: any) => this.mapPayslip(p))) });
  });

  /**
   * PATCH /salary/payslip/:id/mark-paid
   */
  markPaid = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const payslip = await prisma.hrPayslip.findUnique({ where: { id } });
    if (!payslip) throw new ApiError(404, 'Payslip not found');

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark payslip paid
      const updated = await tx.hrPayslip.update({
        where: { id },
        data: {
          status: 'paid',
          paid_date: new Date(),
        },
      });

      // 2. If loan deduction was applied, deduct from active loan
      const loanDed = Number(payslip.loan_deduction);
      if (loanDed > 0) {
        const activeLoan = await tx.hrEmployeeLoan.findFirst({
          where: { employee_id: payslip.employee_id, status: 'active' },
        });

        if (activeLoan) {
          const currentBal = Number(activeLoan.outstanding_balance);
          const newBal = Math.max(0, currentBal - loanDed);
          await tx.hrEmployeeLoan.update({
            where: { id: activeLoan.id },
            data: {
              outstanding_balance: newBal,
              status: newBal === 0 ? 'settled' : 'active',
            },
          });

          if (newBal === 0) {
            await tx.hrAdvanceRequest.updateMany({
              where: { loan_id: activeLoan.id },
              data: { status: 'completed' },
            });
          }
        }
      }

      await HrAuditService.log(
        {
          entityType: 'salary',
          entityId: id.toString(),
          eventType: 'PAYSLIP_MARKED_PAID',
          performedBy: (req as any).user?.name || 'Admin',
          notes: `Payslip #${id} marked as paid. Net amount: ₹${payslip.net_salary}`,
        },
        tx
      );

      return updated;
    });

    res.json({
      success: true,
      message: 'Payslip marked as paid successfully',
      data: {
        id: Number(result.id),
        status: result.status,
        paidDate: result.paid_date?.toISOString().slice(0, 10),
      },
    });
  });

  /**
   * DELETE /salary/payslip/:id
   */
  deletePayslip = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    await prisma.hrPayslip.delete({ where: { id } });
    res.json({ success: true, message: 'Payslip deleted successfully' });
  });

  /**
   * GET /salary/employees
   */
  getSalaryEmployees = asyncHandler(async (req: Request, res: Response) => {
    const { search, dept } = req.query as any;
    const where: any = { status: 'active' };

    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { emp_code: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    if (dept) {
      where.department = { name: { equals: String(dept), mode: 'insensitive' } };
    }

    const employees = await prisma.employee.findMany({
      where,
      include: { department: true, loans: { where: { status: 'active' } } },
      orderBy: { name: 'asc' },
    });

    const paidCounts = await prisma.hrPayslip.groupBy({
      by: ['employee_id'],
      where: { employee_id: { in: employees.map((e: any) => e.employee_id) }, status: 'paid' },
      _count: { _all: true },
    });
    const paidCountByEmployee = new Map(paidCounts.map((c: any) => [c.employee_id, c._count._all]));

    res.json({
      success: true,
      data: employees.map((e: any) => ({
        id: Number(e.id),
        employeeId: e.employee_id,
        empCode: e.emp_code || null,
        name: e.name,
        designation: e.designation || null,
        status: e.status,
        joiningDate: e.joining_date ? e.joining_date.toISOString().slice(0, 10) : null,
        lastWorkingDay: e.last_working_day ? e.last_working_day.toISOString().slice(0, 10) : null,
        department: e.department ? { id: String(e.department.id), name: e.department.name } : null,
        monthlySalary: Number(e.monthly_salary || 30000),
        hasActiveLoan: e.loans && e.loans.length > 0,
        activeLoanAmount: e.loans && e.loans[0] ? Number(e.loans[0].outstanding_balance) : 0,
        salaryOnHold: Boolean(e.salary_on_hold),
        holdReason: e.salary_hold_reason || null,
        paidPayslipCount: paidCountByEmployee.get(e.employee_id) || 0,
      })),
    });
  });

  /**
   * GET /salary/employee-loans/:employeeId
   */
  getEmployeeLoans = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId);
    const loans = await prisma.hrEmployeeLoan.findMany({
      where: { employee_id: employeeId },
      orderBy: { created_at: 'desc' },
    });

    res.json({
      success: true,
      data: loans.map((l: any) => ({
        id: l.id,
        amount: Number(l.amount),
        emiAmount: Number(l.emi_amount),
        outstandingBalance: Number(l.outstanding_balance),
        purpose: l.purpose,
        status: l.status,
        startDate: l.start_date.toISOString().slice(0, 10),
      })),
    });
  });

  /**
   * GET /salary/all-transactions
   */
  getAllTransactions = asyncHandler(async (req: Request, res: Response) => {
    const { month, year, search, status, page = 1, limit = 50 } = req.query as any;
    const where: any = {};

    if (month) where.month = Number(month);
    if (year) where.year = Number(year);
    if (status && status !== 'all') where.status = status;

    if (search) {
      where.employee = {
        OR: [
          { name: { contains: String(search), mode: 'insensitive' } },
          { emp_code: { contains: String(search), mode: 'insensitive' } },
        ],
      };
    }

    const total = await prisma.hrPayslip.count({ where });
    const payslips = await prisma.hrPayslip.findMany({
      where,
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { employee: { include: { department: true } } },
    });

    res.json({
      success: true,
      data: {
        total,
        page: Number(page),
        limit: Number(limit),
        items: payslips.map((p: any) => ({
          id: Number(p.id),
          employeeId: p.employee_id,
          employeeName: p.employee?.name || null,
          empCode: p.employee?.emp_code || null,
          department: p.employee?.department?.name || null,
          month: p.month,
          year: p.year,
          grossSalary: Number(p.gross_salary),
          netSalary: Number(p.net_salary),
          deductions: Number(p.total_deductions),
          status: p.status,
          paidDate: p.paid_date?.toISOString().slice(0, 10) || null,
        })),
      },
    });
  });

  /**
   * GET /salary/policy
   */
  getPayPolicy = asyncHandler(async (_req: Request, res: Response) => {
    const policy = await this.resolvePayPolicy();
    res.json({ success: true, data: this.mapPayPolicyResponse(policy.row) });
  });

  /**
   * POST /salary/policy
   */
  savePayPolicy = asyncHandler(async (req: Request, res: Response) => {
    const b = req.body;
    const data = {
      ot_enabled: b.otEnabled,
      ot_mode: b.otMode,
      standard_shift_hours: b.standardShiftHours,
      overtime_rate_multiplier: b.overtimeRateMultiplier,
      weekend_ot_multiplier: b.weekendOtMultiplier,
      holiday_ot_multiplier: b.holidayOtMultiplier,
      weekend_work_multiplier: b.weekendWorkMultiplier,
      holiday_work_multiplier: b.holidayWorkMultiplier,
      late_grace_minutes: b.lateGraceMinutes,
      late_deduct_type: b.lateDeductType,
      half_day_after_late_minutes: b.halfDayAfterLateMinutes,
      punch_mis_treatment: b.punchMisTreatment,
      pf_enabled: b.pfEnabled,
      pf_employee_rate: b.pfEmployeeRate,
      pf_employer_rate: b.pfEmployerRate,
      esi_enabled: b.esiEnabled,
      esi_employee_rate: b.esiEmployeeRate,
      esi_employer_rate: b.esiEmployerRate,
      esi_gross_limit: b.esiGrossLimit,
      professional_tax_enabled: b.professionalTaxEnabled,
    };

    const existing = await prisma.hrPayPolicy.findFirst();
    const saved = existing
      ? await prisma.hrPayPolicy.update({ where: { id: existing.id }, data })
      : await prisma.hrPayPolicy.create({ data });

    await HrAuditService.log({
      entityType: 'salary',
      entityId: 'pay_policy',
      eventType: 'PAY_POLICY_UPDATED',
      performedBy: (req as any).user?.name || 'Admin',
      notes: 'Pay policy updated',
    });

    res.json({ success: true, message: 'Pay policy updated', data: this.mapPayPolicyResponse(saved) });
  });
}

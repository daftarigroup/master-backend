import { Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { FirmScopedRequest, assertFirmAllowed } from '../../checklist/middleware/scopeToFirmAccess.middleware';

export class EmployeeController {
  /**
   * Helper to format Employee into frontend-friendly shape
   */
  private formatEmployee(e: any) {
    return {
      ...e,
      id: e.id.toString(),
      employeeId: e.employee_id,
      empCode: e.emp_code,
      departmentId: e.department_id?.toString() || null,
      departmentName: e.department?.name || null,
      homeFirmId: e.home_firm_id ? Number(e.home_firm_id) : null,
      homeFirmName: e.home_firm?.firm_name || null,
      userId: e.user_id?.toString() || null,
      joiningDate: e.joining_date?.toISOString() || null,
      lastWorkingDay: e.last_working_day?.toISOString() || null,
      terminationDate: e.termination_date?.toISOString() || null,
      monthlySalary: e.monthly_salary != null ? Number(e.monthly_salary) : null,
      createdAt: e.created_at?.toISOString(),
      updatedAt: e.updated_at?.toISOString(),
      activeAssignment: e.project_assignments && e.project_assignments.length > 0
        ? {
            id: e.project_assignments[0].id.toString(),
            firmId: Number(e.project_assignments[0].firm_id),
            firmName: e.project_assignments[0].firm_name,
            roleOnProject: e.project_assignments[0].role_on_project,
            status: e.project_assignments[0].status,
            assignedDate: e.project_assignments[0].assigned_date?.toISOString(),
          }
        : null,
    };
  }

  /**
   * GET /api/hr/employees/stats
   */
  stats = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const total = await prisma.employee.count();
    const active = await prisma.employee.count({ where: { status: 'active' } });
    const onNotice = await prisma.employee.count({ where: { status: 'on_notice' } });
    const left = await prisma.employee.count({ where: { status: 'left' } });
    const deployed = await prisma.projectAssignment.count({ where: { status: 'active' } });

    res.json({
      success: true,
      data: {
        totalEmployees: total,
        activeEmployees: active,
        onNoticeEmployees: onNotice,
        separatedEmployees: left,
        deployedEmployees: deployed,
        presentToday: active,
        onLeaveToday: 0,
        openIndents: 0,
        activeCandidates: 0,
        pendingLeaves: 0,
        pendingAdvances: 0,
        todayGatePasses: 0,
        upcomingBirthdays: [],
        workAnniversaries: [],
      },
    });
  });

  /**
   * GET /api/hr/employees/leaving
   */
  leaving = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const leavingEmployees = await prisma.employee.findMany({
      where: {
        status: { in: ['on_notice', 'left', 'terminated', 'resigned'] },
      },
      orderBy: { updated_at: 'desc' },
      include: {
        department: true,
        home_firm: true,
      },
    });

    res.json({
      success: true,
      data: leavingEmployees.map((e) => this.formatEmployee(e)),
    });
  });

  /**
   * GET /api/hr/employees
   * List all employees with active deployment status
   */
  list = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const where: any = {};

    if (req.query.status && req.query.status !== 'all') {
      where.status = String(req.query.status);
    }

    if (req.query.department_id) {
      where.department_id = BigInt(String(req.query.department_id));
    }

    if (req.query.home_firm_id) {
      where.home_firm_id = BigInt(String(req.query.home_firm_id));
    }

    if (req.query.search) {
      const q = String(req.query.search).trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { emp_code: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { designation: { contains: q, mode: 'insensitive' } },
      ];
    }

    const employees = await prisma.employee.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        department: true,
        home_firm: true,
        project_assignments: {
          where: { status: { in: ['active', 'on_leave'] } },
          take: 1,
        },
      },
    });

    res.json({
      success: true,
      data: employees.map((e) => this.formatEmployee(e)),
    });
  });

  /**
   * GET /api/hr/employees/:id
   */
  getById = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const param = String(req.params.id);

    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { employee_id: param },
          { emp_code: param },
          /^\d+$/.test(param) ? { id: BigInt(param) } : {},
        ],
      },
      include: {
        department: true,
        home_firm: true,
        user: {
          select: { id: true, user_name: true, role: true },
        },
        project_assignments: {
          orderBy: { created_at: 'desc' },
          include: { firm: true, events: true },
        },
      },
    });

    if (!employee) {
      throw new ApiError(404, 'Employee not found');
    }

    res.json({
      success: true,
      data: this.formatEmployee(employee),
    });
  });

  /**
   * POST /api/hr/employees
   * Create a new employee record
   */
  create = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const body = req.body;
    const name = String(body.name || '').trim();
    if (!name) {
      throw new ApiError(400, 'Employee name is required');
    }

    const empCode = body.empCode || body.emp_code || `EMP${Date.now().toString().slice(-4)}`;
    const phone = body.phone || null;
    const email = body.email || null;
    const designation = body.designation || null;
    const departmentId = body.departmentId || body.department_id ? BigInt(body.departmentId || body.department_id) : null;
    const homeFirmId = body.homeFirmId || body.home_firm_id || body.firm_id ? BigInt(body.homeFirmId || body.home_firm_id || body.firm_id) : null;
    const joiningDate = body.joiningDate || body.joining_date ? new Date(body.joiningDate || body.joining_date) : new Date();

    const employee = await prisma.employee.create({
      data: {
        name,
        emp_code: empCode,
        phone,
        email,
        designation,
        department_id: departmentId,
        home_firm_id: homeFirmId,
        joining_date: joiningDate,
        status: body.status || 'active',
        work_location: body.workLocation || body.work_location || null,
        manager_name: body.managerName || body.manager_name || null,
        blood_group: body.bloodGroup || body.blood_group || null,
        bank_account: body.bankAccount || body.bank_account || null,
        ifsc_code: body.ifscCode || body.ifsc_code || null,
        bank_branch_name: body.bankBranchName || body.bank_branch_name || null,
        payment_mode: body.paymentMode || body.payment_mode || null,
        monthly_salary: body.monthlySalary || body.monthly_salary ? Number(body.monthlySalary || body.monthly_salary) : null,
        offered_ctc: body.offeredCTC || body.offered_ctc || null,
        aadhar_no: body.aadharNo || body.aadhar_no || null,
        aadhar_address: body.aadharAddress || body.aadhar_address || null,
        current_address: body.currentAddress || body.current_address || null,
        father_name: body.fatherName || body.father_name || null,
        highest_qualification: body.highestQualification || body.highest_qualification || null,
        emergency_contact_name: body.emergencyContactName || body.emergency_contact_name || null,
        emergency_contact_phone: body.emergencyContactPhone || body.emergency_contact_phone || null,
        emergency_contact_relation: body.emergencyContactRelation || body.emergency_contact_relation || null,
        pf_eligible: body.pfEligible ?? body.pf_eligible ?? false,
        esic_eligible: body.esicEligible ?? body.esic_eligible ?? false,
        email_to_be_issued: body.emailToBeIssued ?? body.email_to_be_issued ?? false,
        mobile_to_be_issued: body.mobileToBeIssued ?? body.mobile_to_be_issued ?? false,
        laptop_to_be_issued: body.laptopToBeIssued ?? body.laptop_to_be_issued ?? false,
      },
      include: {
        department: true,
        home_firm: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      data: this.formatEmployee(employee),
    });
  });

  /**
   * PATCH /api/hr/employees/:id
   */
  update = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const param = String(req.params.id);
    const body = req.body;

    const existing = await prisma.employee.findFirst({
      where: {
        OR: [
          { employee_id: param },
          { emp_code: param },
          /^\d+$/.test(param) ? { id: BigInt(param) } : {},
        ],
      },
    });

    if (!existing) {
      throw new ApiError(404, 'Employee not found');
    }

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.designation !== undefined) updateData.designation = body.designation;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.workLocation || body.work_location) updateData.work_location = body.workLocation || body.work_location;
    if (body.departmentId || body.department_id) updateData.department_id = BigInt(body.departmentId || body.department_id);
    if (body.homeFirmId || body.home_firm_id) updateData.home_firm_id = BigInt(body.homeFirmId || body.home_firm_id);
    if (body.lastWorkingDay || body.last_working_day) updateData.last_working_day = new Date(body.lastWorkingDay || body.last_working_day);
    if (body.leavingReason || body.leaving_reason) updateData.leaving_reason = body.leavingReason || body.leaving_reason;
    if (body.separationType || body.separation_type) updateData.separation_type = body.separationType || body.separation_type;

    const updated = await prisma.employee.update({
      where: { id: existing.id },
      data: updateData,
      include: {
        department: true,
        home_firm: true,
      },
    });

    res.json({
      success: true,
      message: 'Employee updated successfully',
      data: this.formatEmployee(updated),
    });
  });


  /**
   * PATCH /api/hr/employees/:id/leaving
   */
  recordSeparation = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const param = String(req.params.id);
    const body = req.body;

    const existing = await prisma.employee.findFirst({
      where: {
        OR: [
          { employee_id: param },
          { emp_code: param },
          /^\d+$/.test(param) ? { id: BigInt(param) } : {},
        ],
      },
    });

    if (!existing) {
      throw new ApiError(404, 'Employee not found');
    }

    const updated = await prisma.employee.update({
      where: { id: existing.id },
      data: {
        status: body.status || 'on_notice',
        separation_type: body.separationType || body.separation_type || 'Resignation',
        leaving_reason: body.leavingReason || body.leaving_reason || body.reason || null,
        last_working_day: body.lastWorkingDay || body.last_working_day ? new Date(body.lastWorkingDay || body.last_working_day) : null,
      },
      include: {
        department: true,
        home_firm: true,
      },
    });

    res.json({
      success: true,
      message: 'Separation recorded successfully',
      data: this.formatEmployee(updated),
    });
  });

  /**
   * DELETE /api/hr/employees/:id
   */
  delete = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const param = String(req.params.id);

    const existing = await prisma.employee.findFirst({
      where: {
        OR: [
          { employee_id: param },
          { emp_code: param },
          /^\d+$/.test(param) ? { id: BigInt(param) } : {},
        ],
      },
    });

    if (!existing) {
      throw new ApiError(404, 'Employee not found');
    }

    await prisma.employee.update({
      where: { id: existing.id },
      data: { status: 'left' },
    });

    res.json({
      success: true,
      message: 'Employee archived successfully',
    });
  });
}


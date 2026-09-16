import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { HrAuditService } from '../services/hrAudit.service';
import { BulkImportResultDto, AccountLinkFieldDiff } from '../types/joining.types';

export class JoiningController {
  /**
   * GET /joining
   */
  list = asyncHandler(async (_req: Request, res: Response) => {
    const joinings = await prisma.hrJoining.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        candidate: true,
        employee: true,
      },
    });

    res.json({
      success: true,
      data: joinings.map((j: any) => ({
        id: Number(j.id),
        candidateId: j.candidate_id ? Number(j.candidate_id) : null,
        employeeId: j.employee_id || null,
        joiningDate: j.joining_date?.toISOString().slice(0, 10),
        status: j.status,
        designationOffered: j.designation_offered,
        offeredCTC: j.offered_ctc,
        monthlySalary: j.monthly_salary ? Number(j.monthly_salary) : null,
        reportingManager: j.reporting_manager,
        workLocation: j.work_location,
        candidate: j.candidate
          ? {
              id: Number(j.candidate.id),
              candidateName: j.candidate.candidate_name,
              phoneNo: j.candidate.phone_no,
              email: j.candidate.email,
            }
          : null,
      })),
    });
  });

  /**
   * POST /joining/initiate
   */
  initiate = asyncHandler(async (req: Request, res: Response) => {
    const { candidateId, joiningDate, status } = req.body;
    const cid = BigInt(candidateId);

    const candidate = await prisma.hrCandidate.findUnique({ where: { id: cid } });
    if (!candidate) throw new ApiError(404, 'Candidate not found');

    const result = await prisma.$transaction(async (tx) => {
      await tx.hrCandidate.update({
        where: { id: cid },
        data: { status: 'joining_initiated' },
      });

      let joining = await tx.hrJoining.findUnique({ where: { candidate_id: cid } });
      if (joining) {
        joining = await tx.hrJoining.update({
          where: { id: joining.id },
          data: {
            joining_date: new Date(joiningDate),
            status: status || 'pending',
          },
        });
      } else {
        joining = await tx.hrJoining.create({
          data: {
            candidate_id: cid,
            joining_date: new Date(joiningDate),
            status: status || 'pending',
          },
        });
      }

      await HrAuditService.log(
        {
          entityType: 'joining',
          entityId: joining.id.toString(),
          eventType: 'JOINING_INITIATED',
          performedBy: (req as any).user?.name || 'Admin',
          notes: `Joining initiated for candidate #${candidateId}`,
        },
        tx
      );

      return joining;
    });

    res.status(201).json({
      success: true,
      message: 'Joining initiated successfully',
      data: {
        id: Number(result.id),
        candidateId: Number(result.candidate_id),
        joiningDate: result.joining_date.toISOString().slice(0, 10),
        status: result.status,
      },
    });
  });

  /**
   * PUT /joining/:id
   */
  update = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { status, documents } = req.body;

    const data: any = {};
    if (status !== undefined) data.status = status;
    if (documents !== undefined) data.documents = documents;

    const updated = await prisma.hrJoining.update({
      where: { id },
      data,
    });

    res.json({
      success: true,
      data: {
        id: Number(updated.id),
        candidateId: updated.candidate_id ? Number(updated.candidate_id) : null,
        status: updated.status,
        documents: updated.documents,
      },
    });
  });

  /**
   * GET /employee/onboarding
   */
  getOnboardingList = asyncHandler(async (_req: Request, res: Response) => {
    const employees = await prisma.employee.findMany({
      where: { status: 'active' },
      orderBy: { created_at: 'desc' },
      include: {
        department: { select: { id: true, name: true } },
      },
    });

    const data = employees.map((e: any) => ({
      id: Number(e.id),
      employeeId: e.employee_id,
      empCode: e.emp_code || null,
      name: e.name,
      email: e.email || null,
      phone: e.phone || null,
      designation: e.designation || null,
      departmentId: e.department_id ? e.department_id.toString() : null,
      department: e.department ? { id: e.department.id.toString(), name: e.department.name } : null,
      status: e.status,
      joiningDate: e.joining_date ? e.joining_date.toISOString().slice(0, 10) : null,
      offerLetterIssued: Boolean(e.offer_letter_issued),
      idCardIssued: Boolean(e.id_card_issued),
      inductionDone: Boolean(e.induction_done),
      onboardingChecklist: e.onboarding_checklist && typeof e.onboarding_checklist === 'object' ? e.onboarding_checklist : {},
      customChecklistItems: Array.isArray(e.custom_checklist_items) ? e.custom_checklist_items : [],
    }));

    res.json({
      success: true,
      data,
    });
  });

  /**
   * PATCH /employee/:id/onboarding
   */
  updateOnboarding = asyncHandler(async (req: Request, res: Response) => {
    const idParam = String(req.params.id);
    const body = req.body;

    const where: any = /^\d+$/.test(idParam)
      ? { OR: [{ id: BigInt(idParam) }, { employee_id: idParam }] }
      : { employee_id: idParam };

    const employee = await prisma.employee.findFirst({
      where,
      include: { department: true },
    });

    if (!employee) throw new ApiError(404, 'Employee not found');

    const updateData: any = {};
    if (body.offerLetterIssued !== undefined) updateData.offer_letter_issued = body.offerLetterIssued;
    if (body.idCardIssued !== undefined) updateData.id_card_issued = body.idCardIssued;
    if (body.inductionDone !== undefined) updateData.induction_done = body.inductionDone;
    if (body.onboardingChecklist !== undefined) updateData.onboarding_checklist = body.onboardingChecklist;
    if (body.customChecklistItems !== undefined) updateData.custom_checklist_items = body.customChecklistItems;

    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data: updateData,
      include: { department: true },
    });

    await HrAuditService.log({
      entityType: 'employee',
      entityId: updated.employee_id,
      eventType: 'ONBOARDING_CHECKLIST_UPDATED',
      performedBy: (req as any).user?.name || 'Admin',
      notes: `Updated onboarding checklist for ${updated.name}`,
    });

    res.json({
      success: true,
      message: 'Onboarding checklist updated successfully',
      data: {
        id: Number(updated.id),
        employeeId: updated.employee_id,
        empCode: updated.emp_code,
        name: updated.name,
        offerLetterIssued: Boolean(updated.offer_letter_issued),
        idCardIssued: Boolean(updated.id_card_issued),
        inductionDone: Boolean(updated.induction_done),
        onboardingChecklist: updated.onboarding_checklist || {},
        customChecklistItems: updated.custom_checklist_items || [],
      },
    });
  });

  /**
   * GET /employee/checklist-config
   */
  getChecklistConfig = asyncHandler(async (_req: Request, res: Response) => {
    const configRow = await prisma.hrConfig.findUnique({
      where: { key: 'hr_checklist_config' },
    });

    const defaultConfig = { disabledStandardKeys: [] as string[], globalCustomItems: [] as any[] };
    const config = configRow?.value ? (configRow.value as any) : defaultConfig;

    res.json({
      success: true,
      data: config,
    });
  });

  /**
   * PATCH /employee/checklist-config
   */
  saveChecklistConfig = asyncHandler(async (req: Request, res: Response) => {
    const { disabledStandardKeys, globalCustomItems } = req.body;
    const value = {
      disabledStandardKeys: disabledStandardKeys || [],
      globalCustomItems: globalCustomItems || [],
    };

    await prisma.hrConfig.upsert({
      where: { key: 'hr_checklist_config' },
      create: { key: 'hr_checklist_config', value },
      update: { value },
    });

    res.json({
      success: true,
      data: value,
    });
  });

  /**
   * POST /employee/bulk-import
   */
  bulkImport = asyncHandler(async (req: Request, res: Response) => {
    const { rows } = req.body;
    const actorName = (req as any).user?.name || 'Admin';

    const result: BulkImportResultDto = {
      created: [],
      errors: [],
      pendingLinkConfirmations: [],
    };

    for (const r of rows) {
      const cleanPhone = r.phone?.trim();
      const cleanEmail = r.email?.trim() || null;

      // 1. Check if an Employee already exists with this phone
      const existingEmp = await prisma.employee.findFirst({
        where: { phone: cleanPhone },
      });

      if (existingEmp) {
        result.errors.push({
          row: r.row,
          error: `Phone number ${cleanPhone} already registered for employee ${existingEmp.name} (${existingEmp.emp_code || existingEmp.employee_id})`,
        });
        continue;
      }

      // 2. Check if a User account matches this phone or email
      let matchedUser: any = null;
      if (cleanPhone || cleanEmail) {
        const userOr: any[] = [];
        if (cleanEmail) userOr.push({ user_name: { equals: cleanEmail, mode: 'insensitive' } });
        if (cleanPhone) userOr.push({ user_name: { equals: cleanPhone, mode: 'insensitive' } });
        if (userOr.length > 0) {
          matchedUser = await prisma.user.findFirst({
            where: { OR: userOr },
            include: { employee: true },
          });
        }
      }

      // If matched User is already linked to another employee
      if (matchedUser && matchedUser.employee) {
        result.errors.push({
          row: r.row,
          error: `User account (${matchedUser.user_name}) is already linked to employee ${matchedUser.employee.name}`,
        });
        continue;
      }

      // If matched User found and confirmation not yet given
      if (matchedUser && !r.confirmAccountLinkOverwrite) {
        const diffs: AccountLinkFieldDiff[] = [];
        if (matchedUser.name && matchedUser.name !== r.name) {
          diffs.push({ field: 'name', currentValue: matchedUser.name, importValue: r.name });
        }
        if (matchedUser.user_name && cleanPhone && matchedUser.user_name !== cleanPhone) {
          diffs.push({ field: 'phone', currentValue: matchedUser.user_name, importValue: cleanPhone });
        }

        result.pendingLinkConfirmations.push({
          row: r.row,
          name: r.name,
          phone: cleanPhone,
          user: {
            id: matchedUser.id.toString(),
            name: matchedUser.name || null,
            email: matchedUser.user_name || null,
          },
          diffs,
        });
        continue;
      }

      // 3. Resolve department if provided
      let deptId: bigint | null = null;
      if (r.department) {
        const dept = await prisma.department.findFirst({
          where: { name: { equals: r.department.trim(), mode: 'insensitive' } },
        });
        if (dept) deptId = dept.id;
      }

      // 4. Generate empCode
      const empCode = r.empCode || `EMP${String((await prisma.employee.count()) + 1).padStart(3, '0')}`;

      try {
        const newEmp = await prisma.employee.create({
          data: {
            emp_code: empCode,
            name: r.name.trim(),
            phone: cleanPhone,
            email: cleanEmail,
            designation: r.designation || null,
            department_id: deptId,
            joining_date: r.joiningDate ? new Date(r.joiningDate) : new Date(),
            work_location: r.workLocation || null,
            manager_name: r.managerName || null,
            blood_group: r.bloodGroup || null,
            bank_account: r.bankAccount || null,
            ifsc_code: r.ifscCode || null,
            monthly_salary: r.monthlySalary ? Number(r.monthlySalary) : null,
            user_id: matchedUser ? matchedUser.id : null,
            status: 'active',
          },
        });

        result.created.push({
          row: r.row,
          employeeId: newEmp.employee_id,
          empCode: newEmp.emp_code,
          name: newEmp.name,
        });
      } catch (err: any) {
        result.errors.push({
          row: r.row,
          error: err.message || 'Failed to create employee row',
        });
      }
    }

    await HrAuditService.log({
      entityType: 'employee',
      entityId: 'bulk-import',
      eventType: 'BULK_IMPORT_PROCESSED',
      performedBy: (req as any).user?.name || 'Admin',
      notes: `Processed ${rows.length} rows: ${result.created.length} created, ${result.errors.length} errors, ${result.pendingLinkConfirmations.length} pending`,
    });

    res.json({
      success: true,
      data: result,
    });
  });

  /**
   * GET /employee/joined-without-account
   */
  getJoinedWithoutAccount = asyncHandler(async (_req: Request, res: Response) => {
    const employees = await prisma.employee.findMany({
      where: { user_id: null, status: 'active' },
      orderBy: { created_at: 'desc' },
      include: {
        department: { select: { id: true, name: true } },
      },
    });

    res.json({
      success: true,
      data: employees.map((e: any) => ({
        id: Number(e.id),
        employeeId: e.employee_id,
        empCode: e.emp_code || null,
        name: e.name,
        email: e.email || null,
        phone: e.phone || null,
        designation: e.designation || null,
        departmentId: e.department_id ? e.department_id.toString() : null,
        department: e.department ? { id: e.department.id.toString(), name: e.department.name } : null,
      })),
    });
  });
}

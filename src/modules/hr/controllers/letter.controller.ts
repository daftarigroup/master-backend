import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { HrAuditService } from '../services/hrAudit.service';

export class LetterController {
  private formatTemplate(t: any) {
    return {
      id: Number(t.id),
      name: t.name,
      letterType: t.letter_type,
      content: t.content,
      isDefault: t.is_default,
      isActive: t.is_active,
      fields: Array.isArray(t.fields) ? t.fields : [],
      createdAt: t.created_at?.toISOString(),
      updatedAt: t.updated_at?.toISOString(),
    };
  }

  /**
   * GET /letter-template
   */
  list = asyncHandler(async (_req: Request, res: Response) => {
    const templates = await prisma.hrLetterTemplate.findMany({
      orderBy: { created_at: 'desc' },
    });

    res.json({
      success: true,
      data: templates.map((t: any) => this.formatTemplate(t)),
    });
  });

  /**
   * GET /letter-template/:id
   */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const template = await prisma.hrLetterTemplate.findUnique({
      where: { id },
    });

    if (!template) throw new ApiError(404, 'Letter template not found');

    res.json({
      success: true,
      data: this.formatTemplate(template),
    });
  });

  /**
   * POST /letter-template
   */
  create = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;

    const template = await prisma.hrLetterTemplate.create({
      data: {
        name: body.name,
        letter_type: body.letterType,
        content: body.content,
        is_default: Boolean(body.isDefault),
        is_active: body.isActive !== undefined ? Boolean(body.isActive) : true,
        fields: body.fields || [],
      },
    });

    await HrAuditService.log({
      entityType: 'employee',
      entityId: template.id.toString(),
      eventType: 'LETTER_TEMPLATE_CREATED',
      performedBy: (req as any).user?.name || 'Admin',
      notes: `Created letter template "${template.name}" (${template.letter_type})`,
    });

    res.status(201).json({
      success: true,
      message: 'Letter template created successfully',
      data: this.formatTemplate(template),
    });
  });

  /**
   * PATCH /letter-template/:id
   */
  update = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body;

    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.letterType !== undefined) data.letter_type = body.letterType;
    if (body.content !== undefined) data.content = body.content;
    if (body.isDefault !== undefined) data.is_default = body.isDefault;
    if (body.isActive !== undefined) data.is_active = body.isActive;
    if (body.fields !== undefined) data.fields = body.fields;

    const updated = await prisma.hrLetterTemplate.update({
      where: { id },
      data,
    });

    res.json({
      success: true,
      message: 'Letter template updated successfully',
      data: this.formatTemplate(updated),
    });
  });

  /**
   * DELETE /letter-template/:id
   */
  delete = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    await prisma.hrLetterTemplate.delete({ where: { id } });
    res.json({ success: true, message: 'Letter template deleted successfully' });
  });

  /**
   * GET /letter-template/:id/field-values
   */
  getFieldValues = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const employeeId = (req.query.employeeId as string) || '';

    const values = await prisma.hrLetterFieldValue.findMany({
      where: {
        template_id: id,
        employee_id: { in: ['', employeeId] },
      },
    });

    res.json({
      success: true,
      data: values.map((v: any) => ({
        id: Number(v.id),
        templateId: Number(v.template_id),
        fieldKey: v.field_key,
        value: v.value,
        employeeId: v.employee_id,
      })),
    });
  });

  /**
   * POST /letter-template/:id/field-values
   */
  saveFieldValues = asyncHandler(async (req: Request, res: Response) => {
    const templateId = BigInt(String(req.params.id));
    const employeeId = req.body.employeeId || '';
    const fieldValues = req.body.fieldValues;

    const entries: { fieldKey: string; value: string }[] = Array.isArray(fieldValues)
      ? fieldValues
      : Object.entries(fieldValues || {}).map(([fieldKey, value]) => ({ fieldKey, value: String(value) }));

    const saved: any[] = [];
    await prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        const item = await tx.hrLetterFieldValue.upsert({
          where: {
            template_id_field_key_employee_id: {
              template_id: templateId,
              field_key: entry.fieldKey,
              employee_id: employeeId,
            },
          },
          create: {
            template_id: templateId,
            field_key: entry.fieldKey,
            value: entry.value,
            employee_id: employeeId,
          },
          update: {
            value: entry.value,
          },
        });
        saved.push(item);
      }
    });

    res.json({
      success: true,
      message: 'Field values saved successfully',
      data: saved.map((s: any) => ({
        id: Number(s.id),
        templateId: Number(s.template_id),
        fieldKey: s.field_key,
        value: s.value,
        employeeId: s.employee_id,
      })),
    });
  });

  /**
   * GET /letter-template/:id/render?employeeId=...
   */
  render = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const employeeId = req.query.employeeId ? String(req.query.employeeId) : '';

    const template = await prisma.hrLetterTemplate.findUnique({ where: { id } });
    if (!template) throw new ApiError(404, 'Letter template not found');

    let employee: any = null;
    if (employeeId) {
      const empWhere: any = /^\d+$/.test(employeeId)
        ? { OR: [{ id: BigInt(employeeId) }, { employee_id: employeeId }, { emp_code: employeeId }] }
        : { OR: [{ employee_id: employeeId }, { emp_code: employeeId }] };
      employee = await prisma.employee.findFirst({
        where: empWhere,
        include: { department: true },
      });
    }

    const fieldValues = await prisma.hrLetterFieldValue.findMany({
      where: {
        template_id: id,
        employee_id: { in: ['', employeeId || ''] },
      },
    });

    const fieldsDef: any[] = Array.isArray(template.fields) ? (template.fields as any[]) : [];

    const formatDate = (d: Date | string | null | undefined) => {
      if (!d) return '';
      const parsed = new Date(d);
      if (isNaN(parsed.getTime())) return String(d);
      return parsed.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    };

    const formatCurrency = (amount: any) => {
      if (amount === null || amount === undefined || amount === '') return '';
      const num = Number(amount);
      if (isNaN(num)) return String(amount);
      return num.toLocaleString('en-IN');
    };

    const botivateOrCompanyField = fieldsDef.find(
      (f) =>
        f.key === 'botivate' ||
        f.autoMap === 'companyName' ||
        f.label?.toLowerCase().includes('botivate')
    );
    const defaultCompanyName = botivateOrCompanyField?.label || 'Botivate Services LLP';

    const todayFormatted = formatDate(new Date());
    const empName = employee?.name || 'Candidate / Employee';
    const empDesignation = employee?.designation || 'Staff';
    const empDept = employee?.department?.name || 'Operations';
    const empJoiningDate = employee?.joining_date ? formatDate(employee.joining_date) : todayFormatted;
    const empSalaryRaw = employee?.monthly_salary || '';
    const empSalaryFormatted = formatCurrency(empSalaryRaw) || 'As discussed';
    const empCtcRaw = employee?.offered_ctc || '';
    const empCtcFormatted = formatCurrency(empCtcRaw) || empSalaryFormatted;
    const empLocation = employee?.work_location || employee?.joining_place || 'Head Office';
    const empManager = employee?.manager_name || 'Management';
    const empCode = employee?.emp_code || employee?.employee_id || 'EMP000';

    const baseTokens: Record<string, string> = {
      // Date
      todayDate: todayFormatted,
      today_date: todayFormatted,
      offerDate: todayFormatted,
      offer_date: todayFormatted,
      date: todayFormatted,
      current_date: todayFormatted,
      currentDate: todayFormatted,

      // Company
      companyName: defaultCompanyName,
      company_name: defaultCompanyName,
      company: defaultCompanyName,
      botivate: defaultCompanyName,
      organization: defaultCompanyName,
      firm: defaultCompanyName,

      // Employee Name
      name: empName,
      employeeName: empName,
      employee_name: empName,
      candidateName: empName,
      candidate_name: empName,
      emp_name: empName,
      empName: empName,

      // Code / ID
      empCode: empCode,
      emp_code: empCode,
      employeeId: empCode,
      employee_id: empCode,

      // Designation / Position
      designation: empDesignation,
      position: empDesignation,
      role: empDesignation,
      designationOffered: empDesignation,
      designation_offered: empDesignation,

      // Department
      department: empDept,
      dept: empDept,
      departmentName: empDept,
      department_name: empDept,

      // Joining Date
      joiningDate: empJoiningDate,
      joining_date: empJoiningDate,
      doj: empJoiningDate,
      date_of_joining: empJoiningDate,
      dateOfJoining: empJoiningDate,
      start_date: empJoiningDate,
      startDate: empJoiningDate,

      // Salary / CTC
      salary: empSalaryFormatted,
      monthlySalary: empSalaryFormatted,
      monthly_salary: empSalaryFormatted,
      grossSalary: empSalaryFormatted,
      gross_salary: empSalaryFormatted,
      salaryWithCurrency: `₹${empSalaryFormatted}`,
      salary_with_currency: `₹${empSalaryFormatted}`,
      offeredCTC: empCtcFormatted,
      offered_ctc: empCtcFormatted,
      ctc: empCtcFormatted,
      annualCTC: empCtcFormatted,
      annual_ctc: empCtcFormatted,

      // Location
      workLocation: empLocation,
      work_location: empLocation,
      location: empLocation,
      joiningPlace: empLocation,
      joining_place: empLocation,

      // Manager / Reporting To
      managerName: empManager,
      manager_name: empManager,
      reportingTo: empManager,
      reporting_to: empManager,
      reportingManager: empManager,
      reporting_manager: empManager,
      manager: empManager,

      // Contact & Employment details
      phone: employee?.phone || '',
      mobile: employee?.phone || '',
      email: employee?.email || '',
      probationMonths: employee?.probation_months ? `${employee.probation_months} months` : '3 months',
      probation_months: employee?.probation_months ? `${employee.probation_months} months` : '3 months',
      employmentType: employee?.employment_type || 'Full-time',
      employment_type: employee?.employment_type || 'Full-time',
      currentAddress: employee?.current_address || '',
      current_address: employee?.current_address || '',
      address: employee?.current_address || '',
      lastWorkingDay: employee?.last_working_day ? formatDate(employee.last_working_day) : 'N/A',
      last_working_day: employee?.last_working_day ? formatDate(employee.last_working_day) : 'N/A',
    };

    // Process fields defined on the template
    for (const field of fieldsDef) {
      if (!field.key) continue;
      if (field.autoMap) {
        switch (field.autoMap) {
          case 'name':
            baseTokens[field.key] = empName;
            break;
          case 'designation':
          case 'designationOffered':
            baseTokens[field.key] = empDesignation;
            break;
          case 'employeeId':
            baseTokens[field.key] = empCode;
            break;
          case 'joiningDate':
            baseTokens[field.key] = empJoiningDate;
            break;
          case 'department':
            baseTokens[field.key] = empDept;
            break;
          case 'phone':
            baseTokens[field.key] = employee?.phone || '';
            break;
          case 'email':
            baseTokens[field.key] = employee?.email || '';
            break;
          case 'offeredCTC':
            baseTokens[field.key] = empCtcFormatted;
            break;
          case 'monthlySalary':
            baseTokens[field.key] = empSalaryFormatted;
            break;
          case 'companyName':
            baseTokens[field.key] = field.label || defaultCompanyName;
            break;
          case 'joiningPlace':
            baseTokens[field.key] = empLocation;
            break;
          case 'reportingManager':
            baseTokens[field.key] = empManager;
            break;
          case 'probationMonths':
            baseTokens[field.key] = employee?.probation_months ? `${employee.probation_months} months` : '3 months';
            break;
          case 'employmentType':
            baseTokens[field.key] = employee?.employment_type || 'Full-time';
            break;
        }
      } else if (field.label && !baseTokens[field.key]) {
        baseTokens[field.key] = field.label;
      }
    }

    // Override with custom field values
    for (const fv of fieldValues) {
      if (fv.value !== undefined && fv.value !== null && fv.value !== '') {
        baseTokens[fv.field_key] = fv.value;
      }
    }

    const normalizeKey = (str: string) => str.toLowerCase().replace(/[\s_\-]+/g, '');

    const normalizedMap = new Map<string, string>();
    for (const [k, v] of Object.entries(baseTokens)) {
      normalizedMap.set(k, v);
      normalizedMap.set(k.toLowerCase(), v);
      normalizedMap.set(normalizeKey(k), v);
    }

    let renderedHtml = template.content;
    renderedHtml = renderedHtml.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match, rawKey) => {
      const trimmed = rawKey.trim();
      if (baseTokens[trimmed] !== undefined) {
        return baseTokens[trimmed];
      }
      const lower = trimmed.toLowerCase();
      if (normalizedMap.has(lower)) {
        return normalizedMap.get(lower)!;
      }
      const norm = normalizeKey(trimmed);
      if (normalizedMap.has(norm)) {
        return normalizedMap.get(norm)!;
      }
      // Fuzzy fallbacks
      if (norm.includes('employee') || norm.includes('candidate') || norm.includes('name')) {
        return empName;
      }
      if (norm.includes('salary')) {
        return empSalaryFormatted;
      }
      if (norm.includes('joining') && norm.includes('date')) {
        return empJoiningDate;
      }
      if (norm.includes('offer') && norm.includes('date')) {
        return todayFormatted;
      }
      if (norm.includes('work') || norm.includes('location')) {
        return empLocation;
      }
      if (norm.includes('reporting') || norm.includes('manager')) {
        return empManager;
      }
      if (norm.includes('company') || norm.includes('botivate')) {
        return defaultCompanyName;
      }
      return match;
    });

    const resolvedEmployeeName =
      employee?.name ||
      baseTokens.employeeName ||
      baseTokens.name ||
      baseTokens.candidateName ||
      'Candidate / Employee';

    res.json({
      success: true,
      data: {
        templateId: Number(template.id),
        templateName: template.name,
        letterType: template.letter_type,
        employeeId: employee?.employee_id || employeeId || '',
        employeeName: resolvedEmployeeName,
        html: renderedHtml,
        renderedHtml,
        tokensReplaced: baseTokens,
      },
    });
  });
}

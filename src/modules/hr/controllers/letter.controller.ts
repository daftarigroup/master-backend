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
        ? { OR: [{ id: BigInt(employeeId) }, { employee_id: employeeId }] }
        : { employee_id: employeeId };
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

    const tokens: Record<string, string> = {
      todayDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
      companyName: 'Master Construction Co.',
      name: employee?.name || 'Candidate / Employee',
      employeeName: employee?.name || 'Candidate / Employee',
      candidateName: employee?.name || 'Candidate / Employee',
      empCode: employee?.emp_code || employee?.employee_id || 'EMP000',
      designation: employee?.designation || 'Staff',
      department: employee?.department?.name || 'Operations',
      joiningDate: employee?.joining_date
        ? employee.joining_date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
      lastWorkingDay: employee?.last_working_day
        ? employee.last_working_day.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'N/A',
      workLocation: employee?.work_location || 'Head Office',
      managerName: employee?.manager_name || 'Management',
      offeredCTC: employee?.offered_ctc || 'As discussed',
      monthlySalary: employee?.monthly_salary ? `₹${Number(employee.monthly_salary).toLocaleString('en-IN')}` : 'As discussed',
    };

    // Override with custom field values
    for (const fv of fieldValues) {
      tokens[fv.field_key] = fv.value;
    }

    let renderedHtml = template.content;
    for (const [key, val] of Object.entries(tokens)) {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
      renderedHtml = renderedHtml.replace(regex, val);
    }

    res.json({
      success: true,
      data: {
        templateId: Number(template.id),
        templateName: template.name,
        letterType: template.letter_type,
        employeeId: employee?.employee_id || employeeId || '',
        renderedHtml,
        tokensReplaced: tokens,
      },
    });
  });
}

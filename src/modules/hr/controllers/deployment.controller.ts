import { Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { FirmScopedRequest, assertFirmAllowed } from '../../checklist/middleware/scopeToFirmAccess.middleware';
import { ProjectAssignmentStatus } from '../types/deployment.types';

export class DeploymentController {
  /**
   * Helper to format an assignment record into both camelCase and snake_case for maximum frontend compatibility
   */
  private formatAssignment(a: any) {
    const empSummary = a.employee
      ? {
          id: a.employee.id.toString(),
          employeeId: a.employee.employee_id,
          empCode: a.employee.emp_code,
          name: a.employee.name,
          email: a.employee.email,
          phone: a.employee.phone,
          designation: a.employee.designation,
          departmentId: a.employee.department_id?.toString() || null,
          departmentName: a.employee.department?.name || null,
        }
      : null;

    return {
      ...a,
      id: a.id.toString(),
      employeeId: a.employee_id,
      projectId: Number(a.firm_id),
      projectName: a.firm_name,
      roleOnProject: a.role_on_project,
      assignedDate: a.assigned_date?.toISOString(),
      endDate: a.end_date?.toISOString() || null,
      linkedAssignmentId: a.linked_assignment_id?.toString() || null,
      approvedBy: a.approved_by,
      createdAt: a.created_at?.toISOString(),
      updatedAt: a.updated_at?.toISOString(),
      employee: empSummary,
    };
  }

  /**
   * GET /api/hr/assignments
   * List assignments with optional filters for firm/project, employee, status, department, and search
   */
  list = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const where: any = {};

    // Firm scope check for non-superadmins
    if (req.firmScope !== null && req.firmScope !== undefined) {
      const allowedFirmIds = (req.firmScope || []).filter((f) => /^\d+$/.test(f)).map(BigInt);
      where.firm_id = { in: allowedFirmIds.length > 0 ? allowedFirmIds : [-1n] };
    }

    const projectIdParam = req.query.projectId || req.query.firm_id;
    if (projectIdParam && projectIdParam !== 'all') {
      const firmIdStr = String(projectIdParam);
      assertFirmAllowed(req, firmIdStr);
      where.firm_id = BigInt(firmIdStr);
    }

    const employeeIdParam = req.query.employeeId || req.query.employee_id;
    if (employeeIdParam) {
      where.employee_id = String(employeeIdParam);
    }

    if (req.query.status && req.query.status !== 'all') {
      where.status = req.query.status as ProjectAssignmentStatus;
    }

    if (req.query.search) {
      const searchStr = String(req.query.search).trim();
      where.OR = [
        { firm_name: { contains: searchStr, mode: 'insensitive' } },
        { role_on_project: { contains: searchStr, mode: 'insensitive' } },
        { employee_id: { contains: searchStr, mode: 'insensitive' } },
        { employee: { name: { contains: searchStr, mode: 'insensitive' } } },
        { employee: { emp_code: { contains: searchStr, mode: 'insensitive' } } },
      ];
    }

    if (req.query.department) {
      const dept = String(req.query.department).trim();
      where.employee = {
        ...(where.employee || {}),
        OR: [
          { department: { name: { equals: dept, mode: 'insensitive' } } },
          /^\d+$/.test(dept) ? { department_id: BigInt(dept) } : {},
        ],
      };
    }

    const assignments = await prisma.projectAssignment.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        firm: {
          select: {
            id: true,
            firm_name: true,
            active: true,
          },
        },
        employee: {
          select: {
            id: true,
            employee_id: true,
            emp_code: true,
            name: true,
            email: true,
            phone: true,
            designation: true,
            department_id: true,
            department: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        events: {
          orderBy: { created_at: 'desc' },
          take: 5,
        },
      },
    });

    const formatted = assignments.map((a) => this.formatAssignment(a));
    res.json({ success: true, data: formatted });
  });

  /**
   * GET /api/hr/assignments/active
   * Get active assignment for a given employee (or null)
   */
  getActive = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const employeeId = String(req.query.employeeId || req.query.employee_id || '');
    if (!employeeId) {
      return res.json({ success: true, data: null });
    }

    const assignment = await prisma.projectAssignment.findFirst({
      where: {
        employee_id: employeeId,
        status: { in: ['active', 'on_leave'] },
      },
      include: {
        firm: true,
        employee: {
          include: {
            department: true,
          },
        },
        events: {
          orderBy: { created_at: 'desc' },
          take: 5,
        },
      },
    });

    if (!assignment) {
      return res.json({ success: true, data: null });
    }

    if (req.firmScope !== null && req.firmScope !== undefined) {
      assertFirmAllowed(req, assignment.firm_id.toString());
    }

    res.json({ success: true, data: this.formatAssignment(assignment) });
  });

  /**
   * GET /api/hr/assignments/:id
   */
  getById = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));

    const assignment = await prisma.projectAssignment.findUnique({
      where: { id },
      include: {
        firm: true,
        employee: {
          include: {
            department: true,
          },
        },
        events: {
          orderBy: { created_at: 'asc' },
        },
        linked_assignment: true,
      },
    });

    if (!assignment) {
      throw new ApiError(404, 'Project assignment not found');
    }

    if (req.firmScope !== null && req.firmScope !== undefined) {
      assertFirmAllowed(req, assignment.firm_id.toString());
    }

    res.json({ success: true, data: this.formatAssignment(assignment) });
  });

  /**
   * GET /api/hr/assignments/employee/:employeeId
   * Full assignment history for a given employee
   */
  getEmployeeHistory = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const employeeId = String(req.params.employeeId);

    const assignments = await prisma.projectAssignment.findMany({
      where: { employee_id: employeeId },
      orderBy: { assigned_date: 'desc' },
      include: {
        firm: {
          select: {
            id: true,
            firm_name: true,
          },
        },
        employee: {
          include: {
            department: true,
          },
        },
        events: {
          orderBy: { created_at: 'asc' },
        },
      },
    });

    res.json({ success: true, data: assignments.map((a) => this.formatAssignment(a)) });
  });

  /**
   * GET /api/hr/assignments/events
   * Query timeline events by employeeId or assignmentId
   */
  getEvents = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const where: any = {};
    const assignmentId = req.query.assignmentId ? BigInt(String(req.query.assignmentId)) : undefined;
    const employeeId = req.query.employeeId ? String(req.query.employeeId) : undefined;

    if (assignmentId) where.assignment_id = assignmentId;
    if (employeeId) where.employee_id = employeeId;

    const events = await prisma.projectAssignmentEvent.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        assignment: {
          include: {
            employee: {
              select: {
                name: true,
                emp_code: true,
                employee_id: true,
              },
            },
          },
        },
      },
    });

    const formatted = events.map((e) => ({
      ...e,
      id: e.id.toString(),
      assignmentId: e.assignment_id.toString(),
      employeeId: e.employee_id,
      employeeName: (e as any).assignment?.employee?.name || null,
      empCode: (e as any).assignment?.employee?.emp_code || null,
      eventType: e.event_type,
      fromProjectId: e.from_firm_id ? Number(e.from_firm_id) : null,
      toProjectId: e.to_firm_id ? Number(e.to_firm_id) : null,
      fromProjectName: e.from_firm_name,
      toProjectName: e.to_firm_name,
      performedBy: e.performed_by,
      timestamp: e.created_at.toISOString(),
    }));

    res.json({ success: true, data: formatted });
  });

  /**
   * GET /api/hr/assignments/:id/events
   */
  getAssignmentEvents = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));

    const assignment = await prisma.projectAssignment.findUnique({
      where: { id },
      select: { firm_id: true },
    });

    if (!assignment) {
      throw new ApiError(404, 'Project assignment not found');
    }

    if (req.firmScope !== null && req.firmScope !== undefined) {
      assertFirmAllowed(req, assignment.firm_id.toString());
    }

    const events = await prisma.projectAssignmentEvent.findMany({
      where: { assignment_id: id },
      orderBy: { created_at: 'asc' },
    });

    res.json({ success: true, data: events });
  });

  /**
   * POST /api/hr/assignments
   * Assign employee to project/firm
   */
  assign = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const body = req.body;
    const employee_id = body.employee_id || body.employeeId;
    const firm_id = body.firm_id !== undefined ? body.firm_id : body.projectId;
    const firm_name = body.firm_name || body.projectName;
    const role_on_project = body.role_on_project || body.roleOnProject || 'Staff';
    const assigned_date = body.assigned_date || body.assignedDate;
    const reason = body.reason;
    const approved_by = body.approved_by || body.approvedBy;

    const firmIdBigInt = BigInt(firm_id);
    assertFirmAllowed(req, firm_id.toString());

    // Verify firm exists
    const firm = await prisma.firm.findUnique({ where: { id: firmIdBigInt } });
    if (!firm) {
      throw new ApiError(404, 'Firm / Project not found');
    }

    // Verify employee exists in Employee table
    let employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { employee_id: String(employee_id) },
          { emp_code: String(employee_id) },
          /^\d+$/.test(String(employee_id)) ? { id: BigInt(String(employee_id)) } : {},
        ],
      },
    });

    // If employee does not exist yet (e.g. from legacy frontend mock), create a placeholder employee
    if (!employee) {
      employee = await prisma.employee.create({
        data: {
          employee_id: String(employee_id),
          emp_code: String(employee_id),
          name: String(employee_id),
          status: 'active',
          home_firm_id: firmIdBigInt,
        },
      });
    }

    // Check if employee already has an active or on-leave assignment
    const existing = await prisma.projectAssignment.findFirst({
      where: {
        employee_id: employee.employee_id,
        status: { in: ['active', 'on_leave'] },
      },
    });

    if (existing) {
      throw new ApiError(
        409,
        `Employee is already deployed to project "${existing.firm_name}" (status: ${existing.status}). Please shift or remove them first.`
      );
    }

    const effectiveAssignedDate = assigned_date ? new Date(assigned_date) : new Date();
    const performer = req.user?.email || req.user?.id || approved_by || 'System';

    const result = await prisma.$transaction(async (tx) => {
      const assignment = await tx.projectAssignment.create({
        data: {
          employee_id: employee.employee_id,
          firm_id: firmIdBigInt,
          firm_name: firm_name || firm.firm_name,
          role_on_project,
          status: 'active',
          assigned_date: effectiveAssignedDate,
          reason,
          approved_by: approved_by || performer,
        },
      });

      await tx.projectAssignmentEvent.create({
        data: {
          assignment_id: assignment.id,
          employee_id: employee.employee_id,
          event_type: 'assigned',
          to_firm_id: firmIdBigInt,
          to_firm_name: firm_name || firm.firm_name,
          notes: reason || `Assigned to ${firm.firm_name} as ${role_on_project}`,
          performed_by: performer,
        },
      });

      return assignment;
    });

    res.status(201).json({ success: true, data: this.formatAssignment(result) });
  });

  /**
   * POST /api/hr/assignments/:id/shift
   * Shift employee to a different project/firm (closes current, creates new chained assignment)
   */
  shift = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body;
    const to_firm_id = body.to_firm_id !== undefined ? body.to_firm_id : body.toProjectId;
    const to_firm_name = body.to_firm_name || body.toProjectName;
    const role_on_project = body.role_on_project || body.roleOnProject;
    const shift_date = body.shift_date || body.shiftDate;
    const reason = body.reason;
    const approved_by = body.approved_by || body.approvedBy;

    const currentAssignment = await prisma.projectAssignment.findUnique({ where: { id } });
    if (!currentAssignment) {
      throw new ApiError(404, 'Project assignment not found');
    }

    if (!['active', 'on_leave'].includes(currentAssignment.status)) {
      throw new ApiError(400, `Cannot shift assignment with status "${currentAssignment.status}"`);
    }

    const toFirmIdBigInt = BigInt(to_firm_id);
    assertFirmAllowed(req, to_firm_id.toString());

    const destFirm = await prisma.firm.findUnique({ where: { id: toFirmIdBigInt } });
    if (!destFirm) {
      throw new ApiError(404, 'Destination firm / project not found');
    }

    const effectiveShiftDate = shift_date ? new Date(shift_date) : new Date();
    const performer = req.user?.email || req.user?.id || approved_by || 'System';

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark current assignment as shifted
      await tx.projectAssignment.update({
        where: { id },
        data: {
          status: 'shifted',
          end_date: effectiveShiftDate,
        },
      });

      // 2. Create event on old assignment
      await tx.projectAssignmentEvent.create({
        data: {
          assignment_id: id,
          employee_id: currentAssignment.employee_id,
          event_type: 'shifted',
          from_firm_id: currentAssignment.firm_id,
          from_firm_name: currentAssignment.firm_name,
          to_firm_id: toFirmIdBigInt,
          to_firm_name: to_firm_name || destFirm.firm_name,
          notes: reason || `Shifted to ${destFirm.firm_name}`,
          performed_by: performer,
        },
      });

      // 3. Create new assignment chained to old
      const newAssignment = await tx.projectAssignment.create({
        data: {
          employee_id: currentAssignment.employee_id,
          firm_id: toFirmIdBigInt,
          firm_name: to_firm_name || destFirm.firm_name,
          role_on_project: role_on_project || currentAssignment.role_on_project,
          status: 'active',
          assigned_date: effectiveShiftDate,
          linked_assignment_id: id,
          reason,
          approved_by: approved_by || performer,
        },
      });

      // 4. Create initial assignment event on new assignment
      await tx.projectAssignmentEvent.create({
        data: {
          assignment_id: newAssignment.id,
          employee_id: currentAssignment.employee_id,
          event_type: 'assigned',
          from_firm_id: currentAssignment.firm_id,
          from_firm_name: currentAssignment.firm_name,
          to_firm_id: toFirmIdBigInt,
          to_firm_name: to_firm_name || destFirm.firm_name,
          notes: reason || `Shifted from ${currentAssignment.firm_name}`,
          performed_by: performer,
        },
      });

      return newAssignment;
    });

    res.json({ success: true, data: this.formatAssignment(result) });
  });

  /**
   * POST /api/hr/assignments/:id/leave
   * Put employee on leave
   */
  leave = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { reason, effective_date, effectiveDate } = req.body;
    const dateVal = effective_date || effectiveDate;

    const current = await prisma.projectAssignment.findUnique({ where: { id } });
    if (!current) {
      throw new ApiError(404, 'Project assignment not found');
    }

    if (current.status !== 'active') {
      throw new ApiError(400, `Cannot put on leave: current status is "${current.status}"`);
    }

    if (req.firmScope !== null && req.firmScope !== undefined) {
      assertFirmAllowed(req, current.firm_id.toString());
    }

    const performer = req.user?.email || req.user?.id || 'System';

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.projectAssignment.update({
        where: { id },
        data: { status: 'on_leave' },
      });

      await tx.projectAssignmentEvent.create({
        data: {
          assignment_id: id,
          employee_id: current.employee_id,
          event_type: 'put_on_leave',
          from_firm_id: current.firm_id,
          from_firm_name: current.firm_name,
          notes: reason || 'Marked on leave',
          performed_by: performer,
          created_at: dateVal ? new Date(dateVal) : undefined,
        },
      });

      return updated;
    });

    res.json({ success: true, data: this.formatAssignment(result) });
  });

  /**
   * POST /api/hr/assignments/:id/resume
   * Resume employee from leave back to active
   */
  resume = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { reason, effective_date, effectiveDate } = req.body;
    const dateVal = effective_date || effectiveDate;

    const current = await prisma.projectAssignment.findUnique({ where: { id } });
    if (!current) {
      throw new ApiError(404, 'Project assignment not found');
    }

    if (current.status !== 'on_leave') {
      throw new ApiError(400, `Cannot resume: current status is "${current.status}" (must be "on_leave")`);
    }

    if (req.firmScope !== null && req.firmScope !== undefined) {
      assertFirmAllowed(req, current.firm_id.toString());
    }

    const performer = req.user?.email || req.user?.id || 'System';

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.projectAssignment.update({
        where: { id },
        data: { status: 'active' },
      });

      await tx.projectAssignmentEvent.create({
        data: {
          assignment_id: id,
          employee_id: current.employee_id,
          event_type: 'resumed',
          to_firm_id: current.firm_id,
          to_firm_name: current.firm_name,
          notes: reason || 'Resumed active duty',
          performed_by: performer,
          created_at: dateVal ? new Date(dateVal) : undefined,
        },
      });

      return updated;
    });

    res.json({ success: true, data: this.formatAssignment(result) });
  });

  /**
   * POST /api/hr/assignments/:id/remove
   * Remove employee from project (site removal/unassignment)
   */
  remove = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { reason, effective_date, effectiveDate } = req.body;
    const dateVal = effective_date || effectiveDate;

    const current = await prisma.projectAssignment.findUnique({ where: { id } });
    if (!current) {
      throw new ApiError(404, 'Project assignment not found');
    }

    if (!['active', 'on_leave'].includes(current.status)) {
      throw new ApiError(400, `Cannot remove: current status is "${current.status}"`);
    }

    if (req.firmScope !== null && req.firmScope !== undefined) {
      assertFirmAllowed(req, current.firm_id.toString());
    }

    const endDate = dateVal ? new Date(dateVal) : new Date();
    const performer = req.user?.email || req.user?.id || 'System';

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.projectAssignment.update({
        where: { id },
        data: {
          status: 'removed',
          end_date: endDate,
        },
      });

      await tx.projectAssignmentEvent.create({
        data: {
          assignment_id: id,
          employee_id: current.employee_id,
          event_type: 'removed',
          from_firm_id: current.firm_id,
          from_firm_name: current.firm_name,
          notes: reason || 'Removed from project assignment',
          performed_by: performer,
          created_at: endDate,
        },
      });

      return updated;
    });

    res.json({ success: true, data: this.formatAssignment(result) });
  });

  /**
   * POST /api/hr/assignments/:id/complete
   * Mark assignment as completed (project closed/finished)
   */
  complete = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { reason, effective_date, effectiveDate } = req.body;
    const dateVal = effective_date || effectiveDate;

    const current = await prisma.projectAssignment.findUnique({ where: { id } });
    if (!current) {
      throw new ApiError(404, 'Project assignment not found');
    }

    if (!['active', 'on_leave'].includes(current.status)) {
      throw new ApiError(400, `Cannot complete: current status is "${current.status}"`);
    }

    if (req.firmScope !== null && req.firmScope !== undefined) {
      assertFirmAllowed(req, current.firm_id.toString());
    }

    const endDate = dateVal ? new Date(dateVal) : new Date();
    const performer = req.user?.email || req.user?.id || 'System';

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.projectAssignment.update({
        where: { id },
        data: {
          status: 'completed',
          end_date: endDate,
        },
      });

      await tx.projectAssignmentEvent.create({
        data: {
          assignment_id: id,
          employee_id: current.employee_id,
          event_type: 'completed',
          from_firm_id: current.firm_id,
          from_firm_name: current.firm_name,
          notes: reason || 'Project assignment completed',
          performed_by: performer,
          created_at: endDate,
        },
      });

      return updated;
    });

    res.json({ success: true, data: this.formatAssignment(result) });
  });
}

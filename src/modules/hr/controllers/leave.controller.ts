import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { HrAuditService } from '../services/hrAudit.service';

export class LeaveController {
  private formatLeave(l: any) {
    return {
      id: Number(l.id),
      employeeId: l.employee_id,
      employeeName: l.employee_name,
      empCode: l.employee?.emp_code || null,
      department: l.employee?.department?.name || null,
      departmentId: l.department_id ? l.department_id.toString() : null,
      departmentName: l.employee?.department?.name || null,
      hodId: l.hod_id || null,
      hodName: l.hod_name,
      substitute: l.substitute,
      leaveType: l.leave_type || null,
      fromDate: l.from_date.toISOString().slice(0, 10),
      toDate: l.to_date.toISOString().slice(0, 10),
      days: l.days ? Number(l.days) : null,
      leaveDays: Array.isArray(l.leave_days) ? l.leave_days : null,
      reason: l.reason,
      status: l.status,
      submittedBy: l.submitted_by || null,
      approvedBy: l.approved_by || null,
      approvedDate: l.approved_date ? l.approved_date.toISOString() : null,
      remarks: l.remarks || null,
      taskTransferStatus: l.task_transfer_status || null,
      createdAt: l.created_at?.toISOString(),
      updatedAt: l.updated_at?.toISOString(),
    };
  }

  /**
   * GET /leave
   */
  list = asyncHandler(async (req: Request, res: Response) => {
    const { status, employeeId } = req.query as any;
    const where: any = {};
    if (status && status !== 'all') where.status = status;
    if (employeeId) where.employee_id = employeeId;

    const leaves = await prisma.hrLeave.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        employee: { include: { department: true } },
      },
    });

    res.json({
      success: true,
      data: leaves.map((l: any) => this.formatLeave(l)),
    });
  });

  /**
   * GET /leave/approvals/pending
   */
  getPendingApprovals = asyncHandler(async (_req: Request, res: Response) => {
    const leaves = await prisma.hrLeave.findMany({
      where: { status: 'pending' },
      orderBy: { created_at: 'desc' },
      include: {
        employee: { include: { department: true } },
      },
    });

    res.json({
      success: true,
      data: leaves.map((l: any) => this.formatLeave(l)),
    });
  });

  /**
   * GET /leave/:id
   */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const leave = await prisma.hrLeave.findUnique({
      where: { id },
      include: {
        employee: { include: { department: true } },
      },
    });

    if (!leave) throw new ApiError(404, 'Leave request not found');

    res.json({
      success: true,
      data: this.formatLeave(leave),
    });
  });

  /**
   * GET /leave/employee/:employeeId
   */
  getByEmployee = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId);
    const leaves = await prisma.hrLeave.findMany({
      where: { employee_id: employeeId },
      orderBy: { created_at: 'desc' },
      include: {
        employee: { include: { department: true } },
      },
    });

    res.json({
      success: true,
      data: leaves.map((l: any) => this.formatLeave(l)),
    });
  });

  /**
   * POST /leave/submit
   */
  submit = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    const fromDate = new Date(body.fromDate);
    const toDate = new Date(body.toDate);

    const diffDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 3600 * 24)) + 1);
    const days = body.days !== undefined ? Number(body.days) : diffDays;

    let deptId: bigint | null = null;
    if (body.departmentId && /^\d+$/.test(String(body.departmentId))) {
      deptId = BigInt(body.departmentId);
    }

    const leave = await prisma.hrLeave.create({
      data: {
        employee_id: body.employeeId,
        employee_name: body.employeeName,
        department_id: deptId,
        hod_id: body.hodId ? String(body.hodId) : null,
        hod_name: body.hodName,
        substitute: body.substitute,
        leave_type: body.leaveType || 'Casual Leave (CL)',
        from_date: fromDate,
        to_date: toDate,
        days,
        leave_days: body.leaveDays || undefined,
        reason: body.reason,
        status: body.status || 'pending',
        submitted_by: (req as any).user?.name || body.employeeName,
      },
      include: { employee: { include: { department: true } } },
    });

    await HrAuditService.log({
      entityType: 'leave',
      entityId: leave.id.toString(),
      eventType: 'LEAVE_SUBMITTED',
      performedBy: (req as any).user?.name || body.employeeName,
      notes: `Leave requested from ${body.fromDate} to ${body.toDate} (${days} days) for: ${body.reason}`,
    });

    res.status(201).json({
      success: true,
      message: 'Leave request submitted successfully',
      data: this.formatLeave(leave),
    });
  });

  /**
   * GET /leave/:id/task-impact
   * Cross-module query to ChecklistTask and DelegationTask for tasks active during leave period
   */
  getTaskImpact = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const leave = await prisma.hrLeave.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!leave) throw new ApiError(404, 'Leave request not found');

    const empName = leave.employee_name;
    const userId = leave.employee?.user_id;

    const fromDate = leave.from_date;
    const toDate = leave.to_date;

    // 1. Query open checklist tasks
    const checklistTasks = await prisma.checklistTask.findMany({
      where: {
        AND: [
          {
            OR: [
              { doer_name: { equals: empName, mode: 'insensitive' } },
              userId ? { doer_id: userId } : {},
            ],
          },
          {
            planned_date: {
              gte: fromDate,
              lte: toDate,
            },
          },
          {
            status: { in: ['pending', 'extend', 'extended'] },
          },
        ],
      },
    });

    // 2. Query open delegation tasks
    const delegationTasks = await prisma.delegationTask.findMany({
      where: {
        AND: [
          {
            OR: [
              { doer_name: { equals: empName, mode: 'insensitive' } },
              userId ? { doer_id: userId } : {},
            ],
          },
          {
            planned_date: {
              gte: fromDate,
              lte: toDate,
            },
          },
          {
            status: { in: ['pending', 'extend', 'extended'] },
          },
        ],
      },
    });

    const items: any[] = [];
    for (const ct of checklistTasks) {
      items.push({
        taskId: `cl_${ct.task_id}`,
        rawId: ct.task_id.toString(),
        title: ct.task_description || 'Checklist Task',
        taskType: 'checklist',
        plannedDate: ct.planned_date?.toISOString().slice(0, 10) || '',
        currentDoerName: ct.doer_name || empName,
        suggestedBackupName: leave.substitute,
      });
    }

    for (const dt of delegationTasks) {
      items.push({
        taskId: `dl_${dt.task_id}`,
        rawId: dt.task_id.toString(),
        title: dt.task_description || 'Delegation Task',
        taskType: 'delegation',
        plannedDate: dt.planned_date?.toISOString().slice(0, 10) || '',
        currentDoerName: dt.doer_name || empName,
        suggestedBackupName: leave.substitute,
      });
    }

    res.json({
      success: true,
      data: {
        status: items.length > 0 ? 'needs_decision' : 'no_impact',
        totalTasks: items.length,
        items,
      },
    });
  });

  /**
   * PATCH /leave/:id/status
   */
  updateStatus = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { status, remarks, leaveDays, taskDecisions } = req.body;
    const approverName = (req as any).user?.name || 'Admin';

    const leave = await prisma.hrLeave.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!leave) throw new ApiError(404, 'Leave request not found');

    const result = await prisma.$transaction(async (tx) => {
      // 1. If approved and taskDecisions provided, apply delegation transfers
      if (status === 'approved' && Array.isArray(taskDecisions)) {
        for (const decision of taskDecisions) {
          if (decision.action === 'transfer') {
            const newDoerName = decision.newDoerName || leave.substitute;
            let newDoerId: bigint | null = null;
            if (decision.newDoerId && /^\d+$/.test(decision.newDoerId)) {
              newDoerId = BigInt(decision.newDoerId);
            }

            if (decision.taskId.startsWith('cl_')) {
              const ctId = BigInt(decision.taskId.replace('cl_', ''));
              await tx.checklistTask.update({
                where: { task_id: ctId },
                data: {
                  doer_name: newDoerName,
                  ...(newDoerId ? { doer_id: newDoerId } : {}),
                },
              });
            } else if (decision.taskId.startsWith('dl_')) {
              const dtId = BigInt(decision.taskId.replace('dl_', ''));
              await tx.delegationTask.update({
                where: { task_id: dtId },
                data: {
                  doer_name: newDoerName,
                  ...(newDoerId ? { doer_id: newDoerId } : {}),
                },
              });
            }
          }
        }
      }

      // 2. Update HrLeave
      const updatedLeave = await tx.hrLeave.update({
        where: { id },
        data: {
          status,
          remarks: remarks !== undefined ? remarks : leave.remarks,
          leave_days: leaveDays !== undefined ? leaveDays : leave.leave_days,
          approved_by: status === 'approved' ? approverName : leave.approved_by,
          approved_date: status === 'approved' ? new Date() : leave.approved_date,
          task_transfer_status: status === 'approved' ? (taskDecisions?.length ? 'RESOLVED' : 'NONE') : leave.task_transfer_status,
        },
        include: { employee: { include: { department: true } } },
      });

      // 3. If approved, stamp Attendance records for the leave days
      if (status === 'approved') {
        const start = new Date(leave.from_date);
        const end = new Date(leave.to_date);
        const cur = new Date(start);

        while (cur <= end) {
          const dateStr = cur.toISOString().slice(0, 10);
          await tx.hrAttendance.upsert({
            where: {
              employee_id_date: {
                employee_id: leave.employee_id,
                date: dateStr,
              },
            },
            create: {
              employee_id: leave.employee_id,
              date: dateStr,
              status: 'leave',
              working_hours: 0,
              overtime: 0,
              notes: `Approved leave: ${leave.reason}`,
            },
            update: {
              status: 'leave',
              working_hours: 0,
              overtime: 0,
              notes: `Approved leave: ${leave.reason}`,
            },
          });
          cur.setDate(cur.getDate() + 1);
        }
      }

      await HrAuditService.log(
        {
          entityType: 'leave',
          entityId: id.toString(),
          eventType: `LEAVE_${status.toUpperCase()}`,
          performedBy: approverName,
          notes: `Leave status updated to ${status}. Remarks: ${remarks || 'None'}`,
        },
        tx
      );

      return updatedLeave;
    });

    res.json({
      success: true,
      message: `Leave request ${status} successfully`,
      data: this.formatLeave(result),
    });
  });

  /**
   * DELETE /leave/:id
   */
  delete = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    await prisma.hrLeave.delete({ where: { id } });
    res.json({ success: true, message: 'Leave request deleted successfully' });
  });
}

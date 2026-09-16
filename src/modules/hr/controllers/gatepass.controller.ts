import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { HrAuditService } from '../services/hrAudit.service';
import { NotificationService } from '../services/notification.service';

export class GatePassController {
  private parseDateTime(input?: string | null, defaultOffsetHours = 0): Date {
    if (!input || input.trim() === '-' || input.trim() === '—') {
      return new Date(Date.now() + defaultOffsetHours * 60 * 60 * 1000);
    }
    const trimmed = input.trim();
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d;
    }
    const today = new Date();
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const meridiem = timeMatch[3]?.toUpperCase();
      if (meridiem === 'PM' && hours < 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;
      today.setHours(hours, minutes, 0, 0);
      return today;
    }
    return new Date(Date.now() + defaultOffsetHours * 60 * 60 * 1000);
  }

  private formatPass(p: any) {
    const depTime = p.departure_time instanceof Date ? p.departure_time.toISOString() : p.departure_time;
    const expTime = p.expected_arrival instanceof Date ? p.expected_arrival.toISOString() : p.expected_arrival;

    return {
      id: Number(p.id),
      employee: p.employee_name || p.employee?.name || 'Employee',
      employeeId: p.employee_id,
      empCode: p.emp_code || p.employee?.emp_code || null,
      department: p.department_name || p.employee?.department?.name || null,
      type: p.type || 'Official',
      placeToVisit: p.place_to_visit,
      reason: p.reason,
      date: depTime ? depTime.slice(0, 10) : new Date().toISOString().slice(0, 10),
      departureTime: depTime,
      expectedArrival: expTime,
      outTime: p.out_time || null,
      inTime: p.in_time || null,
      status: p.status,
      approvedBy: p.approved_by || 'Admin',
      whatsappNo: p.whatsapp_no || null,
      attachment: p.attachment || null,
      securityLogs: Array.isArray(p.security_logs) ? p.security_logs : [],
      createdAt: p.created_at?.toISOString(),
      updatedAt: p.updated_at?.toISOString(),
    };
  }

  /**
   * GET /gatepass
   */
  list = asyncHandler(async (req: Request, res: Response) => {
    const { status, employeeId } = req.query as any;
    const where: any = {};
    if (status && status !== 'all') where.status = status;
    if (employeeId) where.employee_id = employeeId;

    const passes = await prisma.hrGatePass.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        employee: { include: { department: true } },
      },
    });

    res.json({
      success: true,
      data: passes.map((p: any) => this.formatPass(p)),
    });
  });

  /**
   * GET /gatepass/stats
   */
  stats = asyncHandler(async (_req: Request, res: Response) => {
    const today = new Date().toISOString().slice(0, 10);
    const passes = await prisma.hrGatePass.findMany({
      where: {
        created_at: {
          gte: new Date(`${today}T00:00:00.000Z`),
        },
      },
    });

    const total = await prisma.hrGatePass.count();
    const issuedToday = passes.filter((p) => p.status === 'open').length;
    const currentlyOut = passes.filter((p) => p.status === 'out').length;
    const returned = passes.filter((p) => p.status === 'closed').length;
    const pending = passes.filter((p) => p.status === 'pending').length;

    res.json({
      success: true,
      data: {
        total,
        issued: issuedToday,
        currentlyOut,
        returned,
        pending,
      },
    });
  });

  /**
   * GET /gatepass/:id
   */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const pass = await prisma.hrGatePass.findUnique({
      where: { id },
      include: { employee: { include: { department: true } } },
    });

    if (!pass) throw new ApiError(404, 'Gate pass not found');

    res.json({
      success: true,
      data: this.formatPass(pass),
    });
  });

  /**
   * GET /gatepass/employee/:employeeId
   */
  getByEmployee = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = String(req.params.employeeId);
    const passes = await prisma.hrGatePass.findMany({
      where: { employee_id: employeeId },
      orderBy: { created_at: 'desc' },
      include: { employee: { include: { department: true } } },
    });

    res.json({
      success: true,
      data: passes.map((p: any) => this.formatPass(p)),
    });
  });

  /**
   * POST /gatepass and POST /gatepass/issue
   */
  issue = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    const approverName = (req as any).user?.name || body.approvedBy || 'Admin';

    // 1. Resolve employee details if needed
    const employee = await prisma.employee.findFirst({
      where: { employee_id: body.employeeId },
      include: { department: true },
    });

    const empName = body.employeeName || employee?.name || 'Employee';
    const empCode = body.empCode || employee?.emp_code || body.employeeId;
    const deptName = body.departmentName || employee?.department?.name || '';
    const departureTime = this.parseDateTime(body.departureTime || body.outTime, 0);
    const expectedArrival = this.parseDateTime(body.expectedArrival || body.inTime, 3);

    const initialLog = {
      timestamp: new Date().toISOString(),
      action: 'GATE_PASS_ISSUED',
      status: body.status || 'open',
      performedBy: approverName,
      notes: `Gate pass issued to visit ${body.placeToVisit}`,
    };

    const pass = await prisma.hrGatePass.create({
      data: {
        employee_id: body.employeeId,
        employee_name: empName,
        emp_code: empCode,
        department_name: deptName,
        type: body.type || 'Official',
        place_to_visit: body.placeToVisit,
        reason: body.reason,
        departure_time: departureTime,
        expected_arrival: expectedArrival,
        out_time: body.outTime || departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        in_time: body.inTime || '-',
        status: body.status || 'open',
        approved_by: approverName,
        whatsapp_no: body.whatsappNo || employee?.phone || null,
        attachment: body.attachment || null,
        security_logs: [initialLog],
      },
      include: { employee: { include: { department: true } } },
    });

    await HrAuditService.log({
      entityType: 'gatepass',
      entityId: pass.id.toString(),
      eventType: 'GATE_PASS_ISSUED',
      performedBy: approverName,
      notes: `Gate pass #${pass.id} issued for ${empName} (${body.placeToVisit})`,
    });

    // Send WhatsApp notification if whatsappNo is available
    if (pass.whatsapp_no) {
      NotificationService.sendWhatsApp({
        to: pass.whatsapp_no,
        type: 'GATE_PASS_ISSUED',
        title: 'Gate Pass Issued',
        message: `Hello ${empName}, your ${pass.type} gate pass to ${pass.place_to_visit} has been issued. Expected return: ${expectedArrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        metadata: { id: pass.id.toString() },
      }).catch((err) => console.error('[GatePassController] WhatsApp send error:', err));
    }

    res.status(201).json({
      success: true,
      message: 'Gate pass issued successfully',
      data: this.formatPass(pass),
    });
  });

  /**
   * PATCH /gatepass/:id/status
   */
  updateStatus = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { status, notes } = req.body;
    const actorName = (req as any).user?.name || 'Security';

    const pass = await prisma.hrGatePass.findUnique({ where: { id } });
    if (!pass) throw new ApiError(404, 'Gate pass not found');

    const logs = Array.isArray(pass.security_logs) ? [...(pass.security_logs as any[])] : [];
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    logs.unshift({
      timestamp: new Date().toISOString(),
      action: `STATUS_CHANGED_TO_${status.toUpperCase()}`,
      status,
      performedBy: actorName,
      notes: notes || `Status updated to ${status}`,
    });

    const updateData: any = {
      status,
      security_logs: logs,
    };

    if (status === 'out') {
      updateData.out_time = nowStr;
    } else if (status === 'closed') {
      updateData.in_time = nowStr;
    }

    const updated = await prisma.hrGatePass.update({
      where: { id },
      data: updateData,
      include: { employee: { include: { department: true } } },
    });

    await HrAuditService.log({
      entityType: 'gatepass',
      entityId: id.toString(),
      eventType: `GATE_PASS_STATUS_${status.toUpperCase()}`,
      performedBy: actorName,
      notes: `Gate pass status updated to ${status}. Note: ${notes || 'None'}`,
    });

    res.json({
      success: true,
      message: `Gate pass status updated to ${status}`,
      data: this.formatPass(updated),
    });
  });

  /**
   * DELETE /gatepass/:id
   */
  delete = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    await prisma.hrGatePass.delete({ where: { id } });
    res.json({ success: true, message: 'Gate pass deleted successfully' });
  });
}

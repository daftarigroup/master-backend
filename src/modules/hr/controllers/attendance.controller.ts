import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { HrAuditService } from '../services/hrAudit.service';

const PUNCH_TYPES = ['in', 'out', 'half_day', 'full_day'] as const;
type PunchType = (typeof PUNCH_TYPES)[number];

export class AttendanceController {
  private parseTimeToHours(timeStr?: string | null): number | null {
    if (!timeStr) return null;
    const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      return Number(match[1]) + Number(match[2]) / 60;
    }
    const d = new Date(timeStr);
    if (!isNaN(d.getTime())) {
      return d.getHours() + d.getMinutes() / 60;
    }
    return null;
  }

  private calculateHours(checkIn?: string | null, checkOut?: string | null) {
    const inH = this.parseTimeToHours(checkIn);
    const outH = this.parseTimeToHours(checkOut);
    if (inH !== null && outH !== null && outH >= inH) {
      return Number((outH - inH).toFixed(2));
    }
    return 0;
  }

  private async resolveEmployeeId(req: Request): Promise<string | null> {
    const fromReq =
      (req as any).employee?.employeeId ||
      (req.query?.employeeId as string) ||
      (req.body?.employeeId as string);
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

  private formatAttendance(a: any) {
    return {
      id: Number(a.id),
      employeeId: a.employee_id,
      employeeName: a.employee?.name || null,
      empCode: a.employee?.emp_code || null,
      departmentName: a.employee?.department?.name || null,
      date: a.date,
      shiftId: a.shift_id || null,
      checkIn: a.check_in || null,
      checkOut: a.check_out || null,
      status: a.status,
      workingHours: Number(a.working_hours || 0),
      overtime: Number(a.overtime || 0),
      notes: a.notes || null,
      createdAt: a.created_at?.toISOString(),
      updatedAt: a.updated_at?.toISOString(),
    };
  }

  private formatPunch(p: any) {
    return {
      id: p.id,
      employeeId: p.employee_id,
      employeeName: p.employee?.name || null,
      empCode: p.employee?.emp_code || null,
      departmentName: p.employee?.department?.name || null,
      date: p.date,
      punchType: p.punch_type,
      punchTime: p.punch_time,
      photoUrl: p.photo_url,
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      submittedBy: p.submitted_by || null,
      notes: p.notes || null,
      createdAt: p.created_at?.toISOString(),
    };
  }

  /**
   * GET /attendance/shifts
   */
  getShifts = asyncHandler(async (_req: Request, res: Response) => {
    const shifts = [
      { id: 'shift-gen', name: 'General Shift', startTime: '09:00', endTime: '18:00', graceMinutes: 15, isDefault: true },
      { id: 'shift-morn', name: 'Morning Shift', startTime: '06:00', endTime: '14:00', graceMinutes: 15, isDefault: false },
      { id: 'shift-eve', name: 'Evening Shift', startTime: '14:00', endTime: '22:00', graceMinutes: 15, isDefault: false },
      { id: 'shift-night', name: 'Night Shift', startTime: '22:00', endTime: '06:00', graceMinutes: 15, isDefault: false },
    ];
    res.json({ success: true, data: shifts });
  });

  /**
   * GET /attendance/daily?date=YYYY-MM-DD
   */
  getDaily = asyncHandler(async (req: Request, res: Response) => {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const records = await prisma.hrAttendance.findMany({
      where: { date },
      include: {
        employee: {
          include: { department: true },
        },
      },
    });

    res.json({
      success: true,
      data: records.map((r: any) => this.formatAttendance(r)),
    });
  });

  /**
   * GET /attendance/today
   */
  getToday = asyncHandler(async (req: Request, res: Response) => {
    const today = new Date().toISOString().slice(0, 10);
    const employeeId = (req as any).employee?.employeeId;

    const where: any = { date: today };
    if (employeeId) where.employee_id = employeeId;

    const records = await prisma.hrAttendance.findMany({
      where,
      include: {
        employee: { include: { department: true } },
      },
    });

    res.json({
      success: true,
      data: employeeId ? (records[0] ? this.formatAttendance(records[0]) : null) : records.map((r: any) => this.formatAttendance(r)),
    });
  });

  /**
   * GET /attendance/monthly?employeeId=...&year=...&month=...
   */
  getMonthly = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = req.query.employeeId as string;
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || (new Date().getMonth() + 1);

    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const where: any = {
      date: { startsWith: prefix },
    };
    if (employeeId) where.employee_id = employeeId;

    const records = await prisma.hrAttendance.findMany({
      where,
      orderBy: { date: 'asc' },
      include: {
        employee: { include: { department: true } },
      },
    });

    res.json({
      success: true,
      data: records.map((r: any) => this.formatAttendance(r)),
    });
  });

  // Sunday/Saturday — the app-wide weekly-off default (no per-shift weekly-off
  // calendar is wired up yet; every shift resolves to this same pair).
  private static readonly WEEKOFF_DAYS = [0, 6];
  // 09:00 — the default shift's start time (see getShifts); used to flag late days.
  private static readonly SHIFT_START_MINS = 9 * 60;

  private toMinutes(t: string | null | undefined): number {
    if (!t) return -1;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  /**
   * GET /attendance/monthly-summary?year=...&month=...
   * Buckets each day of the month (up to today, for the current month) into
   * regular-present / holiday-worked / weekend-worked / half-day / absent /
   * leave / punch-mis, mirroring the per-employee monthly modal's client-side
   * logic so the two views agree — this is the ledger the "Attendance
   * Records" table reads, so a kiosk-submitted punch has to roll up here.
   */
  getMonthlySummary = asyncHandler(async (req: Request, res: Response) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const prefix = `${year}-${String(month).padStart(2, '0')}`;

    const [employees, records, holidays] = await Promise.all([
      prisma.employee.findMany({ where: { status: 'active' }, include: { department: true } }),
      prisma.hrAttendance.findMany({ where: { date: { startsWith: prefix } } }),
      prisma.holiday.findMany({
        where: {
          holiday_date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
        },
      }),
    ]);

    const holidaySet = new Set(holidays.map((h: any) => new Date(h.holiday_date).toISOString().slice(0, 10)));

    const now = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const lastDay = isCurrentMonth ? now.getDate() : daysInMonth;
    const todayIso = now.toISOString().slice(0, 10);

    const summary = employees.map((emp: any) => {
      const empRecords = new Map(
        records.filter((r: any) => r.employee_id === emp.employee_id).map((r: any) => [r.date, r])
      );
      const joiningIso = emp.joining_date ? new Date(emp.joining_date).toISOString().slice(0, 10) : null;

      let workingDayCount = 0;
      let regularPresent = 0;
      let holidayWorked = 0;
      let weekoffWorked = 0;
      let halfDay = 0;
      let absent = 0;
      let leave = 0;
      let punchMis = 0;
      let lateDays = 0;

      for (let day = 1; day <= lastDay; day++) {
        const dateIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (joiningIso && dateIso < joiningIso) continue;

        const dow = new Date(`${dateIso}T00:00:00`).getDay();
        const isHoliday = holidaySet.has(dateIso);
        const isWeekoff = AttendanceController.WEEKOFF_DAYS.includes(dow);
        if (!isHoliday && !isWeekoff) workingDayCount++;

        const record: any = empRecords.get(dateIso) || null;
        const status = record?.status ?? null;
        const isPresent = status === 'present' || status === 'overtime';
        const isHalf = status === 'half-day';
        const isPunchMisPending = !!(record?.check_in && !record?.check_out);

        if (isHoliday) {
          if (isPresent || isPunchMisPending) holidayWorked++;
        } else if (isWeekoff) {
          if (isPresent || isPunchMisPending) weekoffWorked++;
        } else if (isPunchMisPending) {
          punchMis++;
        } else if (isPresent) {
          regularPresent++;
        } else if (isHalf) {
          halfDay++;
        } else if (status === 'absent') {
          absent++;
        } else if (status === 'leave') {
          leave++;
        } else if (!record && dateIso < todayIso) {
          absent++;
        }

        if (record?.check_in && this.toMinutes(record.check_in) > AttendanceController.SHIFT_START_MINS) {
          lateDays++;
        }
      }

      const totalPresent = regularPresent + holidayWorked + weekoffWorked + halfDay * 0.5;
      const attendancePercentage =
        workingDayCount > 0
          ? Math.min(100, Math.round(((regularPresent + halfDay * 0.5) / workingDayCount) * 100))
          : 0;

      return {
        employeeId: emp.employee_id,
        empCode: emp.emp_code || null,
        employeeName: emp.name,
        department: emp.department?.name || null,
        workingDays: workingDayCount,
        regularDays: regularPresent,
        holidayWorked,
        weekendWorked: weekoffWorked,
        totalPresent: Number(totalPresent.toFixed(1)),
        absentDays: absent,
        halfDays: halfDay,
        leaveDays: leave,
        punchMisDays: punchMis,
        lateDays,
        attendancePercentage,
      };
    });

    res.json({
      success: true,
      data: summary,
    });
  });

  /**
   * POST /attendance (Upsert)
   */
  upsert = asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, date, shiftId, checkIn, checkOut, status, notes } = req.body;

    const config = await prisma.hrAttendanceConfig.findFirst();
    const fullDayH = Number(config?.full_day_hours || 9);
    const halfDayH = Number(config?.half_day_min_hours || 4);

    const calculatedHours = this.calculateHours(checkIn, checkOut);
    let finalStatus = status || 'present';
    let overtime = 0;

    if (calculatedHours > 0 && !status) {
      if (calculatedHours >= fullDayH) {
        finalStatus = 'present';
        overtime = Number((calculatedHours - fullDayH).toFixed(2));
      } else if (calculatedHours >= halfDayH) {
        finalStatus = 'half-day';
      } else {
        finalStatus = 'absent';
      }
    }

    const record = await prisma.hrAttendance.upsert({
      where: {
        employee_id_date: {
          employee_id: employeeId,
          date,
        },
      },
      create: {
        employee_id: employeeId,
        date,
        shift_id: shiftId || null,
        check_in: checkIn || null,
        check_out: checkOut || null,
        status: finalStatus,
        working_hours: calculatedHours,
        overtime,
        notes: notes || null,
      },
      update: {
        shift_id: shiftId !== undefined ? shiftId : undefined,
        check_in: checkIn !== undefined ? checkIn : undefined,
        check_out: checkOut !== undefined ? checkOut : undefined,
        status: finalStatus,
        working_hours: calculatedHours > 0 ? calculatedHours : undefined,
        overtime: overtime > 0 ? overtime : undefined,
        notes: notes !== undefined ? notes : undefined,
      },
      include: {
        employee: { include: { department: true } },
      },
    });

    res.json({
      success: true,
      data: this.formatAttendance(record),
    });
  });

  /**
   * PATCH /attendance/:id
   */
  update = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body;

    const existing = await prisma.hrAttendance.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Attendance record not found');

    const checkIn = body.checkIn !== undefined ? body.checkIn : existing.check_in;
    const checkOut = body.checkOut !== undefined ? body.checkOut : existing.check_out;
    const hours = this.calculateHours(checkIn, checkOut);

    const updated = await prisma.hrAttendance.update({
      where: { id },
      data: {
        shift_id: body.shiftId !== undefined ? body.shiftId : undefined,
        check_in: checkIn,
        check_out: checkOut,
        status: body.status !== undefined ? body.status : existing.status,
        working_hours: hours > 0 ? hours : existing.working_hours,
        overtime: hours > 9 ? Number((hours - 9).toFixed(2)) : existing.overtime,
        notes: body.notes !== undefined ? body.notes : existing.notes,
      },
      include: {
        employee: { include: { department: true } },
      },
    });

    res.json({
      success: true,
      data: this.formatAttendance(updated),
    });
  });

  /**
   * POST /attendance/checkin
   */
  checkin = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = await this.resolveEmployeeId(req);
    if (!employeeId) throw new ApiError(400, 'Employee ID is required');

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const checkIn = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const record = await prisma.hrAttendance.upsert({
      where: {
        employee_id_date: { employee_id: employeeId, date },
      },
      create: {
        employee_id: employeeId,
        date,
        check_in: checkIn,
        status: 'present',
        working_hours: 0,
        overtime: 0,
      },
      update: {
        check_in: checkIn,
        status: 'present',
      },
      include: { employee: { include: { department: true } } },
    });

    res.json({
      success: true,
      message: `Checked in successfully at ${checkIn}`,
      data: this.formatAttendance(record),
    });
  });

  /**
   * PATCH /attendance/checkout
   */
  checkout = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = await this.resolveEmployeeId(req);
    if (!employeeId) throw new ApiError(400, 'Employee ID is required');

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const checkOut = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const existing = await prisma.hrAttendance.findUnique({
      where: { employee_id_date: { employee_id: employeeId, date } },
    });

    const checkIn = existing?.check_in || '09:00';
    const hours = this.calculateHours(checkIn, checkOut);
    const overtime = hours > 9 ? Number((hours - 9).toFixed(2)) : 0;

    const record = await prisma.hrAttendance.upsert({
      where: { employee_id_date: { employee_id: employeeId, date } },
      create: {
        employee_id: employeeId,
        date,
        check_in: checkIn,
        check_out: checkOut,
        working_hours: hours,
        overtime,
        status: hours >= 4 ? (hours >= 9 ? 'present' : 'half-day') : 'absent',
      },
      update: {
        check_out: checkOut,
        working_hours: hours,
        overtime,
        status: hours >= 4 ? (hours >= 9 ? 'present' : 'half-day') : 'absent',
      },
      include: { employee: { include: { department: true } } },
    });

    res.json({
      success: true,
      message: `Checked out successfully at ${checkOut}`,
      data: this.formatAttendance(record),
    });
  });

  /**
   * POST /attendance/punch
   *
   * Submitted by a logged-in incharge/operator on an employee's behalf — the
   * employee themselves never logs in (see [[hr-system-access-model]]). Every
   * submission is kept as its own permanent HrAttendancePunch record (photo +
   * location + time never overwritten), and also rolls up into that day's
   * HrAttendance summary row (check_in/check_out/status) the rest of the HR
   * system already reads from.
   */
  submitPunch = asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, punchType, time, date, photoUrl, latitude, longitude, notes } = req.body;

    if (!employeeId) throw new ApiError(400, 'employeeId is required');
    if (!PUNCH_TYPES.includes(punchType)) {
      throw new ApiError(400, `punchType must be one of: ${PUNCH_TYPES.join(', ')}`);
    }
    if (!photoUrl) {
      throw new ApiError(400, 'A location-stamped photo is required to submit attendance');
    }
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      throw new ApiError(400, 'Location (latitude/longitude) is required to submit attendance');
    }

    const employee = await prisma.employee.findFirst({ where: { employee_id: String(employeeId) } });
    if (!employee) throw new ApiError(404, 'Employee not found');

    const now = new Date();
    const submissionDate = date || now.toISOString().slice(0, 10);
    const submissionTime =
      time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const submittedBy = String(
      (req as any).user?.name || (req as any).user?.email || (req as any).user?.id || 'Incharge'
    );

    const result = await prisma.$transaction(async (tx) => {
      const punch = await tx.hrAttendancePunch.create({
        data: {
          employee_id: employee.employee_id,
          date: submissionDate,
          punch_type: punchType as PunchType,
          punch_time: submissionTime,
          photo_url: String(photoUrl),
          latitude: Number(latitude),
          longitude: Number(longitude),
          submitted_by: submittedBy,
          notes: notes || null,
        },
      });

      const existing = await tx.hrAttendance.findUnique({
        where: { employee_id_date: { employee_id: employee.employee_id, date: submissionDate } },
      });

      const config = await tx.hrAttendanceConfig.findFirst();
      const fullDayH = Number(config?.full_day_hours || 9);
      const halfDayH = Number(config?.half_day_min_hours || 4);

      let attendanceData: {
        check_in?: string;
        check_out?: string;
        status?: string;
        working_hours?: number;
        overtime?: number;
      } = {};

      if (punchType === 'in') {
        attendanceData = { check_in: submissionTime };
      } else if (punchType === 'out') {
        const checkIn = existing?.check_in || submissionTime;
        const hours = this.calculateHours(checkIn, submissionTime);
        attendanceData = {
          check_out: submissionTime,
          working_hours: hours,
          overtime: hours > fullDayH ? Number((hours - fullDayH).toFixed(2)) : 0,
          status: hours >= fullDayH ? 'present' : hours >= halfDayH ? 'half-day' : existing?.status,
        };
      } else if (punchType === 'half_day') {
        attendanceData = { status: 'half-day', check_in: existing?.check_in || submissionTime };
      } else {
        // full_day
        attendanceData = { status: 'present', check_in: existing?.check_in || submissionTime };
      }

      const kioskNote = `Marked '${punchType}' via attendance kiosk by ${submittedBy}`;

      const attendance = await tx.hrAttendance.upsert({
        where: { employee_id_date: { employee_id: employee.employee_id, date: submissionDate } },
        create: {
          employee_id: employee.employee_id,
          date: submissionDate,
          check_in: attendanceData.check_in || null,
          check_out: attendanceData.check_out || null,
          status: attendanceData.status || 'present',
          working_hours: attendanceData.working_hours || 0,
          overtime: attendanceData.overtime || 0,
          notes: kioskNote,
        },
        update: {
          check_in: attendanceData.check_in,
          check_out: attendanceData.check_out,
          status: attendanceData.status,
          working_hours: attendanceData.working_hours,
          overtime: attendanceData.overtime,
          notes: kioskNote,
        },
        include: { employee: { include: { department: true } } },
      });

      return { punch, attendance };
    });

    await HrAuditService.log({
      entityType: 'attendance',
      entityId: result.punch.id,
      eventType: 'ATTENDANCE_PUNCH_SUBMITTED',
      performedBy: submittedBy,
      notes: `'${punchType}' punch for ${employee.name} (${employee.employee_id}) on ${submissionDate} at ${submissionTime}`,
    });

    res.status(201).json({
      success: true,
      message: 'Attendance submitted successfully',
      data: {
        punch: this.formatPunch({ ...result.punch, employee }),
        attendance: this.formatAttendance(result.attendance),
      },
    });
  });

  /**
   * GET /attendance/punches?employeeId=&date=&from=&to=
   */
  listPunches = asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, date, from, to } = req.query as any;
    const where: any = {};
    if (employeeId) where.employee_id = String(employeeId);
    if (date) {
      where.date = String(date);
    } else if (from || to) {
      where.date = {};
      if (from) where.date.gte = String(from);
      if (to) where.date.lte = String(to);
    }

    const punches = await prisma.hrAttendancePunch.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 200,
      include: { employee: { include: { department: true } } },
    });

    res.json({
      success: true,
      data: punches.map((p: any) => this.formatPunch(p)),
    });
  });

  /**
   * GET /attendance/config
   */
  getConfig = asyncHandler(async (_req: Request, res: Response) => {
    let config = await prisma.hrAttendanceConfig.findFirst();
    if (!config) {
      config = await prisma.hrAttendanceConfig.create({
        data: {
          full_day_hours: 9,
          half_day_min_hours: 4,
          late_grace_minutes: 15,
        },
      });
    }

    res.json({
      success: true,
      data: {
        id: config.id.toString(),
        fullDayHours: Number(config.full_day_hours),
        halfDayMinHours: Number(config.half_day_min_hours),
        lateGraceMinutes: config.late_grace_minutes,
      },
    });
  });

  /**
   * PUT /attendance/config
   */
  updateConfig = asyncHandler(async (req: Request, res: Response) => {
    const { fullDayHours, halfDayMinHours, lateGraceMinutes } = req.body;
    let config = await prisma.hrAttendanceConfig.findFirst();

    if (config) {
      config = await prisma.hrAttendanceConfig.update({
        where: { id: config.id },
        data: {
          full_day_hours: fullDayHours,
          half_day_min_hours: halfDayMinHours,
          late_grace_minutes: lateGraceMinutes,
        },
      });
    } else {
      config = await prisma.hrAttendanceConfig.create({
        data: {
          full_day_hours: fullDayHours,
          half_day_min_hours: halfDayMinHours,
          late_grace_minutes: lateGraceMinutes,
        },
      });
    }

    res.json({
      success: true,
      message: 'Attendance configuration updated',
      data: {
        id: config.id.toString(),
        fullDayHours: Number(config.full_day_hours),
        halfDayMinHours: Number(config.half_day_min_hours),
        lateGraceMinutes: config.late_grace_minutes,
      },
    });
  });

  // ==================== ATTENDANCE CLAIMS ====================

  /**
   * POST /attendance/claims
   */
  submitClaim = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = await this.resolveEmployeeId(req);
    if (!employeeId) throw new ApiError(400, 'Employee ID is required');

    const { date, claimType, checkIn, checkOut, overtimeHours, reason } = req.body;

    const claim = await prisma.hrAttendanceClaim.create({
      data: {
        employee_id: employeeId,
        date,
        claim_type: claimType,
        check_in: checkIn || null,
        check_out: checkOut || null,
        overtime_hours: overtimeHours !== undefined ? Number(overtimeHours) : null,
        reason,
        status: 'PENDING',
      },
      include: { employee: true },
    });

    await HrAuditService.log({
      entityType: 'attendance',
      entityId: claim.id.toString(),
      eventType: 'ATTENDANCE_CLAIM_SUBMITTED',
      performedBy: claim.employee?.name || 'Employee',
      notes: `Claim for ${claimType} on ${date}: ${reason}`,
    });

    res.status(201).json({
      success: true,
      message: 'Attendance regularization claim submitted',
      data: {
        id: Number(claim.id),
        employeeId: claim.employee_id,
        date: claim.date,
        claimType: claim.claim_type,
        status: claim.status,
      },
    });
  });

  /**
   * POST /attendance/claims/admin-submit
   */
  adminSubmitClaim = asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, date, claimType, checkIn, checkOut, overtimeHours, reason } = req.body;
    if (!employeeId) throw new ApiError(400, 'Employee ID is required');

    const claim = await prisma.hrAttendanceClaim.create({
      data: {
        employee_id: employeeId,
        date,
        claim_type: claimType,
        check_in: checkIn || null,
        check_out: checkOut || null,
        overtime_hours: overtimeHours !== undefined ? Number(overtimeHours) : null,
        reason,
        status: 'PENDING',
      },
      include: { employee: true },
    });

    res.status(201).json({
      success: true,
      message: 'Attendance claim created by admin',
      data: {
        id: Number(claim.id),
        employeeId: claim.employee_id,
        date: claim.date,
        claimType: claim.claim_type,
        status: claim.status,
      },
    });
  });

  /**
   * GET /attendance/claims/my
   */
  getMyClaims = asyncHandler(async (req: Request, res: Response) => {
    const employeeId = await this.resolveEmployeeId(req);
    if (!employeeId) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const claims = await prisma.hrAttendanceClaim.findMany({
      where: { employee_id: employeeId },
      orderBy: { created_at: 'desc' },
      include: { employee: true },
    });

    res.json({
      success: true,
      data: claims.map((c: any) => ({
        id: Number(c.id),
        employeeId: c.employee_id,
        employeeName: c.employee?.name || null,
        date: c.date,
        claimType: c.claim_type,
        checkIn: c.check_in,
        checkOut: c.check_out,
        overtimeHours: c.overtime_hours ? Number(c.overtime_hours) : null,
        reason: c.reason,
        status: c.status,
        reviewedBy: c.reviewed_by,
        reviewNote: c.review_note,
        reviewedAt: c.reviewed_at?.toISOString() || null,
        createdAt: c.created_at?.toISOString(),
      })),
    });
  });

  /**
   * GET /attendance/claims
   */
  getAllClaims = asyncHandler(async (req: Request, res: Response) => {
    const { status, claimType } = req.query as any;
    const where: any = {};
    if (status && status !== 'all') where.status = status;
    if (claimType && claimType !== 'all') where.claim_type = claimType;

    const claims = await prisma.hrAttendanceClaim.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: { employee: true },
    });

    res.json({
      success: true,
      data: claims.map((c: any) => ({
        id: Number(c.id),
        employeeId: c.employee_id,
        employeeName: c.employee?.name || null,
        date: c.date,
        claimType: c.claim_type,
        checkIn: c.check_in,
        checkOut: c.check_out,
        overtimeHours: c.overtime_hours ? Number(c.overtime_hours) : null,
        reason: c.reason,
        status: c.status,
        reviewedBy: c.reviewed_by,
        reviewNote: c.review_note,
        reviewedAt: c.reviewed_at?.toISOString() || null,
        createdAt: c.created_at?.toISOString(),
      })),
    });
  });

  /**
   * PATCH /attendance/claims/:id/approve
   */
  approveClaim = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { reviewNote } = req.body;
    const approverName = (req as any).user?.name || 'Admin';

    const claim = await prisma.hrAttendanceClaim.findUnique({ where: { id } });
    if (!claim) throw new ApiError(404, 'Attendance claim not found');

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update claim status
      const updatedClaim = await tx.hrAttendanceClaim.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewed_by: approverName,
          review_note: reviewNote || null,
          reviewed_at: new Date(),
        },
      });

      // 2. Reflect regularization in Attendance table
      const hours = this.calculateHours(claim.check_in, claim.check_out);
      const otHours = claim.overtime_hours ? Number(claim.overtime_hours) : (hours > 9 ? Number((hours - 9).toFixed(2)) : 0);

      await tx.hrAttendance.upsert({
        where: {
          employee_id_date: {
            employee_id: claim.employee_id,
            date: claim.date,
          },
        },
        create: {
          employee_id: claim.employee_id,
          date: claim.date,
          check_in: claim.check_in,
          check_out: claim.check_out,
          status: 'present',
          working_hours: hours > 0 ? hours : 9,
          overtime: otHours,
          notes: `Regularized via claim #${claim.id}: ${claim.reason}`,
        },
        update: {
          check_in: claim.check_in || undefined,
          check_out: claim.check_out || undefined,
          status: 'present',
          working_hours: hours > 0 ? hours : undefined,
          overtime: otHours > 0 ? otHours : undefined,
          notes: `Regularized via claim #${claim.id}: ${claim.reason}`,
        },
      });

      await HrAuditService.log(
        {
          entityType: 'attendance',
          entityId: claim.id.toString(),
          eventType: 'ATTENDANCE_CLAIM_APPROVED',
          performedBy: approverName,
          notes: `Approved claim for ${claim.employee_id} on ${claim.date}`,
        },
        tx
      );

      return updatedClaim;
    });

    res.json({
      success: true,
      message: 'Claim approved and attendance regularized successfully',
      data: {
        id: Number(result.id),
        status: result.status,
        reviewedBy: result.reviewed_by,
      },
    });
  });

  /**
   * PATCH /attendance/claims/:id/reject
   */
  rejectClaim = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { reviewNote } = req.body;
    const reviewerName = (req as any).user?.name || 'Admin';

    const claim = await prisma.hrAttendanceClaim.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewed_by: reviewerName,
        review_note: reviewNote || null,
        reviewed_at: new Date(),
      },
    });

    await HrAuditService.log({
      entityType: 'attendance',
      entityId: claim.id.toString(),
      eventType: 'ATTENDANCE_CLAIM_REJECTED',
      performedBy: reviewerName,
      notes: `Rejected claim #${claim.id}: ${reviewNote || 'No reason specified'}`,
    });

    res.json({
      success: true,
      message: 'Claim rejected',
      data: {
        id: Number(claim.id),
        status: claim.status,
      },
    });
  });

  /**
   * PATCH /attendance/claims/:id/edit-review
   */
  editReviewClaim = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { status, reviewNote } = req.body;
    const reviewerName = (req as any).user?.name || 'Admin';

    const claim = await prisma.hrAttendanceClaim.update({
      where: { id },
      data: {
        status: status || undefined,
        review_note: reviewNote !== undefined ? reviewNote : undefined,
        reviewed_by: reviewerName,
        reviewed_at: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Claim review updated',
      data: {
        id: Number(claim.id),
        status: claim.status,
      },
    });
  });
}

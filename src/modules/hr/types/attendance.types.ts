export interface AttendanceRecordResponse {
  id: number;
  employeeId: string;
  employeeName?: string | null;
  empCode?: string | null;
  departmentName?: string | null;
  date: string; // YYYY-MM-DD
  shiftId?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  status: string; // present, absent, half-day, leave
  workingHours: number;
  overtime: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceConfigResponse {
  id?: string;
  fullDayHours: number;
  halfDayMinHours: number;
  lateGraceMinutes: number;
}

export interface AttendanceClaimResponse {
  id: number;
  employeeId: string;
  employeeName?: string | null;
  date: string;
  claimType: 'PUNCH_MIS' | 'OVERTIME' | 'WEEKEND_PRESENT' | string;
  checkIn?: string | null;
  checkOut?: string | null;
  overtimeHours?: number | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyAttendanceSummaryResponse {
  employeeId: string;
  name: string;
  empCode?: string | null;
  department?: string | null;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  totalWorkingHours: number;
  totalOvertimeHours: number;
}

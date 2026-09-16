export interface SalaryStructureResponse {
  id?: number;
  employeeId?: string;
  basicPercent: number;
  hraPercent: number;
  conveyancePercent: number;
  medicalPercent: number;
  specialAllowancePercent: number;
  deductions?: any[];
}

export interface PayrollRecordResponse {
  employeeId: string;
  name: string;
  empCode?: string | null;
  designation?: string | null;
  department?: string | null;
  monthlySalary: number;
  workingDays: number;
  presentDays: number;
  leaveDays: number;
  absentDays: number;
  overtimeHours: number;
  overtimePay: number;
  grossSalary: number;
  loanDeduction: number;
  pfDeduction: number;
  esicDeduction: number;
  netSalary: number;
  isSalaryOnHold: boolean;
  holdReason?: string | null;
  payslipId?: number | null;
  payslipStatus?: 'pending' | 'paid';
}

export interface PayrollOverviewResponse {
  month: number;
  year: number;
  totalEmployees: number;
  totalGrossPayroll: number;
  totalNetPayroll: number;
  totalDeductions: number;
  records: PayrollRecordResponse[];
}

export interface PayslipResponse {
  id: number;
  employeeId: string;
  month: number;
  year: number;
  totalWorkingDays: number;
  presentDays: number;
  leaveDays: number;
  overtimeHours: number;
  overtimePay: number;
  grossSalary: number;
  totalDeductions: number;
  loanDeduction: number;
  netSalary: number;
  status: string;
  paidDate?: string | null;
  createdAt: string;
}

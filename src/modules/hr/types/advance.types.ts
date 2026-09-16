export interface AdvanceRequestResponse {
  id: number;
  employeeId: string;
  employeeName: string;
  empCode?: string | null;
  departmentName?: string | null;
  requestAmount: number;
  monthlyDeduction: number;
  noOfMonths: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | string;
  remarks?: string | null;
  approvedAmount?: number | null;
  approvedMonthlyDeduction?: number | null;
  approvedNoOfMonths?: number | null;
  requestDate: string;
  approvedDate?: string | null;
  startDeductionMonth?: string | null;
  loanId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdvanceDashboardStatsResponse {
  totalRequested: number;
  totalApproved: number;
  pendingCount: number;
  activeLoansCount: number;
  totalOutstandingBalance: number;
}

export interface LoanHistoryResponse {
  loanId: string;
  employeeId: string;
  amount: number;
  emiAmount: number;
  outstandingBalance: number;
  status: string;
  startDate: string;
  deductions: {
    month: number;
    year: number;
    deductionAmount: number;
    balanceAfter: number;
    date: string;
  }[];
}

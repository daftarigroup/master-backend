export type LeavingStep = 'on_notice' | 'exit_interview' | 'left' | 'completed';

export interface AssetReturnItem {
  key: string;
  label: string;
  checked: boolean;
  returnedAt?: string;
  remarks?: string;
}

export interface LeavingEmployeeResponse {
  id: number;
  employeeId: string;
  empCode?: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  department: { id: string; name: string } | null;
  status: string;
  resignationDate: string | null;
  terminationDate: string | null;
  separationType: string | null;
  lastWorkingDay: string | null;
  leavingReason: string | null;
  exitChecklist: Record<string, any> | null;
  advancePaymentTaken: boolean;
  advancePaymentAmount: number | null;
  advancePaymentSettled: boolean;
  experienceLetterIssued: boolean;
  userAccount: { id: string; active: boolean } | null;
  loans: {
    id: string;
    amount: number;
    outstandingBalance: number;
    purpose: string | null;
    status: string;
  }[];
  createdAt: string;
}

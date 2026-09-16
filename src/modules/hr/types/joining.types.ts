export interface OnboardingEmployeeResponse {
  id: number;
  employeeId: string;
  empCode?: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  status: string;
  joiningDate: string | null;
  offerLetterIssued: boolean;
  idCardIssued: boolean;
  inductionDone: boolean;
  onboardingChecklist: Record<string, boolean>;
  customChecklistItems: { key: string; label: string }[];
}

export interface ChecklistConfigDto {
  disabledStandardKeys: string[];
  globalCustomItems: { key: string; label: string }[];
}

export interface BulkImportRowDto {
  row: number;
  name: string;
  phone: string;
  email?: string;
  empCode?: string;
  designation?: string;
  department?: string;
  joiningDate?: string;
  workLocation?: string;
  managerName?: string;
  bloodGroup?: string;
  bankAccount?: string;
  ifscCode?: string;
  monthlySalary?: number;
  confirmAccountLinkOverwrite?: boolean;
}

export interface AccountLinkFieldDiff {
  field: string;
  currentValue: string | null;
  importValue: string | null;
}

export interface BulkImportResultDto {
  created: { row: number; employeeId: string; empCode: string | null; name: string }[];
  errors: { row: number; error: string }[];
  pendingLinkConfirmations: {
    row: number;
    name: string;
    phone: string;
    user: { id: string; name: string | null; email: string | null };
    diffs: AccountLinkFieldDiff[];
  }[];
}

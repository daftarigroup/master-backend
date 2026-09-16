export interface LeaveDayEntry {
  date: string; // YYYY-MM-DD
  type: 'full' | 'half';
  half?: 'first' | 'second';
  decision?: 'approved' | 'rejected';
}

export interface TaskTransferDecision {
  taskId: string;
  action: 'transfer' | 'skip';
  newDoerId?: string;
  newDoerName?: string;
}

export interface TaskImpactItem {
  taskId: string;
  title: string;
  taskType: 'checklist' | 'delegation';
  plannedDate: string;
  currentDoerName?: string;
  suggestedBackupName?: string;
}

export interface TaskImpactResponse {
  status: 'no_impact' | 'needs_decision';
  totalTasks: number;
  items: TaskImpactItem[];
}

export interface LeaveResponse {
  id: number;
  employeeId: string;
  employeeName: string;
  departmentId?: string | null;
  departmentName?: string | null;
  hodId?: string | null;
  hodName: string;
  substitute: string;
  leaveType?: string | null;
  fromDate: string;
  toDate: string;
  days?: number | null;
  leaveDays?: LeaveDayEntry[] | null;
  reason: string;
  status: string; // pending, approved, rejected
  submittedBy?: string | null;
  approvedBy?: string | null;
  approvedDate?: string | null;
  remarks?: string | null;
  taskTransferStatus?: string | null;
  createdAt: string;
  updatedAt: string;
}

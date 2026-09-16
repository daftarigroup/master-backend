export type ProjectAssignmentStatus = 'active' | 'on_leave' | 'shifted' | 'removed' | 'completed';

export type ProjectAssignmentEventType =
  | 'assigned'
  | 'resumed'
  | 'shifted'
  | 'removed'
  | 'completed'
  | 'put_on_leave';

export interface CreateAssignmentDTO {
  employee_id: string;
  firm_id: number | string;
  firm_name?: string;
  role_on_project: string;
  assigned_date?: string;
  reason?: string;
  approved_by?: string;
}

export interface ShiftAssignmentDTO {
  to_firm_id: number | string;
  to_firm_name?: string;
  role_on_project?: string;
  shift_date?: string;
  reason?: string;
  approved_by?: string;
}

export interface LeaveAssignmentDTO {
  reason?: string;
  effective_date?: string;
}

export interface ResumeAssignmentDTO {
  reason?: string;
  effective_date?: string;
}

export interface RemoveAssignmentDTO {
  reason?: string;
  effective_date?: string;
}

export interface CompleteAssignmentDTO {
  reason?: string;
  effective_date?: string;
}

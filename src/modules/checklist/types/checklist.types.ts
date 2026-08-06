export type Frequency =
  | 'daily'
  | 'alternate-day'
  | 'weekly'
  | 'fortnight'
  | 'monthly'
  | 'quarterly'
  | 'half-yearly'
  | 'yearly'
  | 'end-of-1st-week'
  | 'end-of-2nd-week'
  | 'end-of-3rd-week'
  | 'end-of-4rth-week'
  | 'one-time';

export type TaskStatusValue = 'pending' | 'done' | 'extend' | 'extended' | 'approved' | 'rejected';

export interface AssignTaskBody {
  firm_id: number;
  firm_name?: string | null;
  doer_id: number;
  doer_name?: string | null;
  given_by_id?: number | null;
  given_by_name?: string | null;
  task_description: string;
  frequency: Frequency;
  task_start_date: string;
  duration?: string | null;
  require_attachment?: boolean;
  enable_reminder?: boolean;
  reminder_days_before?: number;
  instruction_attachment_url?: string | null;
  instruction_attachment_type?: string | null;
  remark?: string | null;
}

export interface SubmitTaskBody {
  image?: string | null;
  audio_url?: string | null;
  remark?: string | null;
}

export interface DelegationSubmitBody {
  status: 'done' | 'extend';
  image?: string | null;
  audio_url?: string | null;
  remark?: string | null;
  next_extend_date?: string | null;
  reason?: string | null;
}

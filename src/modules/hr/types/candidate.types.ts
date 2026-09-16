export type CandidateStage =
  | 'pending'
  | 'shortlisted'
  | 'interview_scheduled'
  | 'interviewed'
  | 'selected'
  | 'joining_initiated'
  | 'joined'
  | 'rejected';

export interface CandidateDocEntry {
  verified: boolean;
  docUrl?: string;
  docNumber?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  notes?: string;
}

export interface CandidateCallLog {
  id: string;
  date: string;
  status: string;
  notes?: string;
  loggedBy?: string;
  createdAt: string;
}

export interface CandidateResponse {
  id: string;
  candidateEnquiryNo: string;
  candidateName: string;
  dob?: string | null;
  phoneNo: string;
  email?: string | null;
  previousCompany?: string | null;
  experience?: string | null;
  previousPosition?: string | null;
  maritalStatus?: string | null;
  aadharNo?: string | null;
  lastSalary?: string | null;
  reasonForLeaving?: string | null;
  currentAddress?: string | null;
  photo?: string | null;
  resume?: string | null;
  status: string;
  indentId?: string | null;
  notes?: string | null;
  nextCallDate?: string | null;
  followUpNotes?: string | null;
  callLogs?: CandidateCallLog[];
  documents?: Record<string, CandidateDocEntry>;
  createdAt: string;
  updatedAt: string;
  joining?: any | null;
  employee?: any | null;
}

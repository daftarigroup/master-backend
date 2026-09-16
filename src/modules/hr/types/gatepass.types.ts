export interface GatePassSecurityLog {
  timestamp: string;
  action: string;
  status: string;
  performedBy?: string;
  notes?: string;
}

export interface GatePassResponse {
  id: number;
  employee: string;
  employeeId: string;
  empCode?: string | null;
  department?: string | null;
  type: 'Personal' | 'Official' | string;
  placeToVisit: string;
  reason: string;
  date: string;
  departureTime: string;
  expectedArrival: string;
  outTime?: string | null;
  inTime?: string | null;
  status: 'open' | 'out' | 'closed' | 'rejected' | 'pending' | string;
  approvedBy?: string | null;
  whatsappNo?: string | null;
  attachment?: string | null;
  securityLogs?: GatePassSecurityLog[];
  createdAt: string;
  updatedAt: string;
}

export interface GatePassStatsResponse {
  total: number;
  issued: number;
  currentlyOut: number;
  returned: number;
  pending: number;
}

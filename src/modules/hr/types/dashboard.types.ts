export interface HrDashboardStatsResponse {
  totalEmployees: number;
  activeEmployees: number;
  presentToday: number;
  onLeaveToday: number;
  openIndents: number;
  activeCandidates: number;
  pendingLeaves: number;
  pendingAdvances: number;
  todayGatePasses: number;
  upcomingBirthdays: { name: string; date: string; department?: string }[];
  workAnniversaries: { name: string; years: number; date: string; department?: string }[];
  funnelCounts?: Record<string, number>;
  departmentBreakdown?: { department: string; count: number }[];
}

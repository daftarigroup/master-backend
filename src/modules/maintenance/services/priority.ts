import { Priority } from '@prisma/client';

// The frontend's numeric `priority: number` field was mapped inconsistently across
// three different files (plansApi.ts: High=3; unique_task's edit options: 1=Low..4=
// Critical; dashboardApi.ts: 1=Critical..4=Low, reversed). This backend is now the
// single source of truth: ascending severity, 1=LOW .. 4=CRITICAL, matching the
// most complete of the three (unique_task's EDIT_PRIORITY_OPTIONS).
const NUMBER_TO_PRIORITY: Record<number, Priority> = { 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH', 4: 'CRITICAL' };
const PRIORITY_TO_NUMBER: Record<Priority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export function priorityFromNumber(n: number | null | undefined, fallback: Priority = 'MEDIUM'): Priority {
  if (n === null || n === undefined) return fallback;
  return NUMBER_TO_PRIORITY[n] ?? fallback;
}

export function priorityToNumber(p: Priority): number {
  return PRIORITY_TO_NUMBER[p] ?? 2;
}

// Derived status for many machines: loads the facts once and runs the ONE status function (cost/utilization.ts deriveStatus).
// Used by Assignment Status and Maintenance Records, so a pill means the same thing on every screen.
import { prisma } from '../../../database/prisma';
import { loadStatusFacts } from '../cost/costQueries';
import { DerivedStatus, deriveStatus } from '../cost/utilization';
import { toIstDateString } from '../lib/istDate';
import { loadOpsSettings } from '../lib/opsSettings';

export interface StatusMachine {
  id: string;
  firmId: bigint | null;
  status: 'OPERATIONAL' | 'UNDER_MAINTENANCE' | 'BREAKDOWN' | 'IDLE' | 'DECOMMISSIONED';
  asset?: { status: 'ACTIVE' | 'INACTIVE' | 'UNDER_REPAIR' | 'DISPOSED' } | null;
}

export async function statusesFor(machines: StatusMachine[], today = toIstDateString(new Date())): Promise<{ status: Map<string, DerivedStatus>; facts: Awaited<ReturnType<typeof loadStatusFacts>> }> {
  const [facts, settings] = await Promise.all([
    loadStatusFacts(machines.map((m) => m.id)),
    loadOpsSettings(prisma, machines.map((m) => m.firmId).filter((f): f is bigint => f !== null)),
  ]);
  const status = new Map<string, DerivedStatus>();
  for (const m of machines) {
    status.set(
      m.id,
      deriveStatus({
        machineStatus: m.status,
        assetStatus: m.asset?.status ?? null,
        hasOpenBreakdownOrRepair: facts.openOrders.has(m.id),
        lastActivityDate: facts.lastActivity.get(m.id) ?? null,
        today,
        idleAfterDays: m.firmId === null ? 2 : (settings.get(String(m.firmId))?.idleAfterDays ?? 2),
        hasActiveAssignment: facts.assigned.has(m.id),
        inTransit: facts.inTransit.has(m.id),
      }),
    );
  }
  return { status, facts };
}

// The ONE place maintenance cost enters the cost engine. The later Maintenance/Repair redesign swaps the source by calling
// setMaintenanceCostProvider(); nothing else in the engine reads work orders.
//
// Default source: MaintenanceWorkOrder.cost. A work order counts once, when it is finished and billed:
//   - in-house work: COMPLETED / COMPLETED_LATE, dated by completedAt
//   - out-sourced work: only once it is back from the vendor (RECEIVED / PAID), dated by receivedAt. Until then its cost is an
//     estimate, and counting it then and again at the final bill was the double count.
// The legacy repair tables (RepairIndent etc.) are never read: they are a second, deprecated cost source.
import { prisma } from '../../../database/prisma';
import { D } from './decimal';
import { istDayStart, istNextDayStart, toIstDateString } from '../lib/istDate';
import { Iso, Period } from './period';
import { MaintenanceRow } from './types';

export interface MaintenanceCostQuery {
  machineIds: string[];
  period: Period;
}

export interface MaintenanceCostProvider {
  /** Cost rows per machine id, each work order at most once. */
  costsForMachines(query: MaintenanceCostQuery): Promise<Map<string, MaintenanceRow[]>>;
}

export const workOrderCostProvider: MaintenanceCostProvider = {
  async costsForMachines({ machineIds, period }) {
    const out = new Map<string, MaintenanceRow[]>();
    if (machineIds.length === 0) return out;

    const range = { gte: istDayStart(period.from), lt: istNextDayStart(period.to) };
    const rows = await prisma.maintenanceWorkOrder.findMany({
      where: {
        machineId: { in: machineIds },
        cost: { not: null },
        status: { in: ['COMPLETED', 'COMPLETED_LATE'] },
        OR: [
          { outsourceStatus: null, completedAt: range },
          { outsourceStatus: { in: ['RECEIVED', 'PAID'] }, receivedAt: range },
        ],
      },
      select: { id: true, machineId: true, cost: true, completedAt: true, receivedAt: true, outsourceStatus: true },
    });

    for (const r of rows) {
      const when = r.outsourceStatus ? r.receivedAt : r.completedAt;
      if (!when || r.cost === null) continue;
      const list = out.get(r.machineId) ?? [];
      list.push({ workOrderId: r.id, date: toIstDateString(when) as Iso, amount: D(r.cost) });
      out.set(r.machineId, list);
    }
    return out;
  },
};

let current: MaintenanceCostProvider = workOrderCostProvider;

export const getMaintenanceCostProvider = (): MaintenanceCostProvider => current;
export function setMaintenanceCostProvider(provider: MaintenanceCostProvider): void {
  current = provider;
}

import { prisma } from '../../../database/prisma';
import { UserAuthContext } from '../../../utils/currentUser';
import { firmWhere } from '../../../utils/firmScope';
import { fleetConfig } from '../config';
import { computeEfficiency } from '../lib/efficiency';
import { num, scopeOf } from './common';

export const efficiencyService = {
  /**
   * Litres per hour / per km for each machine over a period: total litres / total COMPLETE usage
   * (open entries are excluded and counted). A machine whose rate is more than the configured percentage
   * away from its expected rate is flagged.
   */
  async list(ctx: UserAuthContext, q: { firmId?: unknown; from: string; to: string; machineId?: string }) {
    const scopeWhere = firmWhere(scopeOf(ctx, q.firmId));
    const range = { gte: new Date(q.from), lte: new Date(q.to) };
    const machineFilter = q.machineId ? { machineId: q.machineId } : {};

    const [diesel, usage] = await Promise.all([
      prisma.dieselLog.groupBy({
        by: ['machineId'],
        where: { ...scopeWhere, ...machineFilter, machineId: q.machineId ?? { not: null }, voidedAt: null, issueDate: range },
        _sum: { litres: true },
      }),
      prisma.machineUsageLog.findMany({
        where: { ...scopeWhere, ...machineFilter, voidedAt: null, status: { not: 'REJECTED' }, logDate: range },
        select: { machineId: true, usage: true },
      }),
    ]);

    const litresBy = new Map(diesel.map((d) => [d.machineId as string, Number(d._sum.litres ?? 0)]));
    const usageBy = new Map<string, Array<number | null>>();
    for (const u of usage) {
      const list = usageBy.get(u.machineId) ?? [];
      list.push(u.usage === null ? null : Number(u.usage));
      usageBy.set(u.machineId, list);
    }

    const ids = [...new Set([...litresBy.keys(), ...usageBy.keys()])];
    const machines = await prisma.machine.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, readingUnit: true, ownershipType: true, expectedConsumption: true },
    });

    return machines
      .map((m) => ({
        ...computeEfficiency(
          { machineId: m.id, litres: litresBy.get(m.id) ?? 0, usages: usageBy.get(m.id) ?? [], expectedConsumption: num(m.expectedConsumption) },
          fleetConfig.efficiencyDeviationPct,
        ),
        machineName: m.name,
        readingUnit: m.readingUnit,
        ownershipType: m.ownershipType,
      }))
      .sort((a, b) => Number(b.flagged) - Number(a.flagged) || a.machineName.localeCompare(b.machineName));
  },
};

import { prisma } from '../../../database/prisma';
import { UserAuthContext } from '../../../utils/currentUser';
import { firmWhere } from '../../../utils/firmScope';
import { fleetConfig } from '../config';
import { scopeOf } from './common';

export const alertsService = {
  /**
   * What needs attention: flagged usage entries from the last 30 days, diesel issues from the Store with a doubtful meter reading
   * (last 30 days), and open entries that have been left open for more than a day. (The old negative tank balance alert is gone
   * with the tank.)
   */
  async get(ctx: UserAuthContext, q: { firmId?: unknown }) {
    const scope = scopeOf(ctx, q.firmId);
    const scoped = firmWhere(scope);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const staleBefore = new Date(Date.now() - fleetConfig.staleOpenEntryMs);
    const [flaggedEntries, flaggedList, staleOpen, flaggedDiesel] = await Promise.all([
      prisma.machineUsageLog.count({ where: { ...scoped, voidedAt: null, isFlagged: true, startedAt: { gte: since } } }),
      prisma.machineUsageLog.findMany({
        where: { ...scoped, voidedAt: null, isFlagged: true, startedAt: { gte: since } },
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: { id: true, machineId: true, machine: { select: { id: true, name: true } } },
      }),
      prisma.machineUsageLog.findMany({
        where: { ...scoped, voidedAt: null, stopReading: null, startedAt: { lt: staleBefore } },
        orderBy: { startedAt: 'asc' },
        take: 50,
        include: { machine: { select: { name: true } } },
      }),
      prisma.dieselLog.findMany({
        where: { ...scoped, voidedAt: null, NOT: { flags: { isEmpty: true } }, issuedAt: { gte: since } },
        orderBy: { issuedAt: 'desc' },
        take: 20,
        select: { id: true, litres: true, meterReading: true, flags: true, issueDate: true, machine: { select: { id: true, name: true } } },
      }),
    ]);

    return {
      flaggedEntries,
      flaggedDiesel: flaggedDiesel.map((d) => ({
        id: d.id,
        machineId: d.machine?.id ?? null,
        machineName: d.machine?.name ?? null,
        date: d.issueDate.toISOString().slice(0, 10),
        litres: Number(d.litres),
        meterReading: d.meterReading === null ? null : Number(d.meterReading),
        flags: d.flags,
      })),
      flaggedList: flaggedList.map((e) => ({
        id: e.id,
        machineId: e.machineId,
        machineName: e.machine.name,
      })),
      staleOpenEntries: staleOpen.map((e) => ({
        id: e.id,
        machineId: e.machineId,
        machineName: e.machine.name,
        startedAt: e.startedAt.toISOString(),
        startReading: Number(e.startReading),
      })),
    };
  },
};

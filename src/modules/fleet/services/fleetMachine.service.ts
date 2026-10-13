import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { UserAuthContext } from '../../../utils/currentUser';
import { fleetConfig } from '../config';
import { computeEfficiency } from '../lib/efficiency';
import { toIstDateString } from '../lib/istDate';
import { currentReadingFor, currentReadings } from '../lib/currentReading';
import { machineAccessWhere } from '../lib/machineAccess';
import { round2, totalRun } from '../lib/usageRules';
import { loadMachineInScope, num, scopeOf } from './common';
import { mapUsage } from './usageLog.service';

export const fleetMachineService = {
  /** Machine picker for Daily Entry: who can be logged against, with the reading to prefill. */
  async list(ctx: UserAuthContext, q: { firmId?: unknown; ownership?: 'OWNED' | 'RENTED'; q?: string }) {
    const now = new Date();
    const where: Prisma.MachineWhereInput = {
      AND: [
        await machineAccessWhere(ctx, q.firmId),
        ...(q.q
          ? [
              {
                OR: [
                  { name: { contains: q.q, mode: 'insensitive' as const } },
                  { registrationNo: { contains: q.q, mode: 'insensitive' as const } },
                  { assetCode: { contains: q.q, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
      isActive: true,
      status: { not: 'DECOMMISSIONED' },
      // a hire that has ended drops out of the pickers
      OR: [{ rentalEndAt: null }, { rentalEndAt: { gt: now } }],
      ...(q.ownership ? { ownershipType: q.ownership } : {}),
    };
    const machines = await prisma.machine.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        firm: { select: { id: true, firm_name: true } },
        assignments: {
          where: { endedAt: null },
          take: 1,
          select: { id: true, firmId: true, firm: { select: { id: true, firm_name: true } } },
        },
      },
      take: 500,
    });
    const ids = machines.map((m) => m.id);

    const [openEntries] = await Promise.all([
      prisma.machineUsageLog.findMany({
        where: { machineId: { in: ids }, voidedAt: null, status: { not: 'REJECTED' }, stopReading: null },
        select: { id: true, machineId: true, startReading: true, startedAt: true },
      }),
    ]);
    const readingBy = await currentReadings(prisma, machines);
    const openBy = new Map(openEntries.map((r) => [r.machineId, r]));

    return machines.map((m) => {
      const open = openBy.get(m.id);
      const activeAssignment = m.assignments?.[0] ?? null;
      return {
        id: m.id,
        name: m.name,
        assetCode: m.assetCode,
        registrationNo: m.registrationNo,
        firmId: m.firmId ? String(m.firmId) : null,
        firmName: m.firm?.firm_name ?? null,
        assignment: activeAssignment
          ? {
              id: String(activeAssignment.id),
              firmId: String(activeAssignment.firmId),
              firmName: activeAssignment.firm?.firm_name ?? null,
            }
          : null,
        ownershipType: m.ownershipType,
        equipmentType: m.equipmentType,
        readingUnit: m.readingUnit,
        hireType: m.hireType,
        expectedConsumption: num(m.expectedConsumption),
        lastStop: readingBy.get(m.id) ?? null,
        openEntry: open ? { id: open.id, startReading: num(open.startReading), startedAt: open.startedAt.toISOString() } : null,
      };
    });
  },

  async lastReading(ctx: UserAuthContext, machineId: string) {
    const machine = await loadMachineInScope(prisma, ctx, machineId);
    const [last, open] = await Promise.all([
      prisma.machineUsageLog.findFirst({
        where: { machineId, voidedAt: null, status: { not: 'REJECTED' }, stopReading: { not: null } },
        orderBy: { startedAt: 'desc' },
        select: { stoppedAt: true },
      }),
      prisma.machineUsageLog.findFirst({
        where: { machineId, voidedAt: null, status: { not: 'REJECTED' }, stopReading: null },
        select: { id: true, startReading: true, startedAt: true },
      }),
    ]);
    return {
      readingUnit: machine.readingUnit,
      lastStop: await currentReadingFor(prisma, machine),
      lastStoppedAt: last?.stoppedAt?.toISOString() ?? null,
      openEntry: open ? { id: open.id, startReading: num(open.startReading), startedAt: open.startedAt.toISOString() } : null,
    };
  },

  /** Per-machine logbook: usage and diesel history, total run, efficiency, flagged entries, legacy logs. */
  async history(ctx: UserAuthContext, machineId: string, q: { from?: string; to?: string }) {
    const machine = await loadMachineInScope(prisma, ctx, machineId);
    const to = q.to ? new Date(q.to) : new Date(toIstDateString(new Date()));
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
    const range = { gte: from, lte: to };

    const [usage, diesel, allTimeUsage, legacy] = await Promise.all([
      prisma.machineUsageLog.findMany({
        where: { machineId, voidedAt: null, status: { not: 'REJECTED' }, logDate: range },
        orderBy: { startedAt: 'desc' },
        include: { machine: { select: { name: true, readingUnit: true } }, operator: { select: { name: true, user_name: true } } },
      }),
      prisma.dieselLog.findMany({ where: { machineId, voidedAt: null, issueDate: range }, orderBy: { issuedAt: 'desc' } }),
      prisma.machineUsageLog.aggregate({ where: { machineId, voidedAt: null, status: { not: 'REJECTED' }, stopReading: { not: null } }, _sum: { usage: true } }),
      prisma.dailyMachineLog.findMany({ where: { machineId }, orderBy: { date: 'desc' }, take: 100 }),
    ]);

    const litres = diesel.reduce((a, d) => a + Number(d.litres), 0);
    const efficiency = computeEfficiency(
      { machineId, litres, usages: usage.map((u) => (u.usage === null ? null : Number(u.usage))), expectedConsumption: num(machine.expectedConsumption) },
      fleetConfig.efficiencyDeviationPct,
    );

    return {
      machine: {
        id: machine.id,
        name: machine.name,
        ownershipType: machine.ownershipType,
        readingUnit: machine.readingUnit,
        openingReading: num(machine.openingReading),
        expectedConsumption: num(machine.expectedConsumption),
      },
      range: { from: toIstDateString(from), to: toIstDateString(to) },
      totalRun: totalRun(Number(machine.openingReading), [allTimeUsage._sum.usage === null ? null : Number(allTimeUsage._sum.usage)]),
      efficiency,
      usage: usage.map(mapUsage),
      flagged: usage.filter((u) => u.isFlagged).map(mapUsage),
      diesel: diesel.map((d) => ({
        id: d.id,
        issuedAt: d.issuedAt.toISOString(),
        litres: round2(Number(d.litres)),
        source: d.source,
        note: d.note,
        usageLogId: d.usageLogId,
        meterReading: d.meterReading === null ? null : Number(d.meterReading),
        flags: d.flags,
        fromStore: d.source === 'STORE_ISSUE',
      })),
      // the old DailyMachineLog rows, kept read-only (their hours are already inside openingReading)
      legacyLogs: legacy.map((l) => ({
        id: l.id,
        date: toIstDateString(l.date),
        runtimeHours: num(l.runtimeHours),
        operatorName: l.operatorName,
        remarks: l.remarks,
      })),
    };
  },
};

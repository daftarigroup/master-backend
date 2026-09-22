import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { dateToISO, dateToISODate, decimalToNumber, parsePagination, paginationMeta } from './mapUtils';

const INCLUDE = { machine: { select: { id: true, name: true, assetCode: true } } } satisfies Prisma.DailyMachineLogInclude;

function toDTO(row: any) {
  return {
    id: row.id,
    machineId: row.machineId,
    machineName: row.machine?.name ?? row.machineId,
    date: dateToISODate(row.date),
    startTimeReading: row.startTimeReading,
    endTimeReading: row.endTimeReading,
    runtimeHours: decimalToNumber(row.runtimeHours),
    temperature: decimalToNumber(row.temperature),
    load: decimalToNumber(row.load),
    operatorName: row.operatorName ?? '',
    remarks: row.remarks,
    createdAt: dateToISO(row.createdAt),
    tenant: null,
  };
}

export const dailyMachineLogService = {
  async list(query: Record<string, any>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.DailyMachineLogWhereInput = {
      ...(query.machineId ? { machineId: query.machineId } : {}),
      ...(query.date ? { date: new Date(query.date) } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.dailyMachineLog.findMany({ where, include: INCLUDE, orderBy: { date: 'desc' }, skip, take: limit }),
      prisma.dailyMachineLog.count({ where }),
    ]);
    return { data: rows.map(toDTO), pagination: paginationMeta(page, limit, total) };
  },

  async stats() {
    const grouped = await prisma.dailyMachineLog.groupBy({ by: ['machineId'], _sum: { runtimeHours: true } });
    const machines = await prisma.machine.findMany({ where: { id: { in: grouped.map((g) => g.machineId) } }, select: { id: true, name: true } });
    const nameById = new Map(machines.map((m) => [m.id, m.name]));
    return grouped.map((g) => ({ machineId: g.machineId, machineName: nameById.get(g.machineId) ?? g.machineId, totalHours: decimalToNumber(g._sum.runtimeHours) }));
  },

  async create(body: {
    machineId: string;
    date: string;
    startTimeReading?: string;
    endTimeReading?: string;
    runtimeHours: number;
    temperature: number;
    load: number;
    operatorName: string;
    remarks?: string;
  }) {
    const row = await prisma.dailyMachineLog.create({
      data: {
        machine: { connect: { id: body.machineId } },
        date: new Date(body.date),
        startTimeReading: body.startTimeReading ?? null,
        endTimeReading: body.endTimeReading ?? null,
        runtimeHours: body.runtimeHours,
        temperature: body.temperature,
        load: body.load,
        operatorName: body.operatorName,
        remarks: body.remarks ?? null,
      },
      include: INCLUDE,
    });

    // Running-hours meter feeds RUNNING_HOURS-frequency plans — keep Machine's
    // cumulative meter in sync so those triggers can be evaluated against it.
    await prisma.machine.update({ where: { id: body.machineId }, data: { runningHours: { increment: body.runtimeHours } } });

    return toDTO(row);
  },
};

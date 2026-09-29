import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { dateToISO, dateToISODate, decimalToNumber, parsePagination, paginationMeta } from './mapUtils';

const INCLUDE = {
  machine: { select: { id: true, name: true, assetCode: true, firmId: true } },
  firm: { select: { id: true, firm_name: true } },
} satisfies Prisma.DailyMachineLogInclude;

function toDTO(row: any) {
  const fId = row.firmId ?? row.machine?.firmId;
  return {
    id: row.id,
    firmId: fId ? String(fId) : undefined,
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
    machine: row.machine
      ? {
          id: row.machine.id,
          name: row.machine.name,
          assetCode: row.machine.assetCode,
          firmId: row.machine.firmId ? String(row.machine.firmId) : undefined,
        }
      : null,
  };
}

export const dailyMachineLogService = {
  async list(query: Record<string, any>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.DailyMachineLogWhereInput = {
      ...(query.machineId ? { machineId: query.machineId } : {}),
      ...(query.date ? { date: new Date(query.date) } : {}),
      ...(query.firmId ? { OR: [{ firmId: BigInt(query.firmId) }, { machine: { firmId: BigInt(query.firmId) } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.dailyMachineLog.findMany({ where, include: INCLUDE, orderBy: { date: 'desc' }, skip, take: limit }),
      prisma.dailyMachineLog.count({ where }),
    ]);
    return { data: rows.map(toDTO), pagination: paginationMeta(page, limit, total) };
  },

  async stats() {
    const grouped = await prisma.dailyMachineLog.groupBy({ by: ['machineId'], _sum: { runtimeHours: true } });
    const machines = await prisma.machine.findMany({ where: { id: { in: grouped.map((g) => g.machineId) } }, select: { id: true, name: true, firmId: true } });
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
    firmId?: string;
  }) {
    const machine = await prisma.machine.findUnique({ where: { id: body.machineId }, select: { firmId: true } });
    const targetFirmId = body.firmId ? BigInt(body.firmId) : machine?.firmId;

    const row = await prisma.dailyMachineLog.create({
      data: {
        machine: { connect: { id: body.machineId } },
        ...(targetFirmId ? { firm: { connect: { id: targetFirmId } } } : {}),
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

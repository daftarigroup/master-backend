import { ApiError } from '../../../utils/ApiError';
import { parseBigIntId, parseFirmId } from '../../../utils/firmScope';
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
      ...(parseFirmId(query.firmId) !== null ? { OR: [{ firmId: parseFirmId(query.firmId)! }, { machine: { firmId: parseFirmId(query.firmId)! } }] } : {}), // 'all' = no filter
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

  /** Read-only since the Work Logs release: nothing is written and Machine.runningHours is no longer incremented. */
  async create(_body: {
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
    throw new ApiError(410, 'The old daily machine log is read-only. Record machine usage in Work Logs instead.', ['LEGACY_DAILY_LOG_READ_ONLY']);
  },
};

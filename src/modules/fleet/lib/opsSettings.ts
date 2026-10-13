// Firm settings the work-log, service and assignment features read, with defaults for a firm that never saved any.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

export interface OpsSettings {
  firmId: bigint;
  dayShiftStartMin: number;
  dayShiftEndMin: number;
  blockWorkWhenServiceOverdue: boolean;
  countPendingLogsInTotals: boolean;
  serviceLeadPercent: number;
  serviceLeadDays: number;
  idleAfterDays: number;
  standardHoursPerDay: number;
}

export const OPS_DEFAULTS = {
  dayShiftStartMin: 360,
  dayShiftEndMin: 1080,
  blockWorkWhenServiceOverdue: false,
  countPendingLogsInTotals: true,
  serviceLeadPercent: 10,
  serviceLeadDays: 7,
  idleAfterDays: 2,
  standardHoursPerDay: 8,
} as const;

export async function loadOpsSettings(db: Db, firmIds: bigint[]): Promise<Map<string, OpsSettings>> {
  const ids = [...new Set(firmIds.map(String))].map((x) => BigInt(x));
  const rows = ids.length === 0 ? [] : await db.fleetSettings.findMany({ where: { firmId: { in: ids } } });
  const byFirm = new Map(rows.map((r) => [String(r.firmId), r]));
  return new Map(
    ids.map((firmId) => {
      const r = byFirm.get(String(firmId));
      return [
        String(firmId),
        {
          firmId,
          dayShiftStartMin: r?.dayShiftStartMin ?? OPS_DEFAULTS.dayShiftStartMin,
          dayShiftEndMin: r?.dayShiftEndMin ?? OPS_DEFAULTS.dayShiftEndMin,
          blockWorkWhenServiceOverdue: r?.blockWorkWhenServiceOverdue ?? OPS_DEFAULTS.blockWorkWhenServiceOverdue,
          countPendingLogsInTotals: r?.countPendingLogsInTotals ?? OPS_DEFAULTS.countPendingLogsInTotals,
          serviceLeadPercent: r?.serviceLeadPercent ?? OPS_DEFAULTS.serviceLeadPercent,
          serviceLeadDays: r?.serviceLeadDays ?? OPS_DEFAULTS.serviceLeadDays,
          idleAfterDays: r?.idleAfterDays ?? OPS_DEFAULTS.idleAfterDays,
          standardHoursPerDay: r ? Number(r.standardHoursPerDay) : OPS_DEFAULTS.standardHoursPerDay,
        },
      ];
    }),
  );
}

export async function opsSettingsFor(db: Db, firmId: bigint): Promise<OpsSettings> {
  return (await loadOpsSettings(db, [firmId])).get(String(firmId))!;
}

/** DAY / NIGHT from the start time (IST) and the firm's day-shift boundaries. */
export function shiftFor(startedAt: Date, s: Pick<OpsSettings, 'dayShiftStartMin' | 'dayShiftEndMin'>): 'DAY' | 'NIGHT' {
  const ist = new Date(startedAt.getTime() + 5.5 * 3_600_000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= s.dayShiftStartMin && minutes < s.dayShiftEndMin ? 'DAY' : 'NIGHT';
}

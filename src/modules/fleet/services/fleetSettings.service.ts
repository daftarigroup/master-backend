import { prisma } from '../../../database/prisma';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable, requireSingleFirm } from '../../../utils/firmScope';
import { num, requireUserId } from './common';

export interface SettingsBody {
  standardHoursPerDay?: number;
  idleAfterDays?: number;
  defaultDieselRate?: number | null;
  workingDays?: number[];
  dayShiftStartMin?: number;
  dayShiftEndMin?: number;
  blockWorkWhenServiceOverdue?: boolean;
  countPendingLogsInTotals?: boolean;
  serviceLeadPercent?: number;
  serviceLeadDays?: number;
  documentExpiryWindowDays?: number;
}

const DEFAULTS = { standardHoursPerDay: 8, idleAfterDays: 2, defaultDieselRate: null as number | null, workingDays: [1, 2, 3, 4, 5, 6] };

export const fleetSettingsService = {
  /** The firm's settings, or the defaults when it has none yet (a row is only created when someone saves). */
  async get(ctx: UserAuthContext, firmIdInput: unknown) {
    const firmId = requireSingleFirm(ctx, firmIdInput);
    const row = await prisma.fleetSettings.findUnique({ where: { firmId } });
    return {
      firmId: String(firmId),
      saved: Boolean(row),
      standardHoursPerDay: row ? Number(row.standardHoursPerDay) : DEFAULTS.standardHoursPerDay,
      idleAfterDays: row?.idleAfterDays ?? DEFAULTS.idleAfterDays,
      defaultDieselRate: row ? num(row.defaultDieselRate) : DEFAULTS.defaultDieselRate,
      workingDays: row?.workingDays ?? DEFAULTS.workingDays,
      // work logs and service (fleet_v3_ops)
      dayShiftStartMin: row?.dayShiftStartMin ?? 360,
      dayShiftEndMin: row?.dayShiftEndMin ?? 1080,
      blockWorkWhenServiceOverdue: row?.blockWorkWhenServiceOverdue ?? false,
      countPendingLogsInTotals: row?.countPendingLogsInTotals ?? true,
      serviceLeadPercent: row?.serviceLeadPercent ?? 10,
      serviceLeadDays: row?.serviceLeadDays ?? 7,
      documentExpiryWindowDays: row?.documentExpiryWindowDays ?? 30,
    };
  },

  async put(ctx: UserAuthContext, firmIdInput: unknown, body: SettingsBody) {
    const userId = requireUserId(ctx);
    const firmId = requireSingleFirm(ctx, firmIdInput);
    assertFirmWritable(ctx, firmId);
    const data = {
      ...(body.standardHoursPerDay !== undefined ? { standardHoursPerDay: body.standardHoursPerDay } : {}),
      ...(body.idleAfterDays !== undefined ? { idleAfterDays: body.idleAfterDays } : {}),
      ...(body.defaultDieselRate !== undefined ? { defaultDieselRate: body.defaultDieselRate } : {}),
      ...(body.workingDays !== undefined ? { workingDays: [...new Set(body.workingDays)].sort() } : {}),
      ...(body.dayShiftStartMin !== undefined ? { dayShiftStartMin: body.dayShiftStartMin } : {}),
      ...(body.dayShiftEndMin !== undefined ? { dayShiftEndMin: body.dayShiftEndMin } : {}),
      ...(body.blockWorkWhenServiceOverdue !== undefined ? { blockWorkWhenServiceOverdue: body.blockWorkWhenServiceOverdue } : {}),
      ...(body.countPendingLogsInTotals !== undefined ? { countPendingLogsInTotals: body.countPendingLogsInTotals } : {}),
      ...(body.serviceLeadPercent !== undefined ? { serviceLeadPercent: body.serviceLeadPercent } : {}),
      ...(body.serviceLeadDays !== undefined ? { serviceLeadDays: body.serviceLeadDays } : {}),
      ...(body.documentExpiryWindowDays !== undefined ? { documentExpiryWindowDays: body.documentExpiryWindowDays } : {}),
      updatedById: userId,
    };
    await prisma.fleetSettings.upsert({ where: { firmId }, create: { firmId, ...data }, update: data });
    return this.get(ctx, firmId);
  },
};

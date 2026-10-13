import { Machine, Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable, firmWhere } from '../../../utils/firmScope';
import { fleetConfig } from '../config';
import { currentReadingFor } from '../lib/currentReading';
import { toIstDateString } from '../lib/istDate';
import { UsageFlag, evaluateUsageEntry } from '../lib/usageRules';
import { assertWbsUsable } from './wbs.service';
import { Db, Warning, assertNotFarFuture, isUniqueViolation, loadMachineInScope, num, pageOf, requireUserId, resolveMachineWriteFirm, scopeOf } from './common';

export interface UsageEntryBody {
  machineId: string;
  startedAt: Date;
  startReading: number;
  stopReading?: number | null;
  stoppedAt?: Date | null;
  meterReset?: boolean;
  meterResetReason?: string | null;
  continuityReason?: string | null;
  operatorId?: bigint | null;
  remarks?: string | null;
  wbsActivityId?: string | null;
}

type UsageRow = Prisma.MachineUsageLogGetPayload<{ include: { machine: { select: { name: true; readingUnit: true } }; operator: { select: { name: true; user_name: true } } } }>;

/**
 * The reading the next entry should start from: the latest complete entry before `before`, else the
 * machine's opening reading (only when one was set, since 0 means "unknown"). Used both to prefill the
 * start reading and to detect chain gaps (data-quality rule 3).
 */
export async function previousStopFor(db: Db, machine: Pick<Machine, 'id' | 'openingReading'>, before: Date): Promise<number | null> {
  return currentReadingFor(db, machine, before);
}

/**
 * Core insert, shared by the HTTP route and Daily Entry (which wraps it in one transaction with the
 * diesel write). The caller has already resolved and authorised `machine` and `firmId`.
 */
export async function createUsageLogCore(
  db: Db,
  args: {
    userId: bigint;
    firmId: bigint;
    machine: Machine;
    body: UsageEntryBody;
    /** Work-log fields written on the same row (number, shift, work type, output, status, idempotency key ...). */
    extra?: Partial<Prisma.MachineUsageLogUncheckedCreateInput>;
    /** A work log on a machine with no meter (readingUnit NONE): no readings, the clock window is the record. */
    allowNoMeter?: boolean;
  },
): Promise<{ log: UsageRow; warnings: Warning[] }> {
  const { userId, firmId, machine, body, extra, allowNoMeter } = args;
  assertNotFarFuture(body.startedAt, 'startedAt');

  const open = await db.machineUsageLog.findFirst({
    where: { machineId: machine.id, stopReading: null, voidedAt: null, status: { not: 'REJECTED' } },
    select: { id: true, startReading: true, startedAt: true },
  });
  if (open) {
    throw new ApiError(
      409,
      `${machine.name} already has an open entry (started ${open.startedAt.toISOString()} at reading ${open.startReading}). Close it first.`,
      ['OPEN_ENTRY_EXISTS', open.id],
    );
  }

  const noMeter = Boolean(allowNoMeter) && machine.readingUnit === 'NONE';
  // a meter-less machine has no readings: the entry is complete when it has a stop TIME, and is stored as 0 -> 0 so the day still counts
  const hasStop = noMeter ? Boolean(body.stoppedAt) : body.stopReading !== null && body.stopReading !== undefined;
  const previousStop = noMeter ? null : await previousStopFor(db, machine, body.startedAt);
  const result = noMeter
    ? ({ ok: true, isOpen: !hasStop, usage: hasStop ? 0 : null, continuityGap: null, flags: [], warnings: [] } satisfies Extract<ReturnType<typeof evaluateUsageEntry>, { ok: true }>)
    : evaluateUsageEntry(
    {
      readingUnit: machine.readingUnit,
      startReading: body.startReading,
      stopReading: hasStop ? body.stopReading : null,
      meterReset: body.meterReset,
      meterResetReason: body.meterResetReason,
      previousStop,
      continuityReason: body.continuityReason,
      maxUsagePerEntry: machine.maxUsagePerEntry === null ? null : Number(machine.maxUsagePerEntry),
    },
    fleetConfig.usageLimits,
  );
  if (!result.ok) throw new ApiError(400, result.message, [result.code]);

  if (body.operatorId) {
    const operator = await db.user.findUnique({ where: { id: body.operatorId }, select: { id: true } });
    if (!operator) throw ApiError.badRequest('Unknown operator');
  }

  const wbsActivityId = await assertWbsUsable(db, firmId, body.wbsActivityId);

  let stoppedAt: Date | null = null;
  if (hasStop) {
    stoppedAt = body.stoppedAt ?? new Date();
    if (stoppedAt.getTime() < body.startedAt.getTime()) stoppedAt = body.startedAt;
  }

  try {
    const log = await db.machineUsageLog.create({
      data: {
        firmId,
        machineId: machine.id,
        logDate: new Date(toIstDateString(body.startedAt)),
        startedAt: body.startedAt,
        stoppedAt,
        startReading: noMeter ? 0 : body.startReading,
        stopReading: hasStop ? (noMeter ? 0 : body.stopReading) : null,
        usage: result.usage,
        meterReset: Boolean(body.meterReset),
        meterResetReason: body.meterReset ? body.meterResetReason?.trim() || null : null,
        continuityGap: result.continuityGap,
        continuityReason: result.continuityGap !== null ? body.continuityReason?.trim() || null : null,
        isFlagged: result.flags.length > 0,
        flagReasons: result.flags,
        operatorId: body.operatorId ?? null,
        remarks: body.remarks?.trim() || null,
        createdById: userId,
        wbsActivityId,
        ...(extra ?? {}),
      },
      include: USAGE_INCLUDE,
    });
    return { log, warnings: result.warnings };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, `${machine.name} already has an open entry. Close it first.`, ['OPEN_ENTRY_EXISTS']);
    throw e;
  }
}

const USAGE_INCLUDE = {
  machine: { select: { name: true, readingUnit: true } },
  operator: { select: { name: true, user_name: true } },
} as const;

export function mapUsage(r: UsageRow) {
  return {
    id: r.id,
    firmId: String(r.firmId),
    machineId: r.machineId,
    machineName: r.machine?.name ?? null,
    readingUnit: r.machine?.readingUnit ?? null,
    logDate: toIstDateString(r.startedAt),
    startedAt: r.startedAt.toISOString(),
    stoppedAt: r.stoppedAt?.toISOString() ?? null,
    startReading: num(r.startReading),
    stopReading: num(r.stopReading),
    usage: num(r.usage), // null while the entry is open, never partial or negative
    isOpen: r.stopReading === null,
    meterReset: r.meterReset,
    meterResetReason: r.meterResetReason,
    continuityGap: num(r.continuityGap),
    continuityReason: r.continuityReason,
    isFlagged: r.isFlagged,
    flagReasons: r.flagReasons,
    operatorId: r.operatorId ? String(r.operatorId) : null,
    operatorName: r.operator ? r.operator.name || r.operator.user_name || null : null,
    remarks: r.remarks,
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidReason: r.voidReason,
  };
}

export const usageLogService = {
  async create(ctx: UserAuthContext, body: UsageEntryBody & { firmId?: bigint | null }) {
    const userId = requireUserId(ctx);
    const machine = await loadMachineInScope(prisma, ctx, body.machineId);
    const firmId = await resolveMachineWriteFirm(prisma, ctx, machine, body.firmId ?? null);
    const { log, warnings } = await createUsageLogCore(prisma, { userId, firmId, machine, body });
    return { log: mapUsage(log), warnings };
  },

  /** Saves the stop reading of an OPEN entry. The start reading and chain flags are kept. */
  async close(ctx: UserAuthContext, id: string, body: { stopReading: number; stoppedAt?: Date | null }) {
    requireUserId(ctx);
    const entry = await prisma.machineUsageLog.findFirst({ where: { id, ...firmWhere(scopeOf(ctx)) }, include: { machine: true } });
    if (!entry) throw ApiError.notFound('Entry not found');
    assertFirmWritable(ctx, entry.firmId);
    if (entry.voidedAt) throw ApiError.conflict('This entry was voided');
    if (entry.stopReading !== null) throw ApiError.conflict('This entry is already closed');

    const result = evaluateUsageEntry(
      {
        readingUnit: entry.machine.readingUnit,
        startReading: Number(entry.startReading),
        stopReading: body.stopReading,
        maxUsagePerEntry: entry.machine.maxUsagePerEntry === null ? null : Number(entry.machine.maxUsagePerEntry),
        // the chain was checked when the entry was opened; do not re-litigate it here
        meterReset: false,
        previousStop: null,
      },
      fleetConfig.usageLimits,
    );
    if (!result.ok) throw new ApiError(400, result.message, [result.code]);

    let stoppedAt = body.stoppedAt ?? new Date();
    if (stoppedAt.getTime() < entry.startedAt.getTime()) stoppedAt = entry.startedAt;
    const kept = entry.flagReasons.filter((f) => f !== 'IMPLAUSIBLE_USAGE');
    const flags = [...kept, ...result.flags.filter((f: UsageFlag) => f === 'IMPLAUSIBLE_USAGE')];

    const log = await prisma.machineUsageLog.update({
      where: { id },
      data: { stopReading: body.stopReading, stoppedAt, usage: result.usage, flagReasons: flags, isFlagged: flags.length > 0 },
      include: USAGE_INCLUDE,
    });
    return { log: mapUsage(log), warnings: result.warnings };
  },

  async void(ctx: UserAuthContext, id: string, reason: string) {
    const userId = requireUserId(ctx);
    const entry = await prisma.machineUsageLog.findFirst({ where: { id, ...firmWhere(scopeOf(ctx)) } });
    if (!entry) throw ApiError.notFound('Entry not found');
    assertFirmWritable(ctx, entry.firmId);
    if (entry.voidedAt) throw ApiError.conflict('Already voided');
    await prisma.machineUsageLog.update({ where: { id }, data: { voidedAt: new Date(), voidedById: userId, voidReason: reason } });
    return { id, voided: true };
  },

  async list(
    ctx: UserAuthContext,
    q: { firmId?: unknown; machineId?: string; from?: string; to?: string; status?: 'open' | 'complete' | 'all'; flagged?: boolean; includeVoided?: boolean; limit?: number; offset?: number },
  ) {
    const where: Prisma.MachineUsageLogWhereInput = {
      ...firmWhere(scopeOf(ctx, q.firmId)),
      ...(q.machineId ? { machineId: q.machineId } : {}),
      ...(q.from || q.to ? { logDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.status === 'open' ? { stopReading: null } : q.status === 'complete' ? { stopReading: { not: null } } : {}),
      ...(q.flagged ? { isFlagged: true } : {}),
      ...(q.includeVoided ? {} : { voidedAt: null }),
    };
    const { take, skip } = pageOf(q);
    const [rows, total] = await Promise.all([
      prisma.machineUsageLog.findMany({ where, orderBy: { startedAt: 'desc' }, take, skip, include: USAGE_INCLUDE }),
      prisma.machineUsageLog.count({ where }),
    ]);
    return { total, rows: rows.map(mapUsage) };
  },
};

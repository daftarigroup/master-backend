// Work logs: the operator-facing record of a machine's work on a day. A work log IS a machine_usage_logs row (readings, usage, flags,
// cost and utilization all read it) with the work details, an approval status, a number and an idempotency key on top.
//
//   status       PENDING -> APPROVED | REJECTED (with a reason; the author edits and resubmits). Approved logs are locked; the
//                approver can reopen. Every transition is written to work_log_status_logs.
//   approver     an admin, the responsible person of the machine's active assignment, or a user with the work-log approve page key;
//                never the author.
//   fuel         litres entered on the log create ONE linked diesel log (usageLogId) in the same transaction. Diesel issued to the
//                machine that day but not linked to a log is reported separately.
//   idempotency  `clientRequestId` is generated once per form; a retry returns the existing log instead of a duplicate.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { hasPageAccessKey } from '../../../middleware/requireCostAccess';
import { fleetConfig } from '../config';
import { currentReadingFor } from '../lib/currentReading';
import { toIstDateString } from '../lib/istDate';
import { WORK_LOG_APPROVE_KEYS, activeOperatorWhere, machineAccessWhere } from '../lib/machineAccess';
import { loadOpsSettings, opsSettingsFor, shiftFor } from '../lib/opsSettings';
import { evaluateUsageEntry } from '../lib/usageRules';
import { KpiLog, clockMinutes, clockVarianceMinutes, computeWorkLogKpis, hasClockVariance } from '../lib/workLogKpis';
import { recordIssue } from './dieselLog.service';
import { dueForMachines } from './serviceDue.service';
import { UsageEntryBody, createUsageLogCore, previousStopFor } from './usageLog.service';
import { Warning, loadMachineInScope, num, pageOf, requireUserId, resolveMachineWriteFirm } from './common';

type Db = Prisma.TransactionClient | typeof prisma;
type Shift = 'DAY' | 'NIGHT' | 'GENERAL';

export interface WorkLogBody {
  clientRequestId?: string | null;
  firmId?: bigint | null;
  machineId: string;
  startedAt: Date;
  stoppedAt?: Date | null;
  startReading?: number | null;
  stopReading?: number | null;
  operatorId?: bigint | null;
  workTypeId?: string | null;
  locationText?: string | null;
  /** Only to refuse it: diesel is issued from Store Issue now. */
  fuelLitres?: number | null;
  remarks?: string | null;
  wbsActivityId?: string | null;
  meterReset?: boolean;
  meterResetReason?: string | null;
  continuityReason?: string | null;
}

const INCLUDE = {
  machine: { select: { id: true, name: true, assetCode: true, readingUnit: true, capacityLabel: true, firmId: true, openingReading: true } },
  operator: { select: { id: true, name: true, user_name: true } },
  createdBy: { select: { id: true, name: true, user_name: true } },
  approvedBy: { select: { id: true, name: true, user_name: true } },
  workType: { select: { id: true, name: true } },
  wbsActivity: { select: { id: true, code: true, name: true } },
} satisfies Prisma.MachineUsageLogInclude;

type Row = Prisma.MachineUsageLogGetPayload<{ include: typeof INCLUDE }>;

const userName = (u: { name: string | null; user_name: string | null } | null | undefined) => (u ? u.name || u.user_name || null : null);
const istYear = (d: Date) => Number(toIstDateString(d).slice(0, 4));

/** What an approver is: an admin, or the page-key holder; the responsible person of the assignment is added per machine by the caller. */
async function isGeneralApprover(ctx: UserAuthContext): Promise<boolean> {
  return hasPageAccessKey(ctx, WORK_LOG_APPROVE_KEYS);
}

async function responsibleByMachine(db: Db, machineIds: string[]): Promise<Map<string, bigint | null>> {
  const rows = machineIds.length === 0 ? [] : await db.machineAssignment.findMany({ where: { machineId: { in: machineIds }, endedAt: null }, select: { machineId: true, responsibleUserId: true } });
  return new Map(rows.map((r) => [r.machineId, r.responsibleUserId]));
}

interface ActorFlags {
  userId: bigint;
  role?: string;
  general: boolean;
  responsible: Map<string, bigint | null>;
}
const canApproveRow = (a: ActorFlags, r: Row) =>
  (a.role === 'SUPER_ADMIN' || r.createdById !== a.userId) &&
  (a.role === 'SUPER_ADMIN' || a.general || a.responsible.get(r.machineId) === a.userId);

/** Diesel is issued from Store Issue now: an old client that still sends fuel litres gets a clear error instead of losing them silently. */
function rejectFuel(body: { fuelLitres?: number | null }) {
  if (body.fuelLitres && body.fuelLitres > 0) throw ApiError.badRequest('Diesel is now issued from Store Issue (Asset), not on the work log. Remove the fuel litres and save again.');
}

export function mapWorkLog(r: Row, actor?: ActorFlags) {
  const unit = r.machine.readingUnit;
  const usage = num(r.usage);
  const clock = clockMinutes(r);
  const kpi = toKpiLog(r);
  const isOpen = r.stopReading === null;
  const mine = actor ? r.createdById === actor.userId : false;
  return {
    id: r.id,
    logNumber: r.logNumber,
    firmId: String(r.firmId),
    machineId: r.machineId,
    machine: { id: r.machine.id, name: r.machine.name, assetCode: r.machine.assetCode, readingUnit: unit, capacityLabel: r.machine.capacityLabel },
    date: toIstDateString(r.startedAt),
    startedAt: r.startedAt.toISOString(),
    stoppedAt: r.stoppedAt?.toISOString() ?? null,
    startReading: unit === 'NONE' ? null : num(r.startReading),
    stopReading: unit === 'NONE' || isOpen ? null : num(r.stopReading),
    usage: unit === 'NONE' ? null : usage,
    isOpen,
    // the meter is authoritative; the clock window is informational
    durationMinutes: unit === 'HOURS' && usage !== null ? Math.round(usage * 60) : clock,
    clockMinutes: clock,
    clockVarianceMinutes: clockVarianceMinutes(kpi),
    clockVariance: hasClockVariance(kpi),
    operator: r.operator ? { id: String(r.operator.id), name: userName(r.operator) } : null,
    shift: r.shift,
    workType: r.workType ? { id: r.workType.id, name: r.workType.name } : null,
    locationText: r.locationText,
    remarks: r.remarks,
    wbs: r.wbsActivity ? { id: r.wbsActivity.id, code: r.wbsActivity.code, name: r.wbsActivity.name } : null,
    status: r.status,
    createdBy: { id: String(r.createdById), name: userName(r.createdBy) },
    approvedBy: r.approvedBy ? { id: String(r.approvedBy.id), name: userName(r.approvedBy) } : null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    rejectReason: r.rejectReason,
    isFlagged: r.isFlagged,
    flagReasons: r.flagReasons,
    meterReset: r.meterReset,
    continuityGap: num(r.continuityGap),
    voided: r.voidedAt !== null,
    // what THIS caller may do with the row (the server re-checks every action)
    ...(actor
      ? {
          canEdit: r.voidedAt === null && ((mine && (r.status === 'PENDING' || r.status === 'REJECTED')) || (r.status === 'PENDING' && canApproveRow({ ...actor }, { ...r, createdById: 0n } as Row))),
          canApprove: r.voidedAt === null && r.status === 'PENDING' && !isOpen && canApproveRow(actor, r),
          canReopen: r.voidedAt === null && r.status !== 'PENDING' && canApproveRow(actor, { ...r, createdById: 0n } as Row),
        }
      : {}),
  };
}

function toKpiLog(r: Row): KpiLog {
  return {
    status: r.status,
    readingUnit: r.machine.readingUnit,
    usage: num(r.usage),
    startedAt: r.startedAt,
    stoppedAt: r.stoppedAt,
  };
}

async function actorFlags(db: Db, ctx: UserAuthContext, rows: Row[]): Promise<ActorFlags> {
  const userId = requireUserId(ctx);
  return {
    userId,
    role: ctx.role,
    general: ctx.role === 'SUPER_ADMIN' || await isGeneralApprover(ctx),
    responsible: await responsibleByMachine(db, [...new Set(rows.map((r) => r.machineId))]),
  };
}

async function logStatus(db: Db, usageLogId: string, from: 'PENDING' | 'APPROVED' | 'REJECTED' | null, to: 'PENDING' | 'APPROVED' | 'REJECTED', actorId: bigint, note?: string | null) {
  await db.workLogStatusLog.create({ data: { usageLogId, fromStatus: from, toStatus: to, actorId, note: note ?? null } });
}

/** Warnings that do not stop the save: overlapping time window, clock vs meter variance, expected operator, overdue service. */
async function softWarnings(db: Db, args: { machineId: string; excludeId?: string; startedAt: Date; stoppedAt: Date | null; usage: number | null; readingUnit: string; operatorId: bigint | null; shift: Shift }): Promise<Warning[]> {
  const out: Warning[] = [];
  if (args.stoppedAt) {
    const overlap = await db.machineUsageLog.findFirst({
      where: {
        machineId: args.machineId,
        voidedAt: null,
        status: { not: 'REJECTED' },
        ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
        startedAt: { lt: args.stoppedAt },
        OR: [{ stoppedAt: null }, { stoppedAt: { gt: args.startedAt } }],
      },
      select: { logNumber: true, startedAt: true },
    });
    if (overlap) out.push({ code: 'TIME_OVERLAP', message: `This time window overlaps another work log${overlap.logNumber ? ` (${overlap.logNumber})` : ''} on the same machine.` });
    if (args.readingUnit === 'HOURS' && args.usage !== null) {
      const clock = Math.round((args.stoppedAt.getTime() - args.startedAt.getTime()) / 60_000);
      const variance = Math.round(Math.abs(clock - args.usage * 60));
      if (variance > 10) out.push({ code: 'CLOCK_METER_VARIANCE', message: `The clock window (${clock} min) differs from the meter usage (${Math.round(args.usage * 60)} min) by ${variance} min. The meter is used for hours and cost.` });
    }
  }
  if (args.operatorId) {
    const assigned = await db.machineOperatorAssignment.findMany({ where: { machineId: args.machineId, ...activeOperatorWhere(), OR: [{ shift: null }, { shift: args.shift as 'DAY' | 'NIGHT' | 'GENERAL' }] }, select: { userId: true } });
    if (assigned.length > 0 && !assigned.some((a) => a.userId === args.operatorId)) {
      out.push({ code: 'OPERATOR_NOT_ASSIGNED', message: 'This operator is not the one assigned to this machine for the shift.' });
    }
  }
  return out;
}

export const workLogService = {
  async create(ctx: UserAuthContext, body: WorkLogBody) {
    const userId = requireUserId(ctx);
    rejectFuel(body);
    const machine = await loadMachineInScope(prisma, ctx, body.machineId);
    const firmId = await resolveMachineWriteFirm(prisma, ctx, machine, body.firmId ?? null);

    // a retried submit returns the log it already created
    if (body.clientRequestId) {
      const existing = await prisma.machineUsageLog.findFirst({ where: { firmId, clientRequestId: body.clientRequestId }, include: INCLUDE });
      if (existing) return { log: mapWorkLog(existing, await actorFlags(prisma, ctx, [existing])), warnings: [] as Warning[], idempotent: true };
    }

    const transit = await prisma.machineTransfer.findFirst({ where: { machineId: machine.id, status: 'IN_TRANSIT' }, select: { transferNumber: true } });
    if (transit) throw new ApiError(409, `${machine.name} is in transit (${transit.transferNumber}). Receive the transfer before logging work.`, ['MACHINE_IN_TRANSIT']);

    const settings = await opsSettingsFor(prisma, firmId);
    const warnings: Warning[] = [];
    const due = (await dueForMachines(prisma, [machine])).get(machine.id)?.nearest;
    if (due?.status === 'OVERDUE') {
      if (settings.blockWorkWhenServiceOverdue) throw new ApiError(409, `${machine.name} is overdue for service. Service it before logging more work.`, ['SERVICE_OVERDUE']);
      warnings.push({ code: 'SERVICE_OVERDUE', message: `${machine.name} is overdue for service.` });
    }

    const noMeter = machine.readingUnit === 'NONE';
    if (!noMeter && (body.startReading === null || body.startReading === undefined)) throw ApiError.badRequest('Enter the start reading');
    const shift: Shift = shiftFor(body.startedAt, settings); // no longer entered: worked out from the start time (operator assignment, warning)

    // operator: the one assigned for the shift unless someone else is chosen
    let operatorId = body.operatorId ?? null;
    if (operatorId === null) {
      const op = await prisma.machineOperatorAssignment.findFirst({ where: { machineId: machine.id, ...activeOperatorWhere(), OR: [{ shift: null }, { shift }] }, orderBy: { shift: 'asc' } });
      operatorId = op?.userId ?? null;
    }

    try {
      const out = await prisma.$transaction(async (tx) => {
        const logNumber = await documentSequenceService.next({ firmId, prefix: 'WL', year: istYear(body.startedAt), pad: 5 }, tx);
        const entry: UsageEntryBody = {
          machineId: machine.id,
          startedAt: body.startedAt,
          startReading: body.startReading ?? 0,
          stopReading: noMeter ? null : (body.stopReading ?? null),
          stoppedAt: body.stoppedAt ?? null,
          meterReset: body.meterReset,
          meterResetReason: body.meterResetReason,
          continuityReason: body.continuityReason,
          operatorId,
          remarks: body.remarks,
          wbsActivityId: body.wbsActivityId,
        };
        const { log, warnings: w } = await createUsageLogCore(tx, {
          userId,
          firmId,
          machine,
          body: entry,
          allowNoMeter: true,
          extra: {
            logNumber,
            shift,
            workTypeId: body.workTypeId ?? null,
            locationText: body.locationText?.trim() || null,
            status: 'PENDING',
            clientRequestId: body.clientRequestId ?? null,
          },
        });
        warnings.push(...w);
        await logStatus(tx, log.id, null, 'PENDING', userId, 'Created');

        const saved = await tx.machineUsageLog.findUniqueOrThrow({ where: { id: log.id }, include: INCLUDE });
        return saved;
      });
      warnings.push(...(await softWarnings(prisma, { machineId: machine.id, excludeId: out.id, startedAt: out.startedAt, stoppedAt: out.stoppedAt, usage: num(out.usage), readingUnit: machine.readingUnit, operatorId, shift })));
      return { log: mapWorkLog(out, await actorFlags(prisma, ctx, [out])), warnings, idempotent: false };
    } catch (e) {
      // a double tap racing the idempotency lookup: the unique index catches it, and the first insert wins
      if (body.clientRequestId && (e as { code?: string })?.code === 'P2002') {
        const existing = await prisma.machineUsageLog.findFirst({ where: { firmId, clientRequestId: body.clientRequestId }, include: INCLUDE });
        if (existing) return { log: mapWorkLog(existing, await actorFlags(prisma, ctx, [existing])), warnings: [] as Warning[], idempotent: true };
      }
      throw e;
    }
  },

  /** Edit an own PENDING / REJECTED log (a rejected one goes back to PENDING), or a PENDING one as an approver. Approved logs are locked. */
  async update(ctx: UserAuthContext, id: string, body: Partial<Omit<WorkLogBody, 'machineId' | 'firmId' | 'clientRequestId'>>) {
    const userId = requireUserId(ctx);
    rejectFuel(body);
    const row = await prisma.machineUsageLog.findFirst({ where: { id, machine: await machineAccessWhere(ctx), voidedAt: null }, include: INCLUDE });
    if (!row) throw ApiError.notFound('Work log not found');
    if (row.status === 'APPROVED') throw ApiError.conflict('This work log is approved and locked. An approver can reopen it.');
    const actor = await actorFlags(prisma, ctx, [row]);
    const own = row.createdById === userId;
    const approverEdit = row.status === 'PENDING' && (actor.general || actor.responsible.get(row.machineId) === userId);
    if (!(own || approverEdit)) throw ApiError.forbidden('Only the person who logged this entry, or an approver, can edit it');

    const machine = row.machine;
    const noMeter = machine.readingUnit === 'NONE';
    const startedAt = body.startedAt ?? row.startedAt;
    let stoppedAt = body.stoppedAt === undefined ? row.stoppedAt : body.stoppedAt;
    // closing an open entry (a stop reading with no stop time) stamps the stop time now, never earlier than the start
    if (!noMeter && body.stopReading != null && stoppedAt === null) stoppedAt = new Date(Math.max(Date.now(), (body.startedAt ?? row.startedAt).getTime()));
    const startReading = body.startReading ?? Number(row.startReading);
    const stopReading = body.stopReading === undefined ? (row.stopReading === null ? null : Number(row.stopReading)) : body.stopReading;

    let usage: number | null = noMeter ? (stoppedAt ? 0 : null) : null;
    let flags: string[] = row.flagReasons;
    let continuityGap = row.continuityGap === null ? null : Number(row.continuityGap);
    const warnings: Warning[] = [];
    if (!noMeter) {
      const previousStop = await previousStopFor(prisma, machine, startedAt);
      const result = evaluateUsageEntry(
        {
          readingUnit: machine.readingUnit,
          startReading,
          stopReading,
          meterReset: body.meterReset ?? row.meterReset,
          meterResetReason: body.meterResetReason ?? row.meterResetReason,
          previousStop,
          continuityReason: body.continuityReason ?? row.continuityReason,
        },
        fleetConfig.usageLimits,
      );
      if (!result.ok) throw new ApiError(400, result.message, [result.code]);
      usage = result.usage;
      flags = result.flags;
      continuityGap = result.continuityGap;
      warnings.push(...result.warnings);
    }

    const settings = await opsSettingsFor(prisma, row.firmId);
    const shift: Shift = body.startedAt ? shiftFor(startedAt, settings) : row.shift;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.machineUsageLog.update({
        where: { id },
        data: {
          startedAt,
          logDate: new Date(toIstDateString(startedAt)),
          stoppedAt: stopReading === null && !noMeter ? null : stoppedAt,
          startReading: noMeter ? 0 : startReading,
          stopReading: noMeter ? (stoppedAt ? 0 : null) : stopReading,
          usage,
          flagReasons: flags,
          isFlagged: flags.length > 0,
          continuityGap,
          ...(body.meterReset !== undefined ? { meterReset: body.meterReset, meterResetReason: body.meterReset ? body.meterResetReason?.trim() || null : null } : {}),
          ...(body.continuityReason !== undefined ? { continuityReason: body.continuityReason?.trim() || null } : {}),
          ...(body.operatorId !== undefined ? { operatorId: body.operatorId } : {}),
          shift,
          ...(body.workTypeId !== undefined ? { workTypeId: body.workTypeId } : {}),
          ...(body.locationText !== undefined ? { locationText: body.locationText?.trim() || null } : {}),
          ...(body.remarks !== undefined ? { remarks: body.remarks?.trim() || null } : {}),
          ...(body.wbsActivityId !== undefined ? { wbsActivityId: body.wbsActivityId } : {}),
          // a rejected log that is edited is resubmitted
          ...(row.status === 'REJECTED' ? { status: 'PENDING', rejectReason: null, approvedById: null, approvedAt: null } : {}),
        },
      });
      if (row.status === 'REJECTED') await logStatus(tx, id, 'REJECTED', 'PENDING', userId, 'Edited and resubmitted');

      return tx.machineUsageLog.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    warnings.push(...(await softWarnings(prisma, { machineId: row.machineId, excludeId: id, startedAt, stoppedAt: updated.stoppedAt, usage, readingUnit: machine.readingUnit, operatorId: updated.operatorId, shift })));
    return { log: mapWorkLog(updated, await actorFlags(prisma, ctx, [updated])), warnings };
  },

  async approve(ctx: UserAuthContext, id: string) {
    const userId = requireUserId(ctx);
    const row = await prisma.machineUsageLog.findFirst({ where: { id, machine: await machineAccessWhere(ctx), voidedAt: null }, include: INCLUDE });
    if (!row) throw ApiError.notFound('Work log not found');
    if (row.status === 'APPROVED') return { log: mapWorkLog(row, await actorFlags(prisma, ctx, [row])) }; // approving twice changes nothing
    if (row.status !== 'PENDING') throw ApiError.conflict('Only a pending work log can be approved');
    if (row.stopReading === null) throw ApiError.conflict('This entry is still open. It can be approved once it has a stop reading.');
    const actor = await actorFlags(prisma, ctx, [row]);
    if (actor.role !== 'SUPER_ADMIN' && row.createdById === userId) throw ApiError.forbidden('You cannot approve a work log you entered yourself');
    if (!canApproveRow(actor, row)) throw ApiError.forbidden('Only an approver can approve work logs');

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.machineUsageLog.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), rejectReason: null } });
      if (res.count === 1) await logStatus(tx, id, 'PENDING', 'APPROVED', userId);
      return tx.machineUsageLog.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    return { log: mapWorkLog(updated, await actorFlags(prisma, ctx, [updated])) };
  },

  async reject(ctx: UserAuthContext, id: string, reason: string) {
    const userId = requireUserId(ctx);
    if (reason.trim().length < 3) throw ApiError.badRequest('Give a reason for rejecting (at least 3 characters)');
    const row = await prisma.machineUsageLog.findFirst({ where: { id, machine: await machineAccessWhere(ctx), voidedAt: null }, include: INCLUDE });
    if (!row) throw ApiError.notFound('Work log not found');
    if (row.status !== 'PENDING') throw ApiError.conflict('Only a pending work log can be rejected');
    const actor = await actorFlags(prisma, ctx, [row]);
    if (actor.role !== 'SUPER_ADMIN' && row.createdById === userId) throw ApiError.forbidden('You cannot reject your own work log');
    if (!canApproveRow(actor, row)) throw ApiError.forbidden('Only an approver can reject work logs');
    const updated = await prisma.$transaction(async (tx) => {
      await tx.machineUsageLog.update({ where: { id }, data: { status: 'REJECTED', rejectReason: reason.trim(), approvedById: userId, approvedAt: new Date() } });
      await logStatus(tx, id, 'PENDING', 'REJECTED', userId, reason.trim());
      return tx.machineUsageLog.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    return { log: mapWorkLog(updated, await actorFlags(prisma, ctx, [updated])) };
  },

  /** An approver puts an approved or rejected log back to PENDING so it can be corrected. Logged with who and why. */
  async reopen(ctx: UserAuthContext, id: string, note: string) {
    const userId = requireUserId(ctx);
    if (note.trim().length < 3) throw ApiError.badRequest('Give a reason for reopening (at least 3 characters)');
    const row = await prisma.machineUsageLog.findFirst({ where: { id, machine: await machineAccessWhere(ctx), voidedAt: null }, include: INCLUDE });
    if (!row) throw ApiError.notFound('Work log not found');
    if (row.status === 'PENDING') throw ApiError.conflict('This work log is already pending');
    const actor = await actorFlags(prisma, ctx, [row]);
    if (!canApproveRow({ ...actor }, { ...row, createdById: 0n } as Row)) throw ApiError.forbidden('Only an approver can reopen a work log');
    const updated = await prisma.$transaction(async (tx) => {
      await tx.machineUsageLog.update({ where: { id }, data: { status: 'PENDING', approvedById: null, approvedAt: null, rejectReason: null } });
      await logStatus(tx, id, row.status, 'PENDING', userId, `Reopened: ${note.trim()}`);
      return tx.machineUsageLog.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    return { log: mapWorkLog(updated, await actorFlags(prisma, ctx, [updated])) };
  },

  /** Each row is checked on its own (own entries, open entries and other firms are reported back, never silently skipped). */
  async bulkApprove(ctx: UserAuthContext, ids: string[]) {
    const approved: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try {
        await this.approve(ctx, id);
        approved.push(id);
      } catch (e) {
        failed.push({ id, reason: (e as Error).message });
      }
    }
    return { approved, failed };
  },

  async get(ctx: UserAuthContext, id: string) {
    const row = await prisma.machineUsageLog.findFirst({ where: { id, machine: await machineAccessWhere(ctx) }, include: { ...INCLUDE, statusLogs: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { id: true, name: true, user_name: true } } } } } });
    if (!row) throw ApiError.notFound('Work log not found');
    return {
      ...mapWorkLog(row, await actorFlags(prisma, ctx, [row])),
      history: row.statusLogs.map((s) => ({ id: s.id, from: s.fromStatus, to: s.toStatus, note: s.note, at: s.createdAt.toISOString(), by: userName(s.actor) })),
    };
  },

  /** List + KPIs for a machine-day, a range, or a day sheet across machines. The KPIs are computed on the SAME rows that are listed. */
  async list(
    ctx: UserAuthContext,
    q: { firmId?: unknown; machineId?: string; date?: string; from?: string; to?: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED'; operatorId?: bigint; mine?: boolean; limit?: number; offset?: number },
  ) {
    const userId = requireUserId(ctx);
    const from = q.date ?? q.from;
    const to = q.date ?? q.to;
    const where: Prisma.MachineUsageLogWhereInput = {
      voidedAt: null,
      machine: await machineAccessWhere(ctx, q.firmId),
      ...(q.machineId ? { machineId: q.machineId } : {}),
      ...(from || to ? { logDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.operatorId ? { operatorId: q.operatorId } : {}),
      ...(q.mine ? { OR: [{ createdById: userId }, { operatorId: userId }] } : {}),
    };
    const { take, skip } = pageOf({ limit: q.limit ?? 100, offset: q.offset });
    const [rows, total, allForKpi] = await Promise.all([
      prisma.machineUsageLog.findMany({ where, orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }], take, skip, include: INCLUDE }),
      prisma.machineUsageLog.count({ where }),
      // KPIs cover everything that matches, not just this page
      prisma.machineUsageLog.findMany({ where, include: INCLUDE }),
    ]);

    const actor = await actorFlags(prisma, ctx, rows);
    const settings = await loadOpsSettings(prisma, [...new Set(allForKpi.map((r) => r.firmId))]);
    const countable = (r: Row) => r.status !== 'PENDING' || (settings.get(String(r.firmId))?.countPendingLogsInTotals ?? true);
    const kpi = computeWorkLogKpis(allForKpi.filter(countable).map(toKpiLog), { countPending: true });
    const pendingCount = allForKpi.filter((r) => r.status === 'PENDING').length;

    return {
      total,
      rows: rows.map((r) => mapWorkLog(r, actor)),
      kpis: { ...kpi, pendingCount, provisional: allForKpi.some((r) => r.status === 'PENDING' && countable(r)) },
    };
  },

  /** How many pending, complete work logs this caller could approve right now (the sidebar badge). Their own entries do not count unless SUPER_ADMIN. */
  async approvalCount(ctx: UserAuthContext): Promise<number> {
    const userId = requireUserId(ctx);
    const isSuper = ctx.role === 'SUPER_ADMIN';
    const general = isSuper || await isGeneralApprover(ctx);
    const rows = await prisma.machineUsageLog.findMany({
      where: {
        voidedAt: null,
        status: 'PENDING',
        stopReading: { not: null },
        ...(isSuper ? {} : { createdById: { not: userId } }),
        machine: await machineAccessWhere(ctx),
      },
      select: { machineId: true },
    });
    if (general) return rows.length;
    const mine = await responsibleByMachine(prisma, [...new Set(rows.map((r) => r.machineId))]);
    return rows.filter((r) => mine.get(r.machineId) === userId).length;
  },

  /** Prefill for the Add form: the reading to start from, the open entry, the operator and shift, the service status. */
  async prefill(ctx: UserAuthContext, machineId: string, at: Date = new Date()) {
    const machine = await loadMachineInScope(prisma, ctx, machineId);
    const firmId = await resolveMachineWriteFirm(prisma, ctx, machine, null);
    const settings = await opsSettingsFor(prisma, firmId);
    const shift = shiftFor(at, settings);
    const [lastStop, open, op, due, transit] = await Promise.all([
      currentReadingFor(prisma, machine),
      prisma.machineUsageLog.findFirst({ where: { machineId, voidedAt: null, status: { not: 'REJECTED' }, stopReading: null }, select: { id: true, startReading: true, startedAt: true, logNumber: true } }),
      prisma.machineOperatorAssignment.findFirst({ where: { machineId, ...activeOperatorWhere(), OR: [{ shift: null }, { shift }] }, include: { user: { select: { id: true, name: true, user_name: true } } } }),
      dueForMachines(prisma, [machine]),
      prisma.machineTransfer.findFirst({ where: { machineId, status: 'IN_TRANSIT' }, select: { transferNumber: true } }),
    ]);
    return {
      machine: { id: machine.id, name: machine.name, assetCode: machine.assetCode, readingUnit: machine.readingUnit, capacityLabel: machine.capacityLabel },
      firmId: String(firmId),
      shift,
      lastStop,
      openEntry: open ? { id: open.id, logNumber: open.logNumber, startReading: num(open.startReading), startedAt: open.startedAt.toISOString() } : null,
      operator: op ? { id: String(op.user.id), name: userName(op.user) } : null,
      serviceStatus: due.get(machineId)?.nearest?.status ?? null,
      inTransit: transit?.transferNumber ?? null,
    };
  },
};

import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { recordIssue } from './dieselLog.service';
import { UsageEntryBody, createUsageLogCore, mapUsage } from './usageLog.service';
import { Warning, loadMachineInScope, num, requireUserId, resolveMachineWriteFirm, resolveWriteFirm } from './common';

export interface DailyEntryBody {
  firmId?: bigint | null;
  machineId?: string | null;
  /** "Other diesel" (no machine): only valid together with `diesel`. */
  consumerLabel?: string | null;
  /** When this happened; the default time for both the diesel issue and the usage start. */
  occurredAt: Date;
  /** The WBS activity this work is booked to; applies to both the usage entry and the diesel issue. */
  wbsActivityId?: string | null;
  diesel?: { litres: number; issuedAt?: Date; note?: string | null } | null;
  usage?: Omit<UsageEntryBody, 'machineId' | 'startedAt'> & { startedAt?: Date } | null;
}

export const dailyEntryService = {
  /**
   * The fast "Daily Entry" screen: one save writes the diesel issue and/or the usage reading for a
   * machine/day, in ONE transaction, so a rejected reading never leaves an orphaned diesel row.
   * The data still lives in two tables (plan §B); `usageLogId` links the pair.
   */
  async create(ctx: UserAuthContext, body: DailyEntryBody) {
    const userId = requireUserId(ctx);
    // Diesel is issued from Store Issue (Asset) now; this entry only records a usage reading.
    if (body.diesel) throw ApiError.badRequest('Diesel is now issued from Store Issue (Asset), not here. Enter only the usage reading.');
    if (!body.diesel && !body.usage) throw ApiError.badRequest('Enter diesel, a usage reading, or both');
    if (body.usage && !body.machineId) throw ApiError.badRequest('A usage reading needs a machine');
    if (!body.machineId && !body.consumerLabel?.trim()) throw ApiError.badRequest('Pick a machine or describe the diesel consumer');
    if (body.machineId && body.consumerLabel?.trim()) throw ApiError.badRequest('Give either a machine or a label, not both');

    return prisma.$transaction(async (tx) => {
      const warnings: Warning[] = [];
      let machine = null;
      let firmId: bigint;
      if (body.machineId) {
        machine = await loadMachineInScope(tx, ctx, body.machineId);
        firmId = await resolveMachineWriteFirm(tx, ctx, machine, body.firmId ?? null);
      } else {
        if (body.firmId == null) throw ApiError.badRequest('firmId is required for diesel without a machine');
        firmId = resolveWriteFirm(ctx, body.firmId, body.firmId);
      }

      let usageOut = null;
      let usageId: string | null = null;
      if (body.usage && machine) {
        const { log, warnings: w } = await createUsageLogCore(tx, {
          userId,
          firmId,
          machine,
          body: { ...body.usage, machineId: machine.id, startedAt: body.usage.startedAt ?? body.occurredAt, wbsActivityId: body.usage.wbsActivityId ?? body.wbsActivityId ?? null },
        });
        usageOut = mapUsage(log);
        usageId = log.id;
        warnings.push(...w);
      }

      let dieselOut = null;
      if (body.diesel) {
        const { log, warnings: w } = await recordIssue(
          {
            firmId,
            machineId: machine?.id ?? null,
            consumerLabel: body.consumerLabel ?? null,
            issuedAt: body.diesel.issuedAt ?? body.occurredAt,
            litres: body.diesel.litres,
            note: body.diesel.note ?? null,
            createdById: userId,
            usageLogId: usageId,
            wbsActivityId: body.wbsActivityId ?? null,
            source: 'MANUAL',
          },
          tx,
        );
        dieselOut = { id: log.id, litres: num(log.litres), issuedAt: log.issuedAt.toISOString(), usageLogId: log.usageLogId };
        warnings.push(...w);
      }

      return { usage: usageOut, diesel: dieselOut, warnings };
    });
  },
};

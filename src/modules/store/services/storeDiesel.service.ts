import { Prisma } from '@prisma/client';
import { ApiError } from '../../../utils/ApiError';
import { fleetConfig } from '../../fleet/config';
import { currentReadingFor } from '../../fleet/lib/currentReading';
import { recordIssue } from '../../fleet/services/dieselLog.service';
import { StockService } from './stock.service';
import { normalizeItemName } from './itemRef.service';

/**
 * Phase 2: an approved Store issue of kind ASSET_DIESEL IS the machine's diesel log entry.
 *
 * `reconcile` brings the `diesel_logs` side in line with the Store issue, whatever just happened to it (approved, approved with other
 * litres, rejected, reset to Pending, deleted). It is idempotent, so it is safe to call after every write to an issue:
 *   - Approved (or Yes) with given_qty > 0  -> exactly one live log: source STORE_ISSUE, the approved litres, the machine, the
 *     meter reading, the Store average price (rateSource STORE), review flags for a doubtful reading;
 *   - anything else                          -> the live log is voided and its `externalRef` freed (history stays), so a later
 *     re-approval writes a fresh log.
 * Doubtful readings are SAVED and FLAGGED (READING_BELOW_LAST, READING_JUMP), never blocked.
 */
type Db = Prisma.TransactionClient;

export const FLAG_BELOW_LAST = 'READING_BELOW_LAST';
export const FLAG_JUMP = 'READING_JUMP';

const APPROVED = new Set(['approved', 'yes']);
const refFor = (issueId: bigint | number | string) => `STORE_ISSUE_DIESEL_${issueId}`;
const toNumber = (v: unknown): number => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

export class StoreDieselService {
  static isApproved(status: unknown): boolean {
    return APPROVED.has(String(status ?? '').trim().toLowerCase());
  }

  /** Review flags for a spot reading, against the highest of: the last completed work-log stop (or opening), the last diesel reading. */
  static async readingFlags(
    db: Db,
    machine: { id: string; openingReading: Prisma.Decimal | number | string; readingUnit: 'KM' | 'HOURS' | 'NONE'; maxUsagePerEntry: Prisma.Decimal | null },
    reading: number | null,
    at: Date,
    ignoreLogId?: string,
  ): Promise<string[]> {
    if (reading === null || machine.readingUnit === 'NONE') return [];
    const fromUsage = await currentReadingFor(db as any, machine);
    const lastDiesel = await db.dieselLog.findFirst({
      where: { machineId: machine.id, voidedAt: null, meterReading: { not: null }, issuedAt: { lt: at }, ...(ignoreLogId ? { id: { not: ignoreLogId } } : {}) },
      orderBy: { issuedAt: 'desc' },
      select: { meterReading: true },
    });
    const bases = [fromUsage, lastDiesel?.meterReading != null ? Number(lastDiesel.meterReading) : null].filter((n): n is number => n !== null);
    if (bases.length === 0) return [];
    const baseline = Math.max(...bases);
    if (reading < baseline) return [FLAG_BELOW_LAST];
    const limits = fleetConfig.usageLimits;
    const limit = machine.maxUsagePerEntry !== null ? Number(machine.maxUsagePerEntry) : machine.readingUnit === 'HOURS' ? limits.maxHoursPerEntry : limits.maxKmPerEntry;
    return reading - baseline > limit ? [FLAG_JUMP] : [];
  }

  /** The approval rule for diesel: the approved litres cannot exceed what the project's Store holds of that item. */
  static async assertStockFor(db: Db, issue: { firm_id: bigint | null; product_name: string | null; group_head: string | null; given_qty: string | null; status: string | null }, newGiven: number, unit = 'L'): Promise<void> {
    if (issue.firm_id === null || !issue.product_name) return;
    const gh = normalizeItemName(issue.group_head);
    const rows = await StockService.compute(db as any, { firmId: issue.firm_id, name: issue.product_name });
    const bucket = rows.find((r) => normalizeItemName(r.groupHead) === gh) ?? rows[0];
    const alreadyIssued = this.isApproved(issue.status) ? toNumber(issue.given_qty) : 0; // already counted in `current`
    const available = (bucket?.current ?? 0) + alreadyIssued;
    if (newGiven > available) {
      throw new ApiError(409, `Cannot issue ${newGiven}${unit ? ` ${unit}` : ''} of ${issue.product_name}: the project's Store holds only ${available}${unit ? ` ${unit}` : ''}`);
    }
  }

  static async reconcile(db: Db, issueId: bigint | number | string, actorId: bigint | null): Promise<void> {
    const id = BigInt(issueId as any);
    const issue = await db.issue.findUnique({ where: { id } });
    const live = await db.dieselLog.findFirst({ where: { storeIssueId: id, voidedAt: null } });

    const litres = issue ? toNumber(issue.given_qty) : 0;
    const wanted = !!issue && issue.issue_kind === 'ASSET_DIESEL' && this.isApproved(issue.status) && litres > 0;

    if (!wanted) {
      if (live) await this.voidLog(db, live.id, actorId, issue ? `Store issue ${issue.issue_no ?? id} is ${issue.status || 'Pending'}` : 'Store issue deleted');
      return;
    }

    const machine = await db.machine.findUnique({ where: { id: issue!.machine_id! } });
    if (!machine) throw ApiError.badRequest('The machine of this issue no longer exists');
    if (issue!.firm_id === null) throw ApiError.badRequest('The issue has no project');
    const reading = issue!.meter_reading !== null ? Number(issue!.meter_reading) : null;
    const issuedAt = issue!.planned1 ?? issue!.timestamp;

    let siteLocationId: bigint | null = null;
    if (issue!.site_location?.trim()) {
      const loc = await db.siteLocationDetails.findFirst({
        where: {
          location: { equals: issue!.site_location.trim(), mode: 'insensitive' },
          OR: [
            { firm_id: issue!.firm_id },
            { firm_id: null },
          ],
        },
        select: { id: true },
      });
      if (loc) siteLocationId = BigInt(loc.id);
    }

    if (
      live &&
      Number(live.litres) === litres &&
      (live.meterReading === null ? null : Number(live.meterReading)) === reading &&
      live.siteLocationId === siteLocationId
    ) {
      return; // nothing changed
    }
    if (live) await this.voidLog(db, live.id, actorId, 'Store issue approval changed');

    let effectiveActorId = actorId;
    if (effectiveActorId === null) {
      const fallbackUser = await db.user.findFirst({ select: { id: true } });
      if (fallbackUser) effectiveActorId = fallbackUser.id;
    }
    if (effectiveActorId === null) throw ApiError.badRequest('A user is required to approve a diesel issue');

    const rate = await StockService.averageRate(db as any, { firmId: issue!.firm_id, name: issue!.product_name ?? 'DIESEL', groupHead: issue!.group_head });
    const flags = await this.readingFlags(db, machine, reading, issuedAt);

    await recordIssue(
      {
        firmId: issue!.firm_id,
        machineId: machine.id,
        siteLocationId,
        issuedAt,
        litres,
        source: 'STORE_ISSUE',
        externalRef: refFor(id),
        note: `Store issue ${issue!.issue_no ?? id}${issue!.issue_person_name ? ` (issued by ${issue!.issue_person_name})` : ''}${issue!.issue_to ? ` — ${issue!.issue_to}` : ''}`,
        createdById: effectiveActorId,
        meterReading: reading,
        flags,
        storeIssueId: id,
        ...(rate !== null ? { ratePerLitre: rate, rateSource: 'STORE' as const } : {}),
      },
      db as any,
    );
  }

  /** Void the live log of an issue (used before the issue row is deleted, while the link still exists). */
  static async voidForIssue(db: Db, issueId: bigint | number | string, actorId: bigint | null, reason: string): Promise<void> {
    const live = await db.dieselLog.findFirst({ where: { storeIssueId: BigInt(issueId as any), voidedAt: null } });
    if (live) await this.voidLog(db, live.id, actorId, reason);
  }

  static async reconcileMany(db: Db, issueIds: Array<bigint | number | string>, actorId: bigint | null): Promise<void> {
    for (const id of issueIds) await this.reconcile(db, id, actorId);
  }

  /** Void a log and free its `externalRef` (a later approval of the same issue must be able to write a new one). */
  private static async voidLog(db: Db, logId: string, actorId: bigint | null, reason: string): Promise<void> {
    const log = await db.dieselLog.findUnique({ where: { id: logId }, select: { externalRef: true } });
    await db.dieselLog.update({
      where: { id: logId },
      data: {
        voidedAt: new Date(),
        voidedById: actorId,
        voidReason: reason.slice(0, 300),
        externalRef: log?.externalRef ? `${log.externalRef}:voided:${Date.now()}` : null,
      },
    });
  }
}

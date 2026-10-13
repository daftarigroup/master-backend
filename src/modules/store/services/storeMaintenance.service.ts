import { Prisma } from '@prisma/client';
import { ApiError } from '../../../utils/ApiError';
import { refreshPartsCost } from '../../maintenance/lib/partsCost';
import { StockService } from './stock.service';
import { StoreDieselService } from './storeDiesel.service';

/**
 * Phases 5 / 6: an approved Store issue of kind MAINTENANCE IS the work order's part being issued.
 *
 * `reconcile` brings `work_order_part_issues` in line with the Store issue, whatever just happened to it. It is idempotent:
 *   - Approved (or Yes) with given_qty > 0, against a part line  -> exactly one live row: the approved quantity at the Store average price;
 *   - anything else (Pending again, Rejected, deleted)           -> the live row is voided (history stays).
 * Either way the work order's actual parts cost is refreshed. A repair that is already completed keeps the parts it consumed.
 */
type Db = Prisma.TransactionClient;
const EPS = 0.0005;
const toNumber = (v: unknown): number => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};
const DONE = new Set(['COMPLETED', 'COMPLETED_LATE']);
const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export interface MaintenanceIssueRow {
  id?: bigint | number | string;
  firm_id: bigint | null;
  product_name: string | null;
  group_head: string | null;
  given_qty: string | null;
  status: string | null;
  requirement_id: string | null;
}

export class StoreMaintenanceService {
  /** Approved quantity already issued for a part line, not counting the issue being approved or changed. */
  static async issuedFor(db: Db, requirementId: string, exceptIssueId?: bigint | null): Promise<number> {
    const rows = await db.workOrderPartIssue.findMany({
      where: { requirementId, voidedAt: null, ...(exceptIssueId ? { NOT: { storeIssueId: exceptIssueId } } : {}) },
      select: { quantity: true },
    });
    return rows.reduce((s, r) => s + Number(r.quantity), 0);
  }

  /** Requested but not yet decided quantity on other Store issues for the same part line (stops one part being requested twice). */
  static async pendingFor(db: Db, requirementId: string, exceptIssueId?: bigint | null): Promise<number> {
    const rows = await db.issue.findMany({
      where: { requirement_id: requirementId, ...(exceptIssueId ? { NOT: { id: exceptIssueId } } : {}) },
      select: { quantity: true, status: true },
    });
    const decided = (status: string | null) => StoreDieselService.isApproved(status) || String(status ?? '').trim().toLowerCase() === 'rejected';
    return rows.filter((r) => !decided(r.status)).reduce((s, r) => s + toNumber(r.quantity), 0);
  }

  /** Approval rule: within what the part line still needs, and within the project's stock. */
  static async assertApprovalFor(db: Db, issue: MaintenanceIssueRow, newGiven: number): Promise<void> {
    if (!issue.requirement_id) throw ApiError.badRequest('This maintenance issue is not against a part of a work order');
    const line = await db.workOrderPartRequirement.findUnique({ where: { id: issue.requirement_id }, include: { workOrder: { select: { status: true, workOrderCode: true } } } });
    if (!line || line.status !== 'OPEN') throw ApiError.conflict('The part this issue was raised for is no longer on the work order');
    if (DONE.has(line.workOrder.status) || line.workOrder.status === 'CANCELLED') {
      throw ApiError.conflict(`Work order ${line.workOrder.workOrderCode ?? ''} is ${words(line.workOrder.status)}; parts cannot be issued to it`);
    }
    const id = issue.id !== undefined ? BigInt(issue.id as any) : null;
    const remaining = Number(line.quantity) - (await this.issuedFor(db, line.id, id));
    if (newGiven > remaining + EPS) {
      throw new ApiError(409, `Cannot issue ${newGiven} of ${line.itemName}: the work order needs only ${Math.max(0, remaining)} more`);
    }
    await StoreDieselService.assertStockFor(db, issue, newGiven, line.uom ?? '');
  }

  /** A completed repair keeps the parts it consumed: such an approval cannot be undone. */
  static async assertUndoable(db: Db, issueId: bigint | number | string): Promise<void> {
    const live = await db.workOrderPartIssue.findFirst({ where: { storeIssueId: BigInt(issueId as any), voidedAt: null }, include: { workOrder: { select: { status: true, workOrderCode: true } } } });
    if (live && DONE.has(live.workOrder.status)) {
      throw ApiError.conflict(`Work order ${live.workOrder.workOrderCode ?? ''} is already completed with this part, so the approval cannot be undone`);
    }
  }

  static async reconcile(db: Db, issueId: bigint | number | string): Promise<void> {
    const id = BigInt(issueId as any);
    const issue = await db.issue.findUnique({ where: { id } });
    const live = await db.workOrderPartIssue.findFirst({ where: { storeIssueId: id, voidedAt: null } });

    const given = issue ? toNumber(issue.given_qty) : 0;
    const returned = issue ? toNumber(issue.rejected_damage_qty) : 0;
    const netQty = Math.max(0, given - returned);
    const isReturn = returned > 0;

    const wanted = !!issue && issue.issue_kind === 'MAINTENANCE' && !!issue.requirement_id && StoreDieselService.isApproved(issue.status) && netQty > 0;

    if (!wanted) {
      if (live) {
        if (!isReturn) {
          await this.assertUndoable(db, id);
        }
        await this.voidRow(db, live.id, isReturn ? `Store issue parts returned (${returned} returned)` : issue ? `Store issue ${issue.issue_no ?? id} is ${issue.status || 'Pending'}` : 'Store issue deleted');
        await refreshPartsCost(db, live.workOrderId);
      }
      return;
    }

    if (live && Number(live.quantity) === netQty && live.requirementId === issue!.requirement_id) return; // nothing changed
    if (live) await this.voidRow(db, live.id, isReturn ? `Store issue parts partially returned (${returned} returned)` : 'Store issue approval changed');

    const line = await db.workOrderPartRequirement.findUnique({ where: { id: issue!.requirement_id! } });
    if (!line) throw ApiError.badRequest('The part this issue was raised for no longer exists');
    if (issue!.firm_id === null) throw ApiError.badRequest('The issue has no project');

    const rate = await StockService.averageRate(db as any, { firmId: issue!.firm_id, name: issue!.product_name ?? line.itemName, groupHead: issue!.group_head });
    await db.workOrderPartIssue.create({
      data: {
        requirementId: line.id,
        workOrderId: line.workOrderId,
        storeIssueId: id,
        quantity: netQty,
        unitCost: rate,
        amount: rate !== null ? Math.round(netQty * rate * 100) / 100 : null,
      },
    });
    await refreshPartsCost(db, line.workOrderId);
  }

  static async reconcileMany(db: Db, issueIds: Array<bigint | number | string>): Promise<void> {
    for (const id of issueIds) await this.reconcile(db, id);
  }

  /** Used before an issue row is deleted, while the link still exists. */
  static async voidForIssue(db: Db, issueId: bigint | number | string, reason: string): Promise<void> {
    const live = await db.workOrderPartIssue.findFirst({ where: { storeIssueId: BigInt(issueId as any), voidedAt: null } });
    if (!live) return;
    await this.assertUndoable(db, issueId);
    await this.voidRow(db, live.id, reason);
    await refreshPartsCost(db, live.workOrderId);
  }

  private static async voidRow(db: Db, rowId: string, reason: string): Promise<void> {
    await db.workOrderPartIssue.update({ where: { id: rowId }, data: { voidedAt: new Date(), voidReason: reason.slice(0, 300) } });
  }
}

import { Prisma } from '@prisma/client';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { loadMachineInScope, resolveMachineWriteFirm } from '../../fleet/services/common';
import { StoreDieselService } from './storeDiesel.service';
import { StoreMaintenanceService } from './storeMaintenance.service';
import { normalizeItemName } from './itemRef.service';

/**
 * store_issue_kind_v1: what a Store issue is for.
 *   MATERIAL      issue to a contractor / site (today's form; every existing row)
 *   MAINTENANCE   machine parts issued to a machine, usually for a repair work order   (form: Phase 5)
 *   ASSET_DIESEL  diesel issued to a machine                                           (form: Phase 2)
 *
 * Rules, applied to the generic `issue` create / update:
 *  - only these three kinds;
 *  - the machine kinds need a machine the caller may see (same scope as the fleet screens), and a work order, if given, must belong
 *    to that machine;
 *  - a MATERIAL issue carries no machine fields (they are cleared);
 *  - until a kind's form exists it cannot be created: STORE_ISSUE_KINDS_ENABLED lists the enabled non-material kinds
 *    (comma separated, e.g. "ASSET_DIESEL,MAINTENANCE"); when the variable is not set at all, ASSET_DIESEL (released in Phase 2)
 *    is enabled. MATERIAL is always enabled.
 *  - MAINTENANCE (Phases 5 / 6): see prepareMaintenance.
 *  - ASSET_DIESEL (Phase 2): the issue belongs to the machine's working project (set automatically, a different one is a 400), the
 *    item is a DIESEL group-head item, litres > 0, the project's Store must hold that much (checked again on approval), and a
 *    meter reading is required for a machine with a meter (cleared for one without).
 */
export const ISSUE_KINDS = ['MATERIAL', 'MAINTENANCE', 'ASSET_DIESEL'] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const KIND_FIELDS = ['issue_kind', 'machine_id', 'work_order_id', 'meter_reading', 'requirement_id'] as const;

type Db = Prisma.TransactionClient;

export class IssueKindService {
  static enabledKinds(): Set<string> {
    const raw = process.env.STORE_ISSUE_KINDS_ENABLED;
    const list = raw === undefined ? 'ASSET_DIESEL,MAINTENANCE' : raw;
    return new Set(['MATERIAL', ...list.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)]);
  }

  /** Validate and normalise `data` (mutates it). `existing` is the current row on an update, null on a create. */
  static async prepare(db: Db, ctx: UserAuthContext, data: Record<string, any>, existing: Record<string, any> | null): Promise<void> {
    const touches = KIND_FIELDS.some((f) => data[f] !== undefined);
    if (existing && !touches) return;

    const kind = String(data.issue_kind ?? existing?.issue_kind ?? 'MATERIAL').toUpperCase();
    if (!(ISSUE_KINDS as readonly string[]).includes(kind)) throw ApiError.badRequest(`Unknown issue kind '${kind}'`);
    if (existing && data.issue_kind !== undefined && String(existing.issue_kind) !== kind) throw ApiError.badRequest('The kind of an issue cannot be changed');
    data.issue_kind = kind;

    if (kind === 'MATERIAL') {
      data.machine_id = null;
      data.work_order_id = null;
      data.meter_reading = null;
      data.requirement_id = null;
      return;
    }

    if (!existing && !this.enabledKinds().has(kind)) {
      throw new ApiError(409, `Issues of kind ${kind} are not available yet (their form is not released)`);
    }

    const machineId = String(data.machine_id ?? existing?.machine_id ?? '').trim();
    if (!machineId) throw ApiError.badRequest('A machine is required for this kind of issue');
    if (existing && data.machine_id !== undefined && String(existing.machine_id) !== machineId) throw ApiError.badRequest('The machine of an issue cannot be changed');
    const machine = await loadMachineInScope(db as any, ctx, machineId); // 404 when the caller cannot see the machine
    data.machine_id = machineId;

    if (existing && data.requirement_id !== undefined && String(existing.requirement_id ?? '') !== String(data.requirement_id ?? '')) {
      throw ApiError.badRequest('The work order part of an issue cannot be changed');
    }
    if (kind === 'ASSET_DIESEL' && !existing) await this.prepareDiesel(db, ctx, data, machine);
    if (kind === 'MAINTENANCE' && !existing) await this.prepareMaintenance(db, ctx, data, machine);

    const workOrderId = data.work_order_id ?? existing?.work_order_id ?? null;
    if (workOrderId) {
      const wo = await db.maintenanceWorkOrder.findUnique({ where: { id: String(workOrderId) }, select: { machineId: true } });
      if (!wo) throw ApiError.badRequest('Work order not found');
      if (wo.machineId !== machineId) throw ApiError.badRequest('That work order belongs to a different machine');
      data.work_order_id = String(workOrderId);
    }
  }

  private static async prepareDiesel(db: Db, ctx: UserAuthContext, data: Record<string, any>, machine: { id: string; firmId: bigint | null; readingUnit: string }): Promise<void> {
    if (normalizeItemName(data.group_head) !== 'diesel' || !String(data.product_name ?? '').trim()) {
      throw ApiError.badRequest('A diesel issue must be for a diesel item (group head DIESEL)');
    }
    const litres = Number(String(data.quantity ?? '').trim());
    if (!Number.isFinite(litres) || litres <= 0) throw ApiError.badRequest('Litres must be greater than zero');

    let requested: bigint | null = null;
    try {
      requested = data.firm_id !== undefined && data.firm_id !== null && data.firm_id !== '' ? BigInt(data.firm_id) : null;
    } catch {
      throw ApiError.badRequest('Invalid project');
    }
    const firmId = await resolveMachineWriteFirm(db as any, ctx, machine as any, requested); // the machine's working project
    data.firm_id = firmId;
    if (!data.firm_name) data.firm_name = (await db.firm.findUnique({ where: { id: firmId }, select: { firm_name: true } }))?.firm_name ?? null;

    if (machine.readingUnit === 'NONE' || data.meter_reading === null || data.meter_reading === undefined || data.meter_reading === '') {
      data.meter_reading = null;
    } else {
      const reading = Number(String(data.meter_reading ?? '').trim());
      data.meter_reading = Number.isFinite(reading) && reading >= 0 ? reading : null;
    }

    await StoreDieselService.assertStockFor(db, { firm_id: firmId, product_name: String(data.product_name), group_head: String(data.group_head), given_qty: null, status: null }, litres);
  }

  /**
   * MAINTENANCE (Phases 5 / 6): parts for a repair work order. The issue is against one part line of that work order, in the machine's
   * working project, for the line's item, and for no more than the line still needs (and the project's Store holds).
   */
  private static async prepareMaintenance(db: Db, ctx: UserAuthContext, data: Record<string, any>, machine: { id: string; firmId: bigint | null }): Promise<void> {
    const workOrderId = String(data.work_order_id ?? '').trim();
    const requirementId = String(data.requirement_id ?? '').trim();
    if (!workOrderId || !requirementId) throw ApiError.badRequest('A maintenance issue must be against a part of a repair work order');
    const line = await db.workOrderPartRequirement.findUnique({ where: { id: requirementId }, include: { workOrder: true } });
    if (!line || line.workOrderId !== workOrderId) throw ApiError.badRequest('That part is not on this work order');
    const wo = line.workOrder;
    if (wo.machineId !== machine.id) throw ApiError.badRequest('That work order belongs to a different machine');
    if (line.status !== 'OPEN') throw ApiError.conflict('That part is no longer needed on the work order');
    if (wo.materialRequired !== true || ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED'].includes(wo.status)) {
      throw ApiError.conflict('This work order is not waiting for parts');
    }

    if (data.product_name && normalizeItemName(data.product_name) !== normalizeItemName(line.itemName)) throw ApiError.badRequest(`This part line is for ${line.itemName}`);
    if (data.group_head && normalizeItemName(data.group_head) !== normalizeItemName(line.groupHead)) throw ApiError.badRequest(`This part line is under group head ${line.groupHead}`);
    data.product_name = line.itemName;
    data.group_head = line.groupHead;
    data.uom = data.uom ?? line.uom;
    data.item_id = line.itemId;
    data.meter_reading = null;

    const qty = Number(String(data.quantity ?? '').trim());
    if (!Number.isFinite(qty) || qty <= 0) throw ApiError.badRequest('Quantity must be greater than zero');

    let requested: bigint | null = null;
    try {
      requested = data.firm_id !== undefined && data.firm_id !== null && data.firm_id !== '' ? BigInt(data.firm_id) : null;
    } catch {
      throw ApiError.badRequest('Invalid project');
    }
    const firmId = await resolveMachineWriteFirm(db as any, ctx, machine as any, requested);
    data.firm_id = firmId;
    if (!data.firm_name) data.firm_name = (await db.firm.findUnique({ where: { id: firmId }, select: { firm_name: true } }))?.firm_name ?? null;

    const open = Number(line.quantity) - (await StoreMaintenanceService.issuedFor(db, line.id)) - (await StoreMaintenanceService.pendingFor(db, line.id));
    if (qty > open + 0.0005) throw new ApiError(409, `${line.itemName}: the work order needs only ${Math.max(0, open)} more (the rest is already issued or waiting for approval)`);

    await StoreDieselService.assertStockFor(db, { firm_id: firmId, product_name: line.itemName, group_head: line.groupHead, given_qty: null, status: null }, qty, line.uom ?? '');
  }

  /** Bulk updates (`where` + `data`) must not move an issue between kinds or machines. */
  static assertNoKindChange(data: Record<string, any>): void {
    if (KIND_FIELDS.some((f) => data[f] !== undefined)) throw ApiError.badRequest('The kind, machine and work order of an issue cannot be changed in bulk');
  }
}

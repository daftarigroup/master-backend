import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { resolveMachineWriteFirm } from '../../fleet/services/common';
import { ItemRefService, normalizeItemName, pickItem } from '../../store/services/itemRef.service';
import { SequenceService } from '../../store/services/sequence.service';
import { InventoryStockService } from '../../store/services/inventoryStock.service';
import { PcReportService } from '../../store/services/pcReport.service';
import { invalidateTableCache } from '../../store/controllers/generic.controller';
import { isOpenStatus } from '../lib/workOrderAccess';
import { PartsSummary, partsBlockMessage, summarizeParts } from '../lib/partsSummary';

type Tx = Prisma.TransactionClient;

/**
 * Phases 5 and 6: an in-house repair lists the parts it needs (Store items), the Store indent is raised from that list, and an approved
 * Store issue (kind MAINTENANCE, see storeMaintenance.service) is what makes a part "issued". A repair with `materialRequired = true`
 * cannot be completed until every listed part is fully issued (assertPartsIssued, used by markDone, processRepair and approve).
 * Outsourced repairs (the vendor supplies the material) and orders with no decision (`materialRequired` null) are never gated.
 */
const LINE_INCLUDE = {
  issues: { where: { voidedAt: null } },
  storeIssues: { select: { id: true, quantity: true, status: true } },
  indents: { select: { id: true, indent_number: true, approved_vendor_name: true, vendor_name1: true } },
} satisfies Prisma.WorkOrderPartRequirementInclude;
const PART_TYPES = ['REPAIR', 'BREAKDOWN'];
const isOutsourced = (wo: { typeOfWork?: string | null; outsourceStatus?: string | null }) =>
  wo.typeOfWork === 'out_source' || wo.typeOfWork === 'outhouse' || !!wo.outsourceStatus;
const isDecided = (status: unknown): boolean => {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'approved' || s === 'completed' || s === 'rejected';
};

type LoadedWorkOrder = Prisma.MaintenanceWorkOrderGetPayload<{ include: { machine: { select: { id: true; name: true; firmId: true } } } }>;

export interface PartInput {
  itemName: string;
  groupHead?: string | null;
  quantity: number | string;
  note?: string | null;
}

function parseQuantity(v: unknown): number {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) throw ApiError.badRequest('Quantity must be greater than zero');
  if (Math.round(n * 1000) / 1000 !== n) throw ApiError.badRequest('Quantity can have at most 3 decimals');
  if (n > 999999) throw ApiError.badRequest('Quantity is too large');
  return n;
}

export const workOrderPartsService = {
  async summaryOf(db: Tx | typeof prisma, workOrderId: string): Promise<PartsSummary> {
    const rows = await db.workOrderPartRequirement.findMany({ where: { workOrderId, status: 'OPEN' }, orderBy: { createdAt: 'asc' }, include: LINE_INCLUDE });
    return summarizeParts(rows);
  },

  /** 409 when an in-house repair that needs material still has parts that are not issued. */
  async assertPartsIssued(db: Tx | typeof prisma, wo: { id: string; type: string; materialRequired?: boolean | null; typeOfWork?: string | null; outsourceStatus?: string | null }): Promise<void> {
    if (!PART_TYPES.includes(wo.type) || wo.materialRequired !== true || isOutsourced(wo)) return;
    const message = partsBlockMessage(wo, await this.summaryOf(db, wo.id));
    if (message) throw new ApiError(409, message, [{ code: 'PARTS_NOT_ISSUED' }]);
  },

  async load(db: Tx | typeof prisma, workOrderId: string) {
    const wo = await db.maintenanceWorkOrder.findUnique({
      where: { id: workOrderId },
      include: { machine: { select: { id: true, name: true, firmId: true } } },
    });
    if (!wo) throw ApiError.notFound('Work order not found');
    return wo;
  },

  assertEditable(wo: { type: string; status: string; typeOfWork?: string | null; outsourceStatus?: string | null }) {
    if (!PART_TYPES.includes(wo.type)) throw ApiError.badRequest('Parts can be listed only on a repair or breakdown work order');
    if (!isOpenStatus(wo.status) || wo.status === 'PENDING_APPROVAL') throw ApiError.conflict(`Parts cannot be changed while the work order is ${wo.status.toLowerCase().replace(/_/g, ' ')}`);
    if (isOutsourced(wo)) throw ApiError.conflict('This repair is outsourced: the vendor supplies the parts');
  },

  async dto(workOrderId: string) {
    const wo = await prisma.maintenanceWorkOrder.findUnique({ where: { id: workOrderId }, select: { materialRequired: true } });
    return { materialRequired: wo?.materialRequired ?? null, parts: await this.summaryOf(prisma, workOrderId) };
  },

  /** The Store item for a name + group head in the machine's working project. */
  async resolveItem(db: Tx, firmId: bigint, itemName: string, groupHead?: string | null) {
    const name = String(itemName ?? '').trim();
    if (!name) throw ApiError.badRequest('Part name is required');
    const itemId = pickItem(await ItemRefService.candidates(db, firmId, name), groupHead);
    if (itemId === null) {
      throw ApiError.badRequest(`'${name}' is not a Store item of this project${groupHead ? ` under group head '${groupHead}'` : ''}. Add it in the Master Registry first`);
    }
    const item = await db.item.findUnique({ where: { id: itemId }, include: { group_head: { select: { name: true } }, uom: { select: { name: true } } } });
    return { itemId, itemName: item!.item_name, groupHead: item!.group_head?.name ?? String(groupHead ?? ''), uom: item!.uom?.name ?? null };
  },

  async addLine(db: Tx, ctx: UserAuthContext, wo: LoadedWorkOrder, input: PartInput, userId: bigint | null) {
    const quantity = parseQuantity(input.quantity);
    const firmId = await resolveMachineWriteFirm(db as any, ctx, wo.machine, null);
    const item = await this.resolveItem(db, firmId, input.itemName, input.groupHead);
    const existing = await db.workOrderPartRequirement.findFirst({ where: { workOrderId: wo.id, status: 'OPEN', itemId: item.itemId } });
    if (existing) throw ApiError.conflict(`${item.itemName} is already on this work order; change its quantity instead`);
    return db.workOrderPartRequirement.create({
      data: { workOrderId: wo.id, firmId, ...item, quantity, note: input.note?.trim() || null, createdById: userId },
    });
  },

  async list(workOrderId: string) {
    await this.load(prisma, workOrderId);
    return this.dto(workOrderId);
  },

  async add(ctx: UserAuthContext, workOrderId: string, input: PartInput, userId: bigint | null) {
    await prisma.$transaction(async (tx) => {
      const wo = await this.load(tx, workOrderId);
      this.assertEditable(wo);
      await this.addLine(tx, ctx, wo, input, userId);
      if (wo.materialRequired !== true) await tx.maintenanceWorkOrder.update({ where: { id: wo.id }, data: { materialRequired: true } });
    });
    return this.dto(workOrderId);
  },

  async update(workOrderId: string, partId: string, input: { quantity?: number | string; note?: string | null }) {
    await prisma.$transaction(async (tx) => {
      const wo = await this.load(tx, workOrderId);
      this.assertEditable(wo);
      const line = await tx.workOrderPartRequirement.findFirst({ where: { id: partId, workOrderId, status: 'OPEN' }, include: LINE_INCLUDE });
      if (!line) throw ApiError.notFound('Part not found on this work order');
      const data: Prisma.WorkOrderPartRequirementUpdateInput = {};
      if (input.quantity !== undefined) {
        const quantity = parseQuantity(input.quantity);
        const issued = line.issues.reduce((s, i) => s + Number(i.quantity), 0);
        if (quantity < issued) throw ApiError.conflict(`${issued} of ${line.itemName} is already issued; the quantity cannot go below that`);
        data.quantity = quantity;
      }
      if (input.note !== undefined) data.note = input.note?.trim() || null;
      await tx.workOrderPartRequirement.update({ where: { id: partId }, data });
    });
    return this.dto(workOrderId);
  },

  async remove(workOrderId: string, partId: string, reason?: string | null) {
    await prisma.$transaction(async (tx) => {
      const wo = await this.load(tx, workOrderId);
      this.assertEditable(wo);
      const line = await tx.workOrderPartRequirement.findFirst({ where: { id: partId, workOrderId, status: 'OPEN' }, include: LINE_INCLUDE });
      if (!line) throw ApiError.notFound('Part not found on this work order');
      if (line.issues.length > 0) throw ApiError.conflict(`${line.itemName} has already been issued from the Store and cannot be removed`);
      if ((line.storeIssues ?? []).some((si) => !isDecided(si.status))) {
        throw ApiError.conflict(`${line.itemName} is currently waiting for Store approval and cannot be removed`);
      }
      if (line.indentNumber) {
        throw ApiError.conflict(`${line.itemName} has already been indented (${line.indentNumber}) and cannot be removed`);
      }
      await tx.workOrderPartRequirement.update({ where: { id: partId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason?.trim() || 'Removed from the work order' } });
    });
    return this.dto(workOrderId);
  },

  /**
   * The in-house "Material required?" answer (called from processRepair, inside its transaction).
   *   true   saves / updates the listed parts (parts already on the order are kept; a listed item updates its quantity)
   *   false  clears the list; refused once anything has been issued
   */
  async setMaterial(tx: Tx, ctx: UserAuthContext, workOrderId: string, required: boolean, parts: PartInput[] | undefined, userId: bigint | null): Promise<void> {
    const wo = await this.load(tx, workOrderId);
    this.assertEditable(wo);
    const lines = await tx.workOrderPartRequirement.findMany({ where: { workOrderId, status: 'OPEN' }, include: LINE_INCLUDE });

    if (!required) {
      if (lines.some((l) => l.issues.length > 0)) {
        throw ApiError.conflict('Parts have already been issued from the Store for this repair, so it cannot be changed to "material not required"');
      }
      if (lines.some((l) => (l.storeIssues ?? []).some((si) => !isDecided(si.status)))) {
        throw ApiError.conflict('Parts are currently waiting for Store approval for this repair, so it cannot be changed to "material not required"');
      }
      if (lines.some((l) => Boolean(l.indentNumber))) {
        throw ApiError.conflict('Store indent has already been raised for this repair; cancel the indent before marking as direct repair');
      }
      await tx.workOrderPartRequirement.updateMany({ where: { workOrderId, status: 'OPEN' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Material not required' } });
      await tx.maintenanceWorkOrder.update({ where: { id: workOrderId }, data: { materialRequired: false } });
      return;
    }

    for (const p of parts ?? []) {
      const firmId = await resolveMachineWriteFirm(tx as any, ctx, wo.machine, null);
      const item = await this.resolveItem(tx, firmId, p.itemName, p.groupHead);
      const same = lines.find((l) => l.itemId === item.itemId || (normalizeItemName(l.itemName) === normalizeItemName(item.itemName) && normalizeItemName(l.groupHead) === normalizeItemName(item.groupHead)));
      if (same) {
        const quantity = parseQuantity(p.quantity);
        const issued = same.issues.reduce((s, i) => s + Number(i.quantity), 0);
        if (quantity < issued) throw ApiError.conflict(`${issued} of ${same.itemName} is already issued; the quantity cannot go below that`);
        await tx.workOrderPartRequirement.update({ where: { id: same.id }, data: { quantity, ...(p.note !== undefined ? { note: p.note?.trim() || null } : {}) } });
      } else {
        await this.addLine(tx, ctx, wo, p, userId);
      }
    }
    const count = await tx.workOrderPartRequirement.count({ where: { workOrderId, status: 'OPEN' } });
    if (count === 0) throw ApiError.badRequest('List at least one part, or choose "material not required"');
    await tx.maintenanceWorkOrder.update({ where: { id: workOrderId }, data: { materialRequired: true } });
  },

  /** A cancelled / skipped work order no longer waits for parts that were never issued. */
  async cancelUnissued(tx: Tx, workOrderId: string, reason: string): Promise<void> {
    await tx.workOrderPartRequirement.updateMany({
      where: { workOrderId, status: 'OPEN', issues: { none: { voidedAt: null } } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.slice(0, 300) },
    });
  },

  /**
   * One click from the work order: raises the Store indent for the listed parts that are not indented yet (or all of them again).
   * The indent rows look exactly like the ones the Create Indent page writes, plus the work order / part link.
   */
  async raiseIndent(ctx: UserAuthContext, workOrderId: string, userId: bigint | null, body: { again?: boolean; partIds?: string[] }) {
    const created = await prisma.$transaction(async (tx) => {
      const wo = await tx.maintenanceWorkOrder.findUnique({ where: { id: workOrderId }, include: { machine: { select: { id: true, name: true, firmId: true } } } });
      if (!wo) throw ApiError.notFound('Work order not found');
      this.assertEditable(wo);
      if (wo.materialRequired !== true) throw ApiError.conflict('Mark this repair as "material required" and list the parts first');

      const lines = (await tx.workOrderPartRequirement.findMany({ where: { workOrderId, status: 'OPEN' }, orderBy: { createdAt: 'asc' }, include: LINE_INCLUDE })).filter((l) => !body.partIds?.length || body.partIds.includes(l.id));
      const todo = lines
        .map((l) => ({ line: l, remaining: Number(l.quantity) - l.issues.reduce((s, i) => s + Number(i.quantity), 0) }))
        .filter((x) => x.remaining > 0.0005 && (body.again || !x.line.indentNumber));
      if (todo.length === 0) throw ApiError.conflict('Nothing to indent: every listed part is already indented or issued');

      const firmId = await resolveMachineWriteFirm(tx as any, ctx, wo.machine, null);
      const firm = await tx.firm.findUnique({ where: { id: firmId }, select: { firm_name: true } });
      const user = userId ? await tx.user.findUnique({ where: { id: userId }, select: { name: true, user_name: true } }) : null;

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7770007)`; // one indent number at a time (the number is MAX + 1)
      const indentNumber = await new SequenceService().generateIndentNumber(tx);
      const now = new Date();
      const critical = wo.priority === 'HIGH' || wo.priority === 'CRITICAL';
      const inventory = new InventoryStockService();

      for (const { line, remaining } of todo) {
        await tx.indent.create({
          data: {
            timestamp: now,
            planned1: now,
            indent_number: indentNumber,
            indenter_name: user?.name || user?.user_name || null,
            area_of_use: 'Maintenance & repair',
            group_head: line.groupHead,
            product_name: line.itemName,
            quantity: String(remaining),
            min_stock_qty: '0',
            uom: line.uom,
            firm_name: firm?.firm_name ?? null,
            firm_id: firmId,
            item_id: line.itemId,
            specifications: `${wo.workOrderCode ?? 'Work order'} - ${wo.machine.name}${line.note ? ` - ${line.note}` : ''}`,
            indent_status: critical ? 'Critical' : 'Non-Critical',
            expected_req_date: wo.actualDueDate,
            attachment: '',
            indent_url: '',
            status: 'Pending',
            work_order_id: wo.id,
            wo_part_id: line.id,
          },
        });
        await inventory.syncInventoryItemAggregations(line.itemName, tx);
        await tx.workOrderPartRequirement.update({ where: { id: line.id }, data: { indentNumber } });
      }
      await new PcReportService().recalculateStageKpis('Should Need Offer Or Regular', tx);
      await tx.workOrderStatusLog.create({
        data: { workOrderId, fromStatus: wo.status, toStatus: wo.status, note: `Indent ${indentNumber} raised for ${todo.length} part${todo.length > 1 ? 's' : ''}`, changedByUserId: userId },
      });
      return { indentNumber, count: todo.length };
    });
    invalidateTableCache('indent');
    return { ...created, ...(await this.dto(workOrderId)) };
  }
};

/**
 * Inventory & Stock Calculation Service
 * Re-engineers database inventory aggregation functions and balance math into TypeScript.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

export class InventoryStockService {
  private prisma: any;

  constructor(prismaClient?: any) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * Calculates pending_po_qty = max(0, quantity - po_qty)
   */
  public static calculatePendingPoQty(
    quantity: number | string,
    poQty: number | string,
    _tx?: Prisma.TransactionClient
  ): number {
    const qty = typeof quantity === 'string' ? parseInt(quantity, 10) || 0 : quantity || 0;
    const po = typeof poQty === 'string' ? parseInt(poQty, 10) || 0 : poQty || 0;
    return Math.max(0, qty - po);
  }

  /**
   * Calculates current stock = received_qty - return_quantity - out_quantity
   */
  public static calculateInventoryCurrent(
    receivedQty: number | string,
    returnQty: number | string,
    outQty: number | string,
    _tx?: Prisma.TransactionClient
  ): number {
    const rec = typeof receivedQty === 'string' ? parseInt(receivedQty, 10) || 0 : receivedQty || 0;
    const ret = typeof returnQty === 'string' ? parseInt(returnQty, 10) || 0 : returnQty || 0;
    const out = typeof outQty === 'string' ? parseInt(outQty, 10) || 0 : outQty || 0;
    return rec - ret - out;
  }

  /**
   * Recalculates total inventory aggregations for a given product name.
   */
  public async syncInventoryItemAggregations(
    productName: string,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    if (!productName) return;
    const db = tx || this.prisma || prisma;

    // 1. Indented quantity & Approved quantity from indent
    const indentStats: any[] = await db.$queryRaw`
      SELECT 
        COALESCE(SUM(CAST(NULLIF(quantity, '') AS INTEGER)), 0) as indented,
        COALESCE(SUM(CAST(NULLIF(approved_quantity, '') AS INTEGER)), 0) as approved
      FROM indent
      WHERE product_name = ${productName}
    `;

    // 2. Purchase quantity & Received quantity & Return quantity from store_in
    const storeInStats: any[] = await db.$queryRaw`
      SELECT 
        COALESCE(SUM(CAST(NULLIF(qty, '') AS NUMERIC)), 0) as purchase_quantity,
        COALESCE(SUM(CAST(NULLIF(received_quantity, '') AS NUMERIC)), 0) as received_quantity,
        COALESCE(SUM(CASE WHEN status = 'Reject' THEN CAST(NULLIF(received_quantity, '') AS NUMERIC) ELSE 0 END), 0) as return_quantity
      FROM store_in
      WHERE product_name = ${productName}
    `;

    // 3. Request quantity & Out quantity from issue
    const issueStats: any[] = await db.$queryRaw`
      SELECT 
        COALESCE(SUM(CAST(NULLIF(quantity, '') AS NUMERIC)), 0) as request_quantity,
        COALESCE(SUM(CAST(NULLIF(given_qty, '') AS NUMERIC)), 0) as out_quantity
      FROM issue
      WHERE product_name = ${productName}
    `;

    const indented = Number(indentStats?.[0]?.indented || 0);
    const approved = Number(indentStats?.[0]?.approved || 0);

    const purchase_quantity = Number(storeInStats?.[0]?.purchase_quantity || 0);
    const received_quantity = Number(storeInStats?.[0]?.received_quantity || 0);
    const return_quantity = Number(storeInStats?.[0]?.return_quantity || 0);

    const request_quantity = Number(issueStats?.[0]?.request_quantity || 0);
    const out_quantity = Number(issueStats?.[0]?.out_quantity || 0);

    const current = received_quantity - return_quantity - out_quantity;

    await db.$executeRaw`
      UPDATE inventory
      SET 
        indented = ${indented},
        approved = ${approved},
        purchase_quantity = ${purchase_quantity},
        received_quantity = ${received_quantity},
        return_quantity = ${return_quantity},
        request_quantity = ${request_quantity},
        out_quantity = ${out_quantity},
        current = ${String(current)}
      WHERE item_name = ${productName}
    `;
  }

  /**
   * Recalculates PO Master paid amount and status when fullkitting/payment amount updates.
   */
  public async updatePoPaidAmount(
    indentNumber: string,
    fullKittingAmount: number,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    if (!indentNumber || fullKittingAmount <= 0) return;
    const db = tx || this.prisma || prisma;

    const poRecords: any[] = await db.$queryRaw`
      SELECT id, total_po_amount, total_paid_amount FROM po_master WHERE internal_code = ${indentNumber} LIMIT 1
    `;

    if (poRecords && poRecords.length > 0) {
      const po = poRecords[0];
      const totalPoAmount = Number(po.total_po_amount || 0);
      const currentPaid = Number(po.total_paid_amount || 0);

      const newPaidAmount = currentPaid + fullKittingAmount;
      const outstandingAmount = totalPoAmount - newPaidAmount;
      const newStatus = outstandingAmount <= 0 ? 'Complete' : 'Pending';

      await db.$executeRaw`
        UPDATE po_master
        SET 
          total_paid_amount = ${newPaidAmount},
          outstanding_amount = ${outstandingAmount},
          status = ${newStatus}
        WHERE id = ${po.id}
      `;
    }
  }

  /**
   * Recalculates remaining lifting quantity (pending_lift_qty) and lifting_status for an indent.
   */
  public async calculatePendingLiftQty(
    indentNumber: string,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    if (!indentNumber) return;
    const db = tx || this.prisma || prisma;

    const indents: any[] = await db.$queryRaw`
      SELECT id, quantity FROM indent WHERE indent_number = ${indentNumber} LIMIT 1
    `;

    if (!indents || indents.length === 0) {
      console.warn(`[calculatePendingLiftQty] Indent '${indentNumber}' not found.`);
      return;
    }

    const indent = indents[0];
    const indentQuantity = parseFloat(indent.quantity || '0') || 0;

    const storeInStats: any[] = await db.$queryRaw`
      SELECT COALESCE(SUM(CAST(NULLIF(received_quantity, '') AS NUMERIC)), 0) as total_received
      FROM store_in
      WHERE indent_no = ${indentNumber}
    `;

    const totalReceived = Number(storeInStats?.[0]?.total_received || 0);
    const pendingLiftQty = Math.max(0, indentQuantity - totalReceived);
    const liftingStatus = pendingLiftQty <= 0 ? 'Complete' : 'Pending';

    await db.$executeRaw`
      UPDATE indent
      SET 
        pending_lift_qty = ${String(pendingLiftQty)},
        lifting_status = ${liftingStatus}
      WHERE indent_number = ${indentNumber}
    `;
  }
}

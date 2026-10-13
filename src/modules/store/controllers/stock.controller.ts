import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import type { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { StockService } from '../services/stock.service';
import { normalizeItemName } from '../services/itemRef.service';

export class StockController {
  // GET /api/store/inventory/stock?firmId=&item=&groupHead=
  // Stock per Store item (project + group head + name). Used by the issue forms of the Asset / Maintenance & Repair integration.
  // A user can only read projects in their token's permittedFirms (SUPER_ADMIN reads all).
  getStock = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    const rawFirm = String(req.query.firmId ?? '').trim();
    if (rawFirm && !/^\d+$/.test(rawFirm)) throw new ApiError(400, 'firmId must be a project id');
    const permitted = user?.role === 'SUPER_ADMIN' ? null : new Set((user?.permittedFirms ?? []).map(String));
    if (rawFirm && permitted && !permitted.has(rawFirm)) throw new ApiError(403, 'You have no access to that project');

    const item = String(req.query.item ?? '').trim();
    const groupHead = normalizeItemName(req.query.groupHead);
    let rows = await StockService.compute(prisma as any, { firmId: rawFirm || null, name: item || null });
    if (permitted) rows = rows.filter((r) => r.firmId !== null && permitted.has(String(r.firmId)));
    if (groupHead) rows = rows.filter((r) => normalizeItemName(r.groupHead) === groupHead);

    res.json({
      success: true,
      data: rows.map((r) => ({
        firmId: r.firmId === null ? null : String(r.firmId),
        itemId: r.itemId === null ? null : String(r.itemId),
        itemName: r.itemName,
        groupHead: r.groupHead,
        opening: r.opening,
        lifted: r.lifted,
        transferIn: r.transferIn + r.transfersIn,
        transferOut: r.transfersOut,
        purchaseReturn: r.purchaseReturn,
        issued: r.issued,
        issueReturn: r.issueReturn,
        current: r.current,
      })),
    });
  });
}

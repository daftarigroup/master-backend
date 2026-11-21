import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';

const dto = (r: any) => ({ ...r, id: r.id, vendor_id: r.vendor_id != null ? String(r.vendor_id) : null });

export const contractVendorController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    const rows = await prisma.pMSContractVendor.findMany({ orderBy: { vendor_name: 'asc' } });
    res.json({ success: true, data: rows.map(dto) });
  }),
  // Upsert by vendor name
  save: asyncHandler(async (req: Request, res: Response) => {
    const name = String(req.body?.vendor_name || '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!name) throw new ApiError(400, 'vendor_name is required');
    if (items.length === 0) throw new ApiError(400, 'At least one item is required');
    const vendor_id = req.body?.vendor_id ? BigInt(req.body.vendor_id) : null;
    const row = await prisma.pMSContractVendor.upsert({
      where: { vendor_name: name },
      create: { vendor_name: name, vendor_id, items },
      update: { vendor_id, items },
    });
    res.json({ success: true, data: dto(row) });
  }),
  remove: asyncHandler(async (req: Request, res: Response) => {
    await prisma.pMSContractVendor.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  }),
};

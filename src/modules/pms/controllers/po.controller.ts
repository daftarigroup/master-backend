import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { pmsProcurementService } from '../services/procurement.service';

export class POController {
  list = asyncHandler(async (req: Request, res: Response) => {
    const pos = await pmsProcurementService.listPOs(req.query);
    res.json({ success: true, data: pos });
  });

  getById = asyncHandler(async (req: Request, res: Response) => {
    const po = await pmsProcurementService.getPO(req.params.id);
    res.json({ success: true, data: po });
  });

  create = asyncHandler(async (req: Request, res: Response) => {
    const po = await pmsProcurementService.createPO(req.body);
    res.status(201).json({ success: true, data: po, message: `PO ${po.po_number} created successfully` });
  });
}

export const poController = new POController();

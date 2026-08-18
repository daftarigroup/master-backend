import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ledgerService } from '../services/ledger.service';

export const ledgerController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const data = await ledgerService.listLedger(req.query as any);
    res.json({ success: true, data });
  }),

  getBalance: asyncHandler(async (req: Request, res: Response) => {
    const data = await ledgerService.getBalance(String(req.params.personName));
    res.json({ success: true, data });
  }),
};

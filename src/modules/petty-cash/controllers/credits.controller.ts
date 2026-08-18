import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { creditsService } from '../services/credits.service';

export const creditsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const data = await creditsService.listCredits(req.query);
    res.json({ success: true, data });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await creditsService.getCreditById(String(req.params.id));
    res.json({ success: true, data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await creditsService.createCredit(req.body);
    res.status(201).json({ success: true, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await creditsService.updateCredit(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),
};

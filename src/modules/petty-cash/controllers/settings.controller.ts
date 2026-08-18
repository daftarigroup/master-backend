import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { settingsService } from '../services/settings.service';

export const settingsController = {
  get: asyncHandler(async (_req: Request, res: Response) => {
    const data = await settingsService.getSettings();
    res.json({ success: true, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await settingsService.updateSettings(req.body);
    res.json({ success: true, data });
  }),

  addPaymentMode: asyncHandler(async (req: Request, res: Response) => {
    const data = await settingsService.addPaymentMode(req.body.name);
    res.json({ success: true, data });
  }),

  removePaymentMode: asyncHandler(async (req: Request, res: Response) => {
    const data = await settingsService.removePaymentMode(String(req.params.name));
    res.json({ success: true, data });
  }),
};

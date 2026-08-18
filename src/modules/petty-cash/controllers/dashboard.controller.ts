import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { dashboardService } from '../services/dashboard.service';

export const dashboardController = {
  getSummary: asyncHandler(async (_req: Request, res: Response) => {
    const data = await dashboardService.getSummary();
    res.json({ success: true, data });
  }),
};

import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { dailyMachineLogService } from '../services/dailyMachineLog.service';

export const dailyMachineLogController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { data, pagination } = await dailyMachineLogService.list(req.query);
    res.json({ success: true, data, pagination });
  }),
  stats: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await dailyMachineLogService.stats();
    res.json({ success: true, data });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await dailyMachineLogService.create(req.body);
    res.status(201).json({ success: true, data });
  }),
};

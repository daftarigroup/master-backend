import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { currentUserContext } from '../../../utils/currentUser';
import { reportsService } from '../services/reports.service';

export const reportsController = {
  costAnalysis: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await reportsService.costAnalysis(currentUserContext(req), req.query as any);
    res.json({ success: true, data });
  }),
  machineReliability: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await reportsService.machineReliability(currentUserContext(req), req.query as any);
    res.json({ success: true, data });
  }),
};

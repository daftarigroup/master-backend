import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { currentUserId } from '../../../utils/currentUser';
import { breakdownService } from '../services/breakdown.service';

export const breakdownController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { data, pagination } = await breakdownService.list(req.query);
    res.json({ success: true, data, pagination });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await breakdownService.create(req.body, currentUserId(req));
    res.status(201).json({ success: true, data });
  }),
  resolve: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await breakdownService.resolve(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),
  updateStatus: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await breakdownService.setStatus(String(req.params.id), req.body.status);
    res.json({ success: true, data });
  }),
};

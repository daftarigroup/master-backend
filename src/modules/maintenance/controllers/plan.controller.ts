import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { currentUserId } from '../../../utils/currentUser';
import { planService } from '../services/plan.service';

export const planController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { data, pagination } = await planService.list(req.query);
    res.json({ status: 'success', data, pagination });
  }),
  getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await planService.getById(String(req.params.id));
    res.json({ status: 'success', data });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await planService.create(req.body, currentUserId(req));
    res.status(201).json({ status: 'success', data });
  }),
  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await planService.update(String(req.params.id), req.body);
    res.json({ status: 'success', data });
  }),
  pause: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await planService.setStatus(String(req.params.id), 'PAUSED');
    res.json({ status: 'success', data });
  }),
  resume: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await planService.setStatus(String(req.params.id), 'ACTIVE');
    res.json({ status: 'success', data });
  }),
  archive: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await planService.setStatus(String(req.params.id), 'ARCHIVED');
    res.json({ status: 'success', data });
  }),
};

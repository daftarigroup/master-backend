import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { activityTypeService } from '../services/activityType.service';

export const activityTypeController = {
  list: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await activityTypeService.list();
    res.json({ success: true, data });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await activityTypeService.create(req.body.name);
    res.status(201).json({ success: true, data });
  }),
  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await activityTypeService.delete(String(req.params.id));
    res.status(204).send();
  }),
};

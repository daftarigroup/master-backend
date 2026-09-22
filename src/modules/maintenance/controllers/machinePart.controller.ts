import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { machinePartService } from '../services/machinePart.service';

export const machinePartController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { data, pagination } = await machinePartService.list(req.query);
    res.json({ status: 'success', data, pagination });
  }),
  getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await machinePartService.getById(String(req.params.id));
    res.json({ success: true, data });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await machinePartService.create(req.body);
    res.status(201).json({ success: true, data });
  }),
  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await machinePartService.update(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),
  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await machinePartService.delete(String(req.params.id));
    res.status(204).send();
  }),
};

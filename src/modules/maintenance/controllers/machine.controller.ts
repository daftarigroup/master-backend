import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { machineService } from '../services/machine.service';

export const machineController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { data, pagination } = await machineService.list(req.query);
    res.json({ status: 'success', data, pagination });
  }),
  getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await machineService.getById(String(req.params.id));
    res.json({ status: 'success', data });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await machineService.create(req.body);
    res.status(201).json({ status: 'success', data });
  }),
  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await machineService.update(String(req.params.id), req.body);
    res.json({ status: 'success', data });
  }),
  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await machineService.delete(String(req.params.id));
    res.status(204).send();
  }),
};

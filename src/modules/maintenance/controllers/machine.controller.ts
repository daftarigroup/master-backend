import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { currentUserContext } from '../../../utils/currentUser';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { machineService } from '../services/machine.service';

// Envelope stays `{ status: 'success', data }` here because the existing frontend reads it; the
// new fleet endpoints use `{ success, data, error }`.
export const machineController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { data, pagination } = await machineService.list(req.query, currentUserContext(req));
    res.json({ status: 'success', data, pagination });
  }),
  getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await machineService.getById(String(req.params.id), currentUserContext(req));
    res.json({ status: 'success', data });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await machineService.create(req.body, currentUserContext(req));
    res.status(201).json({ status: 'success', data });
  }),
  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await machineService.update(String(req.params.id), req.body, currentUserContext(req));
    res.json({ status: 'success', data });
  }),
  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await machineService.delete(String(req.params.id), currentUserContext(req));
    res.status(204).send();
  }),
};

import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { projectMasterService } from '../services/projectMaster.service';

export const projectMasterController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const data = await projectMasterService.listEntries(req.query.type as string | undefined);
    res.json({ success: true, data });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await projectMasterService.getEntryById(String(req.params.id));
    res.json({ success: true, data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await projectMasterService.createEntry(req.body);
    res.status(201).json({ success: true, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await projectMasterService.updateEntry(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    await projectMasterService.deleteEntry(String(req.params.id));
    res.json({ success: true, message: 'Master entry deleted' });
  }),
};

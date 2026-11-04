import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { pmsService } from '../services/project.service';

export class MinorController {
  list = asyncHandler(async (req: Request, res: Response) => {
    const minors = await pmsService.listMinors(String(req.params.id));
    res.json({ success: true, data: minors });
  });

  create = asyncHandler(async (req: Request, res: Response) => {
    const minor = await pmsService.createMinor(String(req.params.id), req.body);
    res.status(201).json({ success: true, data: minor, message: 'Minor created successfully' });
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const minor = await pmsService.updateMinor(String(req.params.minorId), req.body);
    res.json({ success: true, data: minor, message: 'Minor updated successfully' });
  });

  delete = asyncHandler(async (req: Request, res: Response) => {
    await pmsService.deleteMinor(String(req.params.minorId));
    res.json({ success: true, message: 'Minor deleted successfully' });
  });

  getSchedule = asyncHandler(async (req: Request, res: Response) => {
    const schedule = await pmsService.getSchedule(String(req.params.minorId));
    res.json({ success: true, data: schedule });
  });

  upsertSchedule = asyncHandler(async (req: Request, res: Response) => {
    const schedule = await pmsService.upsertSchedule(String(req.params.minorId), req.body);
    res.json({ success: true, data: schedule, message: 'Schedule updated successfully' });
  });
}

export const minorController = new MinorController();

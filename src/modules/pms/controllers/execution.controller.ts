import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { pmsService } from '../services/project.service';

export class ExecutionController {
  // DPR Executions
  listExecutions = asyncHandler(async (req: Request, res: Response) => {
    const stageNumber = req.query.stage_number !== undefined ? Number(req.query.stage_number) : undefined;
    const records = await pmsService.listExecutions(String(req.params.id), stageNumber);
    res.json({ success: true, data: records });
  });

  createExecution = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.createExecution(String(req.params.id), req.body);
    res.status(201).json({ success: true, data: record, message: 'Execution entry created successfully' });
  });

  updateExecution = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.updateExecution(String(req.params.entryId), req.body);
    res.json({ success: true, data: record, message: 'Execution entry updated successfully' });
  });

  deleteExecution = asyncHandler(async (req: Request, res: Response) => {
    await pmsService.deleteExecution(String(req.params.entryId));
    res.json({ success: true, message: 'Execution entry deleted successfully' });
  });

  // Actual Measurements
  listActuals = asyncHandler(async (req: Request, res: Response) => {
    const stageNumber = req.query.stage_number !== undefined ? Number(req.query.stage_number) : undefined;
    const records = await pmsService.listActuals(String(req.params.id), stageNumber);
    res.json({ success: true, data: records });
  });

  createActual = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.createActual(String(req.params.id), req.body);
    res.status(201).json({ success: true, data: record, message: 'Actual measurement created successfully' });
  });

  updateActual = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.updateActual(String(req.params.entryId), req.body);
    res.json({ success: true, data: record, message: 'Actual measurement updated successfully' });
  });

  deleteActual = asyncHandler(async (req: Request, res: Response) => {
    await pmsService.deleteActual(String(req.params.entryId));
    res.json({ success: true, message: 'Actual measurement deleted successfully' });
  });

  // Stage Checklist Entries
  listStageEntries = asyncHandler(async (req: Request, res: Response) => {
    const stageNumber = req.query.stage_number !== undefined ? Number(req.query.stage_number) : undefined;
    const records = await pmsService.listStageEntries(String(req.params.id), stageNumber);
    res.json({ success: true, data: records });
  });

  upsertStageEntry = asyncHandler(async (req: Request, res: Response) => {
    const stageEntryId = String(req.params.stageEntryId);
    const record = await pmsService.upsertStageEntry(stageEntryId, req.body);
    res.json({ success: true, data: record, message: 'Stage entry saved successfully' });
  });
}

export const executionController = new ExecutionController();

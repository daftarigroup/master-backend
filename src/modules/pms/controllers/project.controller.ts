import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { pmsService } from '../services/project.service';
import { ApiError } from '../../../utils/ApiError';

export class ProjectController {
  list = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const projects = await pmsService.listProjects(user, req.query);
    res.json({ success: true, data: projects });
  });

  getById = asyncHandler(async (req: Request, res: Response) => {
    const project = await pmsService.getProject(String(req.params.id));
    res.json({ success: true, data: project });
  });

  create = asyncHandler(async (req: Request, res: Response) => {
    const project = await pmsService.createProject(req.body);
    res.status(201).json({ success: true, data: project, message: 'Project created successfully' });
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const project = await pmsService.updateProject(String(req.params.id), req.body);
    res.json({ success: true, data: project, message: 'Project updated successfully' });
  });

  delete = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const isSuperAdmin = user?.role === 'SUPER_ADMIN' || user?.administrate === true;
    if (!isSuperAdmin) {
      throw new ApiError(403, 'Forbidden: Admin access required to delete projects');
    }

    await pmsService.deleteProject(String(req.params.id));
    res.json({ success: true, message: 'Project deleted successfully' });
  });

  // Design
  getDesign = asyncHandler(async (req: Request, res: Response) => {
    const rows = await pmsService.getDesign(String(req.params.id));
    res.json({ success: true, data: rows });
  });

  upsertDesign = asyncHandler(async (req: Request, res: Response) => {
    const rows = Array.isArray(req.body) ? req.body : (req.body.rows || []);
    const design = await pmsService.upsertDesign(String(req.params.id), rows);
    res.json({ success: true, data: design, message: 'Design saved successfully' });
  });

  // Contractor & Stages
  getFinalizeConsultant = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.getFinalizeConsultant(String(req.params.id));
    res.json({ success: true, data: record });
  });

  upsertFinalizeConsultant = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.upsertFinalizeConsultant(String(req.params.id), req.body);
    res.json({ success: true, data: record, message: 'Finalized consultants updated successfully' });
  });

  getDrawingUpload = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.getDrawingUpload(String(req.params.id));
    res.json({ success: true, data: record });
  });

  upsertDrawingUpload = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.upsertDrawingUpload(String(req.params.id), req.body);
    res.json({ success: true, data: record, message: 'Drawing upload updated successfully' });
  });

  getFinalApproval = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.getFinalApproval(String(req.params.id));
    res.json({ success: true, data: record });
  });

  upsertFinalApproval = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.upsertFinalApproval(String(req.params.id), req.body);
    res.json({ success: true, data: record, message: 'Final approval updated successfully' });
  });

  getDrawings = asyncHandler(async (req: Request, res: Response) => {
    const data = await pmsService.getDrawings(String(req.params.id));
    res.json({ success: true, data });
  });

  upsertDrawings = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.upsertDrawings(String(req.params.id), req.body);
    res.json({ success: true, data: record, message: 'Drawings updated successfully' });
  });

  // Material Requirements
  listMaterialRequirements = asyncHandler(async (req: Request, res: Response) => {
    const records = await pmsService.listMaterialRequirements(String(req.params.id));
    res.json({ success: true, data: records });
  });

  createMaterialRequirement = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.createMaterialRequirement(String(req.params.id), req.body);
    res.status(201).json({ success: true, data: record, message: 'Material requirement created' });
  });

  deleteMaterialRequirement = asyncHandler(async (req: Request, res: Response) => {
    await pmsService.deleteMaterialRequirement(String(req.params.reqId));
    res.json({ success: true, message: 'Material requirement deleted' });
  });

  // Calculation State
  getCalcState = asyncHandler(async (req: Request, res: Response) => {
    const state = await pmsService.getCalcState(String(req.params.id), String(req.params.stateType));
    res.json({ success: true, data: state });
  });

  upsertCalcState = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.upsertCalcState(String(req.params.id), String(req.params.stateType), req.body);
    res.json({ success: true, data: record, message: 'Calculation state saved successfully' });
  });

  // Product IMF
  getProductIMF = asyncHandler(async (req: Request, res: Response) => {
    const items = await pmsService.getProductIMF(String(req.params.poNumber));
    res.json({ success: true, data: items });
  });

  upsertProductIMF = asyncHandler(async (req: Request, res: Response) => {
    const record = await pmsService.upsertProductIMF(String(req.params.poNumber), req.body);
    res.json({ success: true, data: record, message: 'Product IMF updated successfully' });
  });
}

export const projectController = new ProjectController();

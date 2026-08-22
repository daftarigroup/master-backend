import { Response } from 'express';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { IndentService } from '../services/indent.service';
import { asyncHandler } from '../../../utils/asyncHandler';

export class IndentController {
  private service: IndentService;

  constructor() {
    this.service = new IndentService();
  }

  getIndents = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const permittedFirms = req.query.permittedFirms
      ? String(req.query.permittedFirms).split(',')
      : undefined;

    const data = await this.service.getAllIndents(permittedFirms);

    res.json({
      success: true,
      data,
    });
  });

  updateApproval = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    await this.service.updateApproval(id, req.body);
    res.json({ success: true, message: 'Indent approval updated successfully' });
  });

  updateSpecifications = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    await this.service.updateSpecifications(id, req.body.specifications);
    res.json({ success: true, message: 'Indent specifications updated successfully' });
  });

  updateHistoryFields = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    await this.service.updateHistoryFields(id, req.body);
    res.json({ success: true, message: 'Indent history fields updated successfully' });
  });

  updateVendorSelection = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const indentNumber = String(req.params.indentNumber);
    await this.service.updateVendorSelection(indentNumber, req.body);
    res.json({ success: true, message: 'Indent vendor selection updated successfully' });
  });

  updateHODApproval = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const indentNumber = String(req.params.indentNumber);
    await this.service.updateHODApproval(indentNumber, req.body);
    res.json({ success: true, message: 'Indent HOD approval updated successfully' });
  });

  updatePOCreation = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const indentNumber = String(req.params.indentNumber);
    await this.service.updatePOCreation(indentNumber, req.body);
    res.json({ success: true, message: 'Indent PO creation updated successfully' });
  });

  updatePaymentTerms = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const indentNumber = String(req.params.indentNumber);
    await this.service.updatePaymentTerms(indentNumber, req.body);
    res.json({ success: true, message: 'Indent payment terms updated successfully' });
  });

  updateStoreOutApproval = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const indentNumber = String(req.params.indentNumber);
    await this.service.updateStoreOutApproval(indentNumber, req.body);
    res.json({ success: true, message: 'Indent Store Out approval updated successfully' });
  });

  deleteIndent = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    await this.service.deleteIndentRecord(id);
    res.json({ success: true, message: 'Indent deleted successfully' });
  });

  resetStage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const stage = String(req.body.stage || req.params.stage || '');
    const updated = await this.service.resetIndentStage(id, stage);
    res.json({ success: true, message: `Stage '${stage}' reset successfully`, data: updated });
  });
}


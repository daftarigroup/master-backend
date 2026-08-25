import { Response } from 'express';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { StageResetService } from '../services/stageReset.service';

export class StageResetController {
  private service: StageResetService;

  constructor() {
    this.service = new StageResetService();
  }

  resetLifting = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id, liftNumber, indentNo, productName } = req.body;
    const result = await this.service.resetLifting({ id, liftNumber, indentNo, productName });
    res.json({ success: true, message: 'Lifting stage reset successfully', data: result });
  });

  resetStoreInStage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const stage = String(req.body.stage || req.params.stage || '');
    const updated = await this.service.resetStoreInStage(id, stage);
    res.json({ success: true, message: `StoreIn stage '${stage}' reset successfully`, data: updated });
  });

  resetPaymentStage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const updated = await this.service.resetPaymentStage(id);
    res.json({ success: true, message: 'Payment stage reset successfully', data: updated });
  });

  resetFullkittingStage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const updated = await this.service.resetFullkittingStage(id);
    res.json({ success: true, message: 'Fullkitting stage reset successfully', data: updated });
  });

  resetTallyEntryStage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const stage = String(req.body.stage || req.params.stage || '');
    const updated = await this.service.resetTallyEntryStage(id, stage);
    res.json({ success: true, message: `Tally entry stage '${stage}' reset successfully`, data: updated });
  });

  resetPOCreation = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const poNumber = String(req.body.poNumber || req.params.poNumber || '').trim();
    const result = await this.service.resetPOCreation(poNumber);
    res.json({ success: true, message: `PO '${poNumber}' reset and deleted successfully`, data: result });
  });

  resetIssueStage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id || req.body.id);
    const result = await this.service.resetIssueStage(id);
    res.json({ success: true, message: `Issue ID ${id} approval reset to Pending successfully`, data: result });
  });
}



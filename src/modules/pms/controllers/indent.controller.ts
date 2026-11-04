import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { pmsProcurementService } from '../services/procurement.service';

export class IndentController {
  list = asyncHandler(async (req: Request, res: Response) => {
    const indents = await pmsProcurementService.listIndents(req.query);
    res.json({ success: true, data: indents });
  });

  create = asyncHandler(async (req: Request, res: Response) => {
    const indent = await pmsProcurementService.createIndent(req.body);
    res.status(201).json({ success: true, data: indent, message: 'Indent created successfully' });
  });

  approve = asyncHandler(async (req: Request, res: Response) => {
    const indent = await pmsProcurementService.approveIndent(req.params.id, req.body, (req as any).user);
    res.json({ success: true, data: indent, message: `Indent ${indent.indent_number} ${indent.indent_status}` });
  });

  updateVendorRates = asyncHandler(async (req: Request, res: Response) => {
    const indent = await pmsProcurementService.updateVendorRates(req.params.id, req.body);
    res.json({ success: true, data: indent, message: 'Vendor rates saved successfully' });
  });

  technicalApproval = asyncHandler(async (req: Request, res: Response) => {
    const indent = await pmsProcurementService.technicalApproval(req.params.id, req.body, (req as any).user);
    res.json({ success: true, data: indent, message: 'Technical approval saved successfully' });
  });

  managementApproval = asyncHandler(async (req: Request, res: Response) => {
    const indent = await pmsProcurementService.managementApproval(req.params.id, req.body, (req as any).user);
    res.json({ success: true, data: indent, message: 'Management approval saved successfully' });
  });

  delete = asyncHandler(async (req: Request, res: Response) => {
    await pmsProcurementService.deleteIndent(req.params.id);
    res.json({ success: true, message: 'Indent deleted successfully' });
  });
}

export const indentController = new IndentController();

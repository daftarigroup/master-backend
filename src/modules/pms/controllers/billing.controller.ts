import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { pmsService } from '../services/project.service';

export class BillingController {
  listRMBills = asyncHandler(async (req: Request, res: Response) => {
    const billType = req.query.bill_type as string | undefined;
    const bills = await pmsService.listRMBills(String(req.params.id), billType);
    res.json({ success: true, data: bills });
  });

  createRMBill = asyncHandler(async (req: Request, res: Response) => {
    const bill = await pmsService.createRMBill(String(req.params.id), req.body);
    res.status(201).json({ success: true, data: bill, message: 'RM Bill created successfully' });
  });

  getRMBill = asyncHandler(async (req: Request, res: Response) => {
    const bill = await pmsService.getRMBill(String(req.params.billId));
    res.json({ success: true, data: bill });
  });

  updateRMBill = asyncHandler(async (req: Request, res: Response) => {
    const bill = await pmsService.updateRMBill(String(req.params.billId), req.body);
    res.json({ success: true, data: bill, message: 'RM Bill updated successfully' });
  });

  deleteRMBill = asyncHandler(async (req: Request, res: Response) => {
    await pmsService.deleteRMBill(String(req.params.billId));
    res.json({ success: true, message: 'RM Bill deleted successfully' });
  });
}

export const billingController = new BillingController();

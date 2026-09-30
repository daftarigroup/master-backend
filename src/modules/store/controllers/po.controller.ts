import { Request, Response } from 'express';
import { POCreationService, getNextPoNumber, getFinancialYear } from '../services/po.service';
import { asyncHandler } from '../../../utils/asyncHandler';

export class POController {
  private service: POCreationService;

  constructor() {
    this.service = new POCreationService();
  }

  getNextPoNumber = asyncHandler(async (req: Request, res: Response) => {
    const fy = req.query.fy ? String(req.query.fy) : getFinancialYear();
    const nextPoNumber = await getNextPoNumber(fy);
    res.json({
      success: true,
      nextPoNumber,
      financialYear: fy,
    });
  });

  createPO = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.service.createPO(req.body);
    res.status(201).json(result);
  });
}

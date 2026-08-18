import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { loansService } from '../services/loans.service';

export const loansController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const filters = {
      ...req.query,
      ...(req.query.page !== undefined ? { page: parseInt(req.query.page as string, 10) } : {}),
      ...(req.query.limit !== undefined ? { limit: parseInt(req.query.limit as string, 10) } : {}),
      ...(req.query.search !== undefined ? { search: String(req.query.search) } : {}),
    };
    const result = await loansService.listLoans(filters);
    if (result && typeof result === 'object' && 'items' in result) {
      res.json({ success: true, data: result.items, pagination: (result as any).pagination });
    } else {
      res.json({ success: true, data: result });
    }
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await loansService.getLoanById(String(req.params.id));
    res.json({ success: true, data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await loansService.createLoan(req.body);
    res.status(201).json({ success: true, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await loansService.updateLoan(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    await loansService.deleteLoan(String(req.params.id));
    res.json({ success: true, message: 'Loan deleted' });
  }),

  requestForeclosure: asyncHandler(async (req: Request, res: Response) => {
    const data = await loansService.requestForeclosure(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),

  collectDocuments: asyncHandler(async (req: Request, res: Response) => {
    const data = await loansService.collectDocuments(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),

  collectNoc: asyncHandler(async (req: Request, res: Response) => {
    const data = await loansService.collectNoc(String(req.params.id));
    res.json({ success: true, data });
  }),

  settleLoan: asyncHandler(async (req: Request, res: Response) => {
    const data = await loansService.settleLoan(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),
};

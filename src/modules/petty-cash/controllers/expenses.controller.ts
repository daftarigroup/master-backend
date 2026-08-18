import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { expensesService } from '../services/expenses.service';

export const expensesController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const data = await expensesService.listExpenses(req.query);
    res.json({ success: true, data });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await expensesService.getExpenseById(String(req.params.id));
    res.json({ success: true, data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await expensesService.createExpense(req.body);
    res.status(201).json({ success: true, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await expensesService.updateExpense(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),

  updateStatus: asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const approverName = user?.name || user?.user_name || 'Admin';
    const data = await expensesService.updateExpenseStatus(String(req.params.id), req.body.status, approverName);
    res.json({ success: true, data });
  }),
};

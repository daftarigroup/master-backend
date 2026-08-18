import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { subscriptionsService } from '../services/subscriptions.service';

export const subscriptionsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const filters = {
      ...req.query,
      ...(req.query.page !== undefined ? { page: parseInt(req.query.page as string, 10) } : {}),
      ...(req.query.limit !== undefined ? { limit: parseInt(req.query.limit as string, 10) } : {}),
      ...(req.query.search !== undefined ? { search: String(req.query.search) } : {}),
    };
    const result = await subscriptionsService.listSubscriptions(filters);
    if (result && typeof result === 'object' && 'items' in result) {
      res.json({ success: true, data: result.items, pagination: (result as any).pagination });
    } else {
      res.json({ success: true, data: result });
    }
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await subscriptionsService.getSubscriptionById(String(req.params.id));
    res.json({ success: true, data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await subscriptionsService.createSubscription(req.body);
    res.status(201).json({ success: true, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await subscriptionsService.updateSubscription(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    await subscriptionsService.deleteSubscription(String(req.params.id));
    res.json({ success: true, message: 'Subscription deleted' });
  }),

  recordApproval: asyncHandler(async (req: Request, res: Response) => {
    const data = await subscriptionsService.recordApproval(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),

  recordPayment: asyncHandler(async (req: Request, res: Response) => {
    const data = await subscriptionsService.recordPayment(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),

  listRenewals: asyncHandler(async (req: Request, res: Response) => {
    const options = {
      ...req.query,
      subscriptionId: req.params.id ? String(req.params.id) : (req.query.subscriptionId as string | undefined),
      ...(req.query.page !== undefined ? { page: parseInt(req.query.page as string, 10) } : {}),
      ...(req.query.limit !== undefined ? { limit: parseInt(req.query.limit as string, 10) } : {}),
      ...(req.query.search !== undefined ? { search: String(req.query.search) } : {}),
    };
    const result = await subscriptionsService.listRenewals(options);
    if (result && typeof result === 'object' && 'items' in result) {
      res.json({ success: true, data: result.items, pagination: (result as any).pagination });
    } else {
      res.json({ success: true, data: result });
    }
  }),

  recordRenewal: asyncHandler(async (req: Request, res: Response) => {
    const data = await subscriptionsService.recordRenewal(String(req.params.id), req.body);
    res.status(201).json({ success: true, data });
  }),
};

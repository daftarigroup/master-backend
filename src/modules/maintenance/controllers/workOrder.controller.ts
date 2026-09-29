import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { currentUserId, currentUserContext } from '../../../utils/currentUser';
import { workOrderService } from '../services/workOrder.service';

export const workOrderController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await workOrderService.list(req.query, currentUserContext(req));
    res.json(result);
  }),
  getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.getById(String(req.params.id));
    res.json({ status: 'success', data });
  }),
  approvalHistory: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await workOrderService.approvalHistory(req.query);
    res.json(result);
  }),
  stats: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.stats(req.query, currentUserContext(req));
    res.json({ status: 'success', data });
  }),
  transfer: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.transfer(String(req.params.id), req.body, currentUserId(req));
    res.json({ success: true, data });
  }),
  markDone: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.markDone(String(req.params.id), req.body, currentUserId(req));
    res.json({ success: true, data });
  }),
  markNotDone: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.markNotDone(String(req.params.id), req.body, currentUserId(req));
    res.json({ success: true, data });
  }),
  extend: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.extend(String(req.params.id), req.body, currentUserId(req));
    res.json({ success: true, data });
  }),
  hold: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.hold(String(req.params.id), req.body, currentUserId(req));
    res.json({ success: true, data });
  }),
  cancel: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.cancel(String(req.params.id), req.body, currentUserId(req));
    res.json({ success: true, data });
  }),
  skip: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.skip(String(req.params.id), req.body, currentUserId(req));
    res.json({ success: true, data });
  }),
  approve: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.approve(String(req.params.id), req.body, currentUserId(req));
    res.json({ success: true, data });
  }),
  reject: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.reject(String(req.params.id), req.body, currentUserId(req));
    res.json({ success: true, data });
  }),
  processRepair: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.processRepair(String(req.params.id), req.body, currentUserId(req));
    res.json({ status: 'success', data });
  }),
};

import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { currentUserId, currentUserContext } from '../../../utils/currentUser';
import { ApiError } from '../../../utils/ApiError';
import { workOrderService } from '../services/workOrder.service';
import { outsourceService } from '../services/outsource.service';
import { workOrderTaskService } from '../services/workOrderTask.service';
import { authorize } from '../services/workOrderGuard';
import { workOrderPartsService } from '../services/workOrderParts.service';
import { shapeWorkOrders } from '../lib/stripCost';

// Every by-id action first goes through authorize(): another firm's work order is a 404, a site user sees only the work orders they
// are involved in, and the action itself must be allowed for them (assignee works, responsible approves and reassigns, nobody
// approves their own work). Responses drop the estimate / actual cost split for users without cost access.
const id = (req: AuthenticatedRequest) => String(req.params.id);
const uid = (req: AuthenticatedRequest) => {
  const u = currentUserId(req);
  if (u === null) throw ApiError.unauthorized('Login required');
  return u;
};

export const workOrderController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    res.json(await shapeWorkOrders(ctx, await workOrderService.list(req.query, ctx)));
  }),
  getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    const data = await workOrderService.getById(id(req), ctx);
    res.json({ status: 'success', data: await shapeWorkOrders(ctx, data) });
  }),
  approvalHistory: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    res.json(await shapeWorkOrders(ctx, await workOrderService.approvalHistory(req.query, ctx)));
  }),
  stats: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await workOrderService.stats(req.query, currentUserContext(req));
    res.json({ status: 'success', data });
  }),
  transfer: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'reassign');
    const data = await workOrderService.transfer(id(req), req.body, uid(req));
    res.json({ success: true, data: await shapeWorkOrders(ctx, data) });
  }),
  markDone: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    const data = await workOrderService.markDone(id(req), req.body, uid(req));
    res.json({ success: true, data: await shapeWorkOrders(ctx, data) });
  }),
  markNotDone: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await authorize(currentUserContext(req), id(req), 'work');
    const data = await workOrderService.markNotDone(id(req), req.body, uid(req));
    res.json({ success: true, data });
  }),
  extend: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await authorize(currentUserContext(req), id(req), 'work');
    const data = await workOrderService.extend(id(req), req.body, uid(req));
    res.json({ success: true, data });
  }),
  hold: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await authorize(currentUserContext(req), id(req), 'work');
    const data = await workOrderService.hold(id(req), req.body, uid(req));
    res.json({ success: true, data });
  }),
  cancel: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await authorize(currentUserContext(req), id(req), 'manage');
    const data = await workOrderService.cancel(id(req), req.body, uid(req));
    res.json({ success: true, data });
  }),
  skip: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await authorize(currentUserContext(req), id(req), 'manage');
    const data = await workOrderService.skip(id(req), req.body, uid(req));
    res.json({ success: true, data });
  }),
  approve: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'approve');
    const data = await workOrderService.approve(id(req), req.body, uid(req));
    res.json({ success: true, data: await shapeWorkOrders(ctx, data) });
  }),
  reject: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await authorize(currentUserContext(req), id(req), 'approve');
    const data = await workOrderService.reject(id(req), req.body, uid(req));
    res.json({ success: true, data });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    const data = await workOrderService.create(ctx, req.body);
    res.status(201).json({ success: true, data: await shapeWorkOrders(ctx, data) });
  }),
  outsourceSend: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    const data = await outsourceService.send(ctx, id(req), req.body);
    res.json({ success: true, data });
  }),
  outsourceReceive: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    const data = await outsourceService.receive(ctx, id(req), req.body);
    res.json({ success: true, data });
  }),
  outsourcePay: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    const data = await outsourceService.pay(ctx, id(req), req.body);
    res.json({ success: true, data });
  }),
  processRepair: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    const data = await workOrderService.processRepair(id(req), req.body, uid(req), ctx);
    res.json({ status: 'success', data: await shapeWorkOrders(ctx, data) });
  }),

  // parts the repair needs from the Store (Phases 5 / 6)
  listPartsNeeded: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'view');
    res.json({ success: true, data: await shapeWorkOrders(ctx, await workOrderPartsService.list(id(req))) });
  }),
  addPartNeeded: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    res.status(201).json({ success: true, data: await shapeWorkOrders(ctx, await workOrderPartsService.add(ctx, id(req), req.body, uid(req))) });
  }),
  updatePartNeeded: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    res.json({ success: true, data: await shapeWorkOrders(ctx, await workOrderPartsService.update(id(req), String(req.params.partId), req.body)) });
  }),
  removePartNeeded: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    res.json({ success: true, data: await shapeWorkOrders(ctx, await workOrderPartsService.remove(id(req), String(req.params.partId), req.body?.reason)) });
  }),
  raiseIndent: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    res.status(201).json({ success: true, data: await shapeWorkOrders(ctx, await workOrderPartsService.raiseIndent(ctx, id(req), uid(req), req.body ?? {})) });
  }),

  // checklist and parts used
  setChecklistItem: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    const data = await workOrderTaskService.setChecklistItem(id(req), String(req.params.itemId), uid(req), req.body);
    res.json({ success: true, data: await shapeWorkOrders(ctx, data) });
  }),
  addPart: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    const data = await workOrderTaskService.addPart(id(req), req.body);
    res.status(201).json({ success: true, data: await shapeWorkOrders(ctx, data) });
  }),
  removePart: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ctx = currentUserContext(req);
    await authorize(ctx, id(req), 'work');
    const data = await workOrderTaskService.removePart(id(req), String(req.params.partId));
    res.json({ success: true, data: await shapeWorkOrders(ctx, data) });
  }),
};

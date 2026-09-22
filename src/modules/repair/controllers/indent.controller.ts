import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { indentService } from '../services/indent.service';

export const indentController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.list(req.query);
    res.json({ status: 'success', data });
  }),
  getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.getById(String(req.params.id));
    res.json({ status: 'success', data });
  }),
  byMachine: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.getByMachine(String(req.query.machineName ?? ''), req.query.serialNo as string | undefined);
    res.json({ status: 'success', data });
  }),
  nextSerial: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.nextSerialPreview();
    res.json({ status: 'success', data });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.create(req.body);
    res.status(201).json({ status: 'success', data });
  }),
  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.update(String(req.params.id), req.body);
    res.json({ status: 'success', data });
  }),
  approve: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const routing = req.body.approvalStatus === 'Inhouse' ? 'Inhouse' : 'Outhouse';
    const data = await indentService.approve(String(req.params.id), routing, req.body.approvalRemarks);
    res.json({ status: 'success', data });
  }),
  reject: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.reject(String(req.params.id), req.body.reason);
    res.json({ status: 'success', data });
  }),
  assignTechnician: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.assignTechnician(String(req.params.id), req.body.technicianId, req.body.workNotes);
    res.json({ status: 'success', data });
  }),
  complete: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.completeRepair(String(req.params.id), req.body.finalCost, req.body.notes);
    res.json({ status: 'success', data });
  }),
  submitInspection: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: req.body });
  }),

  saveOuthouseVendor: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.saveOuthouseVendor(String(req.params.id), req.body);
    res.json({ status: 'success', data });
  }),
  saveOuthouseOffers: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const offers = Array.isArray(req.body) ? req.body : (req.body.offers ?? []);
    const data = await indentService.saveOuthouseOffers(String(req.params.id), offers);
    res.json({ status: 'success', data });
  }),
  approveOuthouseRate: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.approveOuthouseRate(String(req.params.id), String(req.params.offerId));
    res.json({ status: 'success', data });
  }),
  recordOuthouseDispatch: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.recordOuthouseDispatch(String(req.params.id), req.body);
    res.json({ status: 'success', data });
  }),
  recordOuthouseReceiving: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.recordOuthouseReceiving(String(req.params.id), req.body);
    res.json({ status: 'success', data });
  }),
  completeOuthousePayment: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await indentService.completeOuthousePayment(String(req.params.id), req.body);
    res.json({ status: 'success', data });
  }),

  storeIn: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await indentService.storeInList() });
  }),
  sentMachine: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await indentService.sentMachineList() });
  }),
  payments: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await indentService.paymentsList() });
  }),
  dashboardStats: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await indentService.dashboardStats() });
  }),
  dailyReport: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.json(await indentService.dailyReport(req.query.date as string | undefined));
  }),
  calendar: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await indentService.calendar() });
  }),
};

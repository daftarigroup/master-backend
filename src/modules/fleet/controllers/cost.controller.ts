import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { currentUserContext } from '../../../utils/currentUser';
import { ok } from '../../../utils/respond';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { costEntryService } from '../services/costEntry.service';
import { costReportService } from '../services/costReport.service';
import { costSummaryService } from '../services/costSummary.service';
import { billingService } from '../services/billing.service';
import { equipmentService } from '../services/equipment.service';
import { fleetSettingsService } from '../services/fleetSettings.service';
import { machineRateService } from '../services/machineRate.service';
import { wbsService } from '../services/wbs.service';
import { ApiError } from '../../../utils/ApiError';

// Bodies, queries and params were already parsed by validateParsed. Cost-bearing routes sit behind requireCostAccess /
// requireCostEdit (see cost.routes.ts); the equipment list is open to everyone but only ever loads cost for permitted callers.
const ctx = (req: AuthenticatedRequest) => currentUserContext(req);
const body = <T = any>(req: AuthenticatedRequest) => req.body as T;
const query = <T = any>(req: AuthenticatedRequest) => req.query as unknown as T;
const id = (req: AuthenticatedRequest) => String(req.params.id);
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => asyncHandler(async (req: AuthenticatedRequest, res: Response) => void (await fn(req, res)));

export const costController = {
  equipmentList: h(async (req, res) => ok(res, await equipmentService.list(ctx(req), query(req)))),
  equipmentSummary: h(async (req, res) => ok(res, await equipmentService.summary(ctx(req), id(req), query(req).month))),

  machineCost: h(async (req, res) => ok(res, await costSummaryService.machine(ctx(req), id(req), query(req)))),
  machineTrend: h(async (req, res) => ok(res, await costSummaryService.trend(ctx(req), id(req), query(req)))),
  machineLogs: h(async (req, res) => ok(res, await costSummaryService.logs(ctx(req), id(req), req.params.kind as never, query(req)))),
  fleetCost: h(async (req, res) => ok(res, await costSummaryService.fleet(ctx(req), query(req)))),
  report: h(async (req, res) => {
    const file = await costReportService.export(ctx(req), query(req));
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }),

  billingEvents: h(async (req, res) => ok(res, await billingService.events(ctx(req), query(req)))),
  billingExport: h(async (req, res) => {
    const file = await billingService.export(ctx(req), query(req));
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }),
  billingSummary: h(async (req, res) => ok(res, await billingService.machineSummary(ctx(req), id(req), query(req)))),

  createRate: h(async (req, res) => ok(res, await machineRateService.create(ctx(req), id(req), body(req)), 201)),
  endRate: h(async (req, res) => ok(res, await machineRateService.end(ctx(req), id(req), String(req.params.rateId), body(req).endDate))),

  createCostEntry: h(async (req, res) => ok(res, await costEntryService.create(ctx(req), body(req)), 201)),
  updateCostEntry: h(async (req, res) => ok(res, await costEntryService.update(ctx(req), id(req), body(req)))),
  voidCostEntry: h(async (req, res) => ok(res, await costEntryService.void(ctx(req), id(req), body(req).reason))),

  listWbs: h(async (req, res) => ok(res, await wbsService.list(ctx(req), query(req)))),
  createWbs: h(async (req, res) => ok(res, await wbsService.create(ctx(req), body(req)), 201)),
  updateWbs: h(async (req, res) => ok(res, await wbsService.update(ctx(req), id(req), body(req)))),

  getSettings: h(async (req, res) => ok(res, await fleetSettingsService.get(ctx(req), query(req).firmId))),
  putSettings: h(async (req, res) => ok(res, await fleetSettingsService.put(ctx(req), body(req).firmId, body(req)))),

  setReceiptRate: h(async () => {
    throw new ApiError(410, 'Diesel receipts are no longer used: the Store average price values Store diesel issues.');
  }),
};

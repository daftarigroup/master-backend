import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { currentUserContext } from '../../../utils/currentUser';
import { ok } from '../../../utils/respond';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { alertsService } from '../services/alerts.service';
import { dailyEntryService } from '../services/dailyEntry.service';
import { dieselLogService } from '../services/dieselLog.service';
import { dieselReceiptService } from '../services/dieselReceipt.service';
import { efficiencyService } from '../services/efficiency.service';
import { exportService } from '../services/export.service';
import { ApiError } from '../../../utils/ApiError';
import { fleetMachineService } from '../services/fleetMachine.service';
import { ledgerService } from '../services/ledger.service';
import { usageLogService } from '../services/usageLog.service';

// Bodies, queries and params have already been parsed by validateParsed, so the values are typed and coerced.
const ctx = (req: AuthenticatedRequest) => currentUserContext(req);
const body = <T = any>(req: AuthenticatedRequest) => req.body as T;
const query = <T = any>(req: AuthenticatedRequest) => req.query as unknown as T;
const id = (req: AuthenticatedRequest) => String(req.params.id);

export const fleetController = {
  machines: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await fleetMachineService.list(ctx(req), query(req)))),
  lastReading: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await fleetMachineService.lastReading(ctx(req), id(req)))),
  history: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await fleetMachineService.history(ctx(req), id(req), query(req)))),

  // the project diesel tank is retired: diesel comes from Store Issue (Asset); old receipts stay readable
  createReceipt: asyncHandler(async () => {
    throw new ApiError(410, 'Receiving diesel into a project tank is no longer used. Diesel is issued from Store Issue (Asset) against the Store inventory.');
  }),
  listReceipts: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await dieselReceiptService.list(ctx(req), query(req)))),
  voidReceipt: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await dieselReceiptService.void(ctx(req), id(req), body(req).reason))),

  listDieselLogs: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await dieselLogService.list(ctx(req), query(req)))),
  voidDieselLog: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await dieselLogService.void(ctx(req), id(req), body(req).reason))),

  createUsageLog: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { log, warnings } = await usageLogService.create(ctx(req), body(req));
    return ok(res, log, 201, { warnings });
  }),
  closeUsageLog: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { log, warnings } = await usageLogService.close(ctx(req), id(req), body(req));
    return ok(res, log, 200, { warnings });
  }),
  listUsageLogs: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await usageLogService.list(ctx(req), query(req)))),
  voidUsageLog: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await usageLogService.void(ctx(req), id(req), body(req).reason))),

  dailyEntry: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { warnings, ...data } = await dailyEntryService.create(ctx(req), body(req));
    return ok(res, data, 201, { warnings });
  }),

  ledger: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await ledgerService.month(ctx(req), query(req)))),
  exportLedger: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const file = await exportService.ledger(ctx(req), query(req));
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }),
  efficiency: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await efficiencyService.list(ctx(req), query(req)))),
  alerts: asyncHandler(async (req: AuthenticatedRequest, res: Response) => ok(res, await alertsService.get(ctx(req), query(req)))),
};

import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { currentUserContext } from '../../../utils/currentUser';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { recordService } from '../services/record.service';
import { scheduleService } from '../services/schedule.service';

const ctx = (req: AuthenticatedRequest) => currentUserContext(req);
const body = <T = any>(req: AuthenticatedRequest) => req.body as T;
const query = <T = any>(req: AuthenticatedRequest) => req.query as unknown as T;
const machineId = (req: AuthenticatedRequest) => String(req.params.machineId);
const id = (req: AuthenticatedRequest) => String(req.params.id);
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => asyncHandler(async (req: AuthenticatedRequest, res: Response) => void (await fn(req, res)));

export const recordsController = {
  list: h(async (req, res) => ok(res, await recordService.list(ctx(req), query(req)))),
  summary: h(async (req, res) => ok(res, await recordService.summary(ctx(req), machineId(req)))),
  history: h(async (req, res) => ok(res, await recordService.history(ctx(req), machineId(req), query(req)))),
  parts: h(async (req, res) => ok(res, await recordService.parts(ctx(req), machineId(req), query(req)))),

  listSchedules: h(async (req, res) => ok(res, await scheduleService.list(ctx(req), query(req)))),
  createSchedule: h(async (req, res) => ok(res, await scheduleService.create(ctx(req), body(req)), 201)),
  updateSchedule: h(async (req, res) => ok(res, await scheduleService.update(ctx(req), id(req), body(req)))),
  scheduleService: h(async (req, res) => {
    const r = await scheduleService.scheduleService(ctx(req), id(req), body(req));
    return ok(res, r, r.created ? 201 : 200);
  }),

  listTemplates: h(async (req, res) => ok(res, await scheduleService.listTemplates(ctx(req), query(req).firmId))),
  saveTemplate: h(async (req, res) => ok(res, await scheduleService.saveTemplate(ctx(req), body(req)))),

};

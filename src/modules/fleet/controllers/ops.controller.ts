import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { currentUserContext } from '../../../utils/currentUser';
import { ok } from '../../../utils/respond';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { assignmentService } from '../services/assignment.service';
import { transferService } from '../services/transfer.service';
import { workLogService } from '../services/workLog.service';
import { workTypeService } from '../services/workType.service';

// Work logs, work types, assignments, operators, availability and transfers. Bodies, queries and params were already parsed by
// validateParsed; every service is firm-scoped and applies its own role rules (see the service headers).
const ctx = (req: AuthenticatedRequest) => currentUserContext(req);
const body = <T = any>(req: AuthenticatedRequest) => req.body as T;
const query = <T = any>(req: AuthenticatedRequest) => req.query as unknown as T;
const id = (req: AuthenticatedRequest) => String(req.params.id);
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => asyncHandler(async (req: AuthenticatedRequest, res: Response) => void (await fn(req, res)));

export const opsController = {
  // work logs
  listWorkLogs: h(async (req, res) => ok(res, await workLogService.list(ctx(req), query(req)))),
  workLogApprovalCount: h(async (req, res) => ok(res, { count: await workLogService.approvalCount(ctx(req)) })),
  getWorkLog: h(async (req, res) => ok(res, await workLogService.get(ctx(req), id(req)))),
  prefillWorkLog: h(async (req, res) => ok(res, await workLogService.prefill(ctx(req), id(req), query(req).at))),
  createWorkLog: h(async (req, res) => {
    const r = await workLogService.create(ctx(req), body(req));
    // a retried submit is the same log, not a new one
    return ok(res, r, r.idempotent ? 200 : 201);
  }),
  updateWorkLog: h(async (req, res) => ok(res, await workLogService.update(ctx(req), id(req), body(req)))),
  approveWorkLog: h(async (req, res) => ok(res, await workLogService.approve(ctx(req), id(req)))),
  rejectWorkLog: h(async (req, res) => ok(res, await workLogService.reject(ctx(req), id(req), body(req).reason))),
  reopenWorkLog: h(async (req, res) => ok(res, await workLogService.reopen(ctx(req), id(req), body(req).note))),
  bulkApproveWorkLogs: h(async (req, res) => ok(res, await workLogService.bulkApprove(ctx(req), body(req).ids))),

  // work types
  listWorkTypes: h(async (req, res) => ok(res, await workTypeService.list(ctx(req), query(req).firmId, Boolean(query(req).includeInactive)))),
  createWorkType: h(async (req, res) => ok(res, await workTypeService.create(ctx(req), body(req)), 201)),
  updateWorkType: h(async (req, res) => ok(res, await workTypeService.update(ctx(req), id(req), body(req)))),

  // assignments
  listAssignments: h(async (req, res) => ok(res, await assignmentService.list(ctx(req), query(req)))),
  assign: h(async (req, res) => ok(res, await assignmentService.assign(ctx(req), body(req)), 201)),
  updateAssignment: h(async (req, res) => ok(res, await assignmentService.update(ctx(req), id(req), body(req)))),
  releaseAssignment: h(async (req, res) => ok(res, await assignmentService.release(ctx(req), id(req), body(req)))),
  listOperators: h(async (req, res) => ok(res, await assignmentService.listOperators(ctx(req), query(req)))),
  assignOperator: h(async (req, res) => ok(res, await assignmentService.assignOperator(ctx(req), body(req)), 201)),
  endOperator: h(async (req, res) => ok(res, await assignmentService.endOperator(ctx(req), id(req)))),
  availability: h(async (req, res) => ok(res, await assignmentService.availability(ctx(req), query(req)))),

  // transfers
  listTransfers: h(async (req, res) => ok(res, await transferService.list(ctx(req), query(req)))),
  requestTransfer: h(async (req, res) => ok(res, await transferService.request(ctx(req), body(req)), 201)),
  approveTransfer: h(async (req, res) => ok(res, await transferService.approve(ctx(req), id(req)))),
  dispatchTransfer: h(async (req, res) => ok(res, await transferService.dispatch(ctx(req), id(req), body(req)))),
  receiveTransfer: h(async (req, res) => ok(res, await transferService.receive(ctx(req), id(req), body(req)))),
  cancelTransfer: h(async (req, res) => ok(res, await transferService.cancel(ctx(req), id(req), body(req).reason))),
};

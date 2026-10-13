import { Router } from 'express';
import { validateParsed } from '../../../middleware/validateParsed.middleware';
import { opsController as c } from '../controllers/ops.controller';
import {
  assignMachineSchema, assignOperatorSchema, availabilitySchema, bulkApproveSchema, cancelTransferSchema, createWorkLogSchema,
  createWorkTypeSchema, dispatchTransferSchema, endOperatorSchema, listAssignmentsSchema, listOperatorsSchema, listTransfersSchema,
  listWorkLogsSchema, listWorkTypesSchema, prefillSchema, receiveTransferSchema, rejectWorkLogSchema, releaseAssignmentSchema,
  reopenWorkLogSchema, requestTransferSchema, transferIdSchema, updateAssignmentSchema, updateWorkLogSchema, updateWorkTypeSchema, workLogIdSchema,
} from '../validators/ops.validator';

// Mounted inside the /api/fleet router (behind authenticateJWT + requireLogin). Every service is firm-scoped and applies its own role
// rules: site users log and edit their own work, approvers approve, admins manage assignments, operators and transfers.
const router = Router();

// Work logs
router.get('/work-logs', validateParsed(listWorkLogsSchema), c.listWorkLogs);
router.post('/work-logs', validateParsed(createWorkLogSchema), c.createWorkLog);
router.post('/work-logs/bulk-approve', validateParsed(bulkApproveSchema), c.bulkApproveWorkLogs);
router.get('/work-logs/approval-count', c.workLogApprovalCount);
router.get('/work-logs/prefill/:id', validateParsed(prefillSchema), c.prefillWorkLog);
router.get('/work-logs/:id', validateParsed(workLogIdSchema), c.getWorkLog);
router.patch('/work-logs/:id', validateParsed(updateWorkLogSchema), c.updateWorkLog);
router.post('/work-logs/:id/approve', validateParsed(workLogIdSchema), c.approveWorkLog);
router.post('/work-logs/:id/reject', validateParsed(rejectWorkLogSchema), c.rejectWorkLog);
router.post('/work-logs/:id/reopen', validateParsed(reopenWorkLogSchema), c.reopenWorkLog);

router.get('/work-types', validateParsed(listWorkTypesSchema), c.listWorkTypes);
router.post('/work-types', validateParsed(createWorkTypeSchema), c.createWorkType);
router.patch('/work-types/:id', validateParsed(updateWorkTypeSchema), c.updateWorkType);

// Assignment Status
router.get('/assignments', validateParsed(listAssignmentsSchema), c.listAssignments);
router.post('/assignments', validateParsed(assignMachineSchema), c.assign);
router.patch('/assignments/:id', validateParsed(updateAssignmentSchema), c.updateAssignment);
router.post('/assignments/:id/release', validateParsed(releaseAssignmentSchema), c.releaseAssignment);
router.get('/operator-assignments', validateParsed(listOperatorsSchema), c.listOperators);
router.post('/operator-assignments', validateParsed(assignOperatorSchema), c.assignOperator);
router.post('/operator-assignments/:id/end', validateParsed(endOperatorSchema), c.endOperator);
router.get('/availability', validateParsed(availabilitySchema), c.availability);

// Site transfers
router.get('/transfers', validateParsed(listTransfersSchema), c.listTransfers);
router.post('/transfers', validateParsed(requestTransferSchema), c.requestTransfer);
router.post('/transfers/:id/approve', validateParsed(transferIdSchema), c.approveTransfer);
router.post('/transfers/:id/dispatch', validateParsed(dispatchTransferSchema), c.dispatchTransfer);
router.post('/transfers/:id/receive', validateParsed(receiveTransferSchema), c.receiveTransfer);
router.post('/transfers/:id/cancel', validateParsed(cancelTransferSchema), c.cancelTransfer);

export default router;

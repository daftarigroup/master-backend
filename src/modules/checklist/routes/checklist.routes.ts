import { Router } from 'express';
import { validate } from '../../../middleware/validate.middleware';
import { requireRole } from '../middleware/requireRole.middleware';
import { scopeToFirmAccess } from '../middleware/scopeToFirmAccess.middleware';
import { TaskController } from '../controllers/task.controller';
import { ChecklistTaskController } from '../controllers/checklistTask.controller';
import { DelegationTaskController } from '../controllers/delegationTask.controller';
import { assignTaskSchema } from '../validators/assignTask.validator';
import { submitChecklistTaskSchema, rejectChecklistTaskSchema } from '../validators/checklistTask.validator';
import { submitDelegationTaskSchema, rejectDelegationTaskSchema } from '../validators/delegationTask.validator';

const router = Router();
const taskController = new TaskController();
const checklistTaskController = new ChecklistTaskController();
const delegationTaskController = new DelegationTaskController();

const ANY_ROLE = ['SUPER_ADMIN', 'ADMIN', 'USER'] as const;
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;

// ==================== UNIFIED ASSIGN-TASK ====================
router.post(
  '/tasks',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  validate(assignTaskSchema),
  taskController.assignTask
);

// ==================== CHECKLIST (RECURRING) TASKS ====================
router.get('/checklist-task', requireRole(...ANY_ROLE), scopeToFirmAccess, checklistTaskController.list);
router.get('/checklist-task/:id', requireRole(...ANY_ROLE), scopeToFirmAccess, checklistTaskController.getById);
router.patch(
  '/checklist-task/:id/submit',
  requireRole(...ANY_ROLE),
  scopeToFirmAccess,
  validate(submitChecklistTaskSchema),
  checklistTaskController.submit
);
router.patch(
  '/checklist-task/:id/approve',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  checklistTaskController.approve
);
router.patch(
  '/checklist-task/:id/reject',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  validate(rejectChecklistTaskSchema),
  checklistTaskController.reject
);

router.post(
  '/checklist-task/delete-groups',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  checklistTaskController.deleteGroupsBatch
);
router.delete(
  '/checklist-task/:id/group',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  checklistTaskController.deleteGroup
);

router.patch(
  '/checklist-task/:id/group',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  checklistTaskController.updateGroup
);

router.patch(
  '/checklist-task/:id',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  checklistTaskController.update
);

// ==================== DELEGATION (ONE-TIME) TASKS ====================
router.get('/delegation-task', requireRole(...ANY_ROLE), scopeToFirmAccess, delegationTaskController.list);
router.get('/delegation-task/:id', requireRole(...ANY_ROLE), scopeToFirmAccess, delegationTaskController.getById);
router.post(
  '/delegation-task/delete-batch',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  delegationTaskController.deleteBatch
);
router.delete(
  '/delegation-task/:id',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  delegationTaskController.delete
);
router.patch(
  '/delegation-task/:id',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  delegationTaskController.update
);
router.patch(
  '/delegation-task/:id/submit',
  requireRole(...ANY_ROLE),
  scopeToFirmAccess,
  validate(submitDelegationTaskSchema),
  delegationTaskController.submit
);
router.patch(
  '/delegation-task/:id/approve',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  delegationTaskController.approve
);
router.patch(
  '/delegation-task/:id/approve-extension',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  delegationTaskController.approveExtension
);
router.patch(
  '/delegation-task/:id/reject',
  requireRole(...ADMIN_ROLES),
  scopeToFirmAccess,
  validate(rejectDelegationTaskSchema),
  delegationTaskController.reject
);
router.get(
  '/delegation-task/:id/history',
  requireRole(...ANY_ROLE),
  scopeToFirmAccess,
  delegationTaskController.history
);

export default router;

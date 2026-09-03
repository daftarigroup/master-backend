import { Router } from 'express';
import { IndentController } from '../controllers/indent.controller';
import { UserController } from '../controllers/user.controller';
import { GenericController } from '../controllers/generic.controller';
import { UploadController } from '../controllers/upload.controller';
import { validate } from '../../../middleware/validate.middleware';
import {
  updateIndentApprovalSchema,
  updateIndentSpecificationsSchema,
  updateIndentHistoryFieldsSchema,
  updateIndentVendorSelectionSchema,
  updateIndentHODApprovalSchema,
  updateIndentPOCreationSchema,
  updateIndentPaymentTermsSchema,
  updateIndentStoreOutApprovalSchema,
} from '../validators/indent.validator';

import { StageResetController } from '../controllers/stageReset.controller';

const router = Router();
const indentController = new IndentController();
const userController = new UserController();
const genericController = new GenericController();
const uploadController = new UploadController();
const stageResetController = new StageResetController();

// ==================== USER ROUTES ====================
router.get('/users', userController.getUsers);
router.post('/users/authenticate', userController.authenticate);
router.get('/users/by-username/:username', userController.getByUsername);
router.post('/users', userController.createUser);
router.patch('/users/:id', userController.updateUser);
router.delete('/users/:id', userController.deleteUser);

// ==================== INDENT ROUTES ====================
router.get('/indents', indentController.getIndents);

router.patch('/indents/:id/approval', validate(updateIndentApprovalSchema), indentController.updateApproval);
router.patch('/indents/:id/specifications', validate(updateIndentSpecificationsSchema), indentController.updateSpecifications);
router.patch('/indents/:id/history', validate(updateIndentHistoryFieldsSchema), indentController.updateHistoryFields);

router.patch('/indents/number/:indentNumber/vendor-selection', validate(updateIndentVendorSelectionSchema), indentController.updateVendorSelection);
router.patch('/indents/number/:indentNumber/hod-approval', validate(updateIndentHODApprovalSchema), indentController.updateHODApproval);
router.patch('/indents/number/:indentNumber/po-creation', validate(updateIndentPOCreationSchema), indentController.updatePOCreation);
router.patch('/indents/number/:indentNumber/payment-terms', validate(updateIndentPaymentTermsSchema), indentController.updatePaymentTerms);
router.patch('/indents/number/:indentNumber/store-out-approval', validate(updateIndentStoreOutApprovalSchema), indentController.updateStoreOutApproval);

router.delete('/indents/:id', indentController.deleteIndent);
router.post('/indents/:id/reset-stage', indentController.resetStage);
router.delete('/indents/:id/stage/:stage', indentController.resetStage);

// ==================== STAGE RESET ROUTES (WORKFLOW PIPELINE) ====================
router.post('/stage-reset/lifting', stageResetController.resetLifting);
router.post('/stage-reset/store-in/:id', stageResetController.resetStoreInStage);
router.delete('/stage-reset/store-in/:id/stage/:stage', stageResetController.resetStoreInStage);
router.post('/stage-reset/payments/:id', stageResetController.resetPaymentStage);
router.delete('/stage-reset/payments/:id', stageResetController.resetPaymentStage);
router.post('/stage-reset/fullkitting/:id', stageResetController.resetFullkittingStage);
router.delete('/stage-reset/fullkitting/:id', stageResetController.resetFullkittingStage);
router.post('/stage-reset/tally-entry/:id', stageResetController.resetTallyEntryStage);
router.delete('/stage-reset/tally-entry/:id/stage/:stage', stageResetController.resetTallyEntryStage);
router.post('/stage-reset/po', stageResetController.resetPOCreation);
router.post('/stage-reset/po/:poNumber', stageResetController.resetPOCreation);
router.delete('/stage-reset/po/:poNumber', stageResetController.resetPOCreation);
router.post('/stage-reset/issue/:id', stageResetController.resetIssueStage);
router.delete('/stage-reset/issue/:id', stageResetController.resetIssueStage);


// ==================== UPLOAD & FILE ROUTES ====================
router.post('/upload/presign', uploadController.presignUpload);
router.delete('/upload', uploadController.deleteUpload);
router.get('/file-proxy', uploadController.getFile);
router.get('/files/*filePath', uploadController.getFile);

// ==================== GENERIC ENTITY ROUTES ====================
router.get('/entity/:table', genericController.getEntities);
router.get('/entity/:table/:id', genericController.getEntityById);
router.post('/entity/:table', genericController.createEntity);
router.patch('/entity/:table/:id', genericController.updateEntityById);
router.patch('/entity/:table', genericController.updateEntities);
router.delete('/entity/:table/:id', genericController.deleteEntityById);

export default router;

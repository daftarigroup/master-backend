import { Router } from 'express';
import { IndentController } from '../controllers/indent.controller';
import { UserController } from '../controllers/user.controller';
import { GenericController } from '../controllers/generic.controller';
import { UploadController } from '../controllers/upload.controller';
import { validate } from '../../../middleware/validate.middleware';
import { uploadSingle } from '../../../middleware/upload.middleware';
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

const router = Router();
const indentController = new IndentController();
const userController = new UserController();
const genericController = new GenericController();
const uploadController = new UploadController();

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


// ==================== UPLOAD & FILE ROUTES ====================
router.post('/upload', uploadSingle, uploadController.uploadFile);
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

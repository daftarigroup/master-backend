import { Router, Request } from 'express';
import { requireLogin } from '../../../middleware/auth.middleware';
import { IndentController } from '../controllers/indent.controller';
import { UserController } from '../controllers/user.controller';
import { GenericController } from '../controllers/generic.controller';
import { UploadController } from '../controllers/upload.controller';
import { VendorBidController } from '../controllers/vendorBid.controller';
import { StockController } from '../controllers/stock.controller';
import { ApiError } from '../../../utils/ApiError';
import { STORE_ENTITY_TABLES } from '../lib/entityTables';
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
import { POController } from '../controllers/po.controller';

const router = Router();
const indentController = new IndentController();
const userController = new UserController();
const genericController = new GenericController();
const uploadController = new UploadController();
const stageResetController = new StageResetController();
const poController = new POController();
const vendorBidController = new VendorBidController();
const stockController = new StockController();

// ==================== LOGIN GATE ====================
// Every Store route needs a logged-in user except the few that a browser calls with no login. This list is the ONLY way in
// without a token; each entry is temporary or deliberate (see md/integration_summaries/P0.2_*):
//  - login itself;
//  - file-proxy / files: used in <img>, <a> and window.open, which cannot send an Authorization header;
//  - POST /upload/presign only for the public job-application page (bucket hr, path candidates/photos|resumes/...);
//  - public Create Account (POST /users): allowed, but the controller turns an anonymous call into a no-access USER;
//  - the vendor bid page (/bid/:token) has no login: GET / PATCH /vendor-bid/:token see only that token's quotation rows.
const isPublicStoreRequest = (req: Request): boolean => {
  const { method, path } = req;
  if (method === 'POST' && path === '/users/authenticate') return true;
  if (method === 'GET' && (path === '/file-proxy' || path.startsWith('/files/'))) return true;
  if (method === 'POST' && path === '/users') return true; // public Create Account: the controller makes it a no-access account
  // The public job-application page uploads a photo and resume here; nothing else may presign without a login.
  if (method === 'POST' && path === '/upload/presign') {
    const body = (req.body ?? {}) as { bucket?: unknown; path?: unknown };
    return body.bucket === 'hr' && typeof body.path === 'string' && /^candidates\/(photos|resumes)\//.test(body.path) && !body.path.includes('..');
  }
  if (path.startsWith('/vendor-bid/') && (method === 'GET' || method === 'PATCH')) return true;
  return false;
};
router.use((req, res, next) => (isPublicStoreRequest(req) ? next() : requireLogin(req, res, next)));

// ==================== STOCK ====================
router.get('/inventory/stock', stockController.getStock);

// ==================== PURCHASE ORDER QUEUED ROUTES ====================
router.get('/po/next-number', poController.getNextPoNumber);
router.post('/po/create', poController.createPO);

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

// ==================== VENDOR BID PAGE (public, token only) ====================
router.get('/vendor-bid/:token', vendorBidController.getByToken);
router.patch('/vendor-bid/:token', vendorBidController.submitRate);

// ==================== GENERIC ENTITY ROUTES ====================
router.param('table', (_req, _res, next, table: string) => {
  if (!STORE_ENTITY_TABLES.has(table)) return next(new ApiError(403, `Table '${table}' is not available through the store API`));
  next();
});
router.get('/entity/:table', genericController.getEntities);
router.get('/entity/:table/:id', genericController.getEntityById);
router.post('/entity/:table', genericController.createEntity);
router.patch('/entity/:table/:id', genericController.updateEntityById);
router.patch('/entity/:table', genericController.updateEntities);
router.delete('/entity/:table/:id', genericController.deleteEntityById);

export default router;

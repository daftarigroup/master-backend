import { Router } from 'express';
import { IndentController } from '../controllers/indent.controller';
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

const router = Router();
const controller = new IndentController();

router.get('/indents', controller.getIndents);

router.patch('/indents/:id/approval', validate(updateIndentApprovalSchema), controller.updateApproval);
router.patch('/indents/:id/specifications', validate(updateIndentSpecificationsSchema), controller.updateSpecifications);
router.patch('/indents/:id/history', validate(updateIndentHistoryFieldsSchema), controller.updateHistoryFields);

router.patch('/indents/number/:indentNumber/vendor-selection', validate(updateIndentVendorSelectionSchema), controller.updateVendorSelection);
router.patch('/indents/number/:indentNumber/hod-approval', validate(updateIndentHODApprovalSchema), controller.updateHODApproval);
router.patch('/indents/number/:indentNumber/po-creation', validate(updateIndentPOCreationSchema), controller.updatePOCreation);
router.patch('/indents/number/:indentNumber/payment-terms', validate(updateIndentPaymentTermsSchema), controller.updatePaymentTerms);
router.patch('/indents/number/:indentNumber/store-out-approval', validate(updateIndentStoreOutApprovalSchema), controller.updateStoreOutApproval);

router.delete('/indents/:id', controller.deleteIndent);
router.post('/indents/:id/reset-stage', controller.resetStage);
router.delete('/indents/:id/stage/:stage', controller.resetStage);

export default router;


import { Router } from 'express';
import { projectController } from '../controllers/project.controller';
import { minorController } from '../controllers/minor.controller';
import { executionController } from '../controllers/execution.controller';
import { billingController } from '../controllers/billing.controller';
import { documentController } from '../controllers/document.controller';
import { indentController } from '../controllers/indent.controller';
import { poController } from '../controllers/po.controller';
import { validate } from '../../../middleware/validate.middleware';
import { createProjectSchema, updateProjectSchema, createMinorSchema } from '../validators/project.validator';

const router = Router();

// ==================== PROJECTS ====================
router.get('/projects', projectController.list);
router.post('/projects', validate(createProjectSchema), projectController.create);
router.get('/projects/:id', projectController.getById);
router.patch('/projects/:id', validate(updateProjectSchema), projectController.update);
router.delete('/projects/:id', projectController.delete);

// ==================== MINORS ====================
router.get('/projects/:id/minors', minorController.list);
router.post('/projects/:id/minors', validate(createMinorSchema), minorController.create);
router.patch('/minors/:minorId', minorController.update);
router.delete('/minors/:minorId', minorController.delete);
router.get('/minors/:minorId/schedule', minorController.getSchedule);
router.put('/minors/:minorId/schedule', minorController.upsertSchedule);

// ==================== DESIGN ====================
router.get('/projects/:id/design', projectController.getDesign);
router.put('/projects/:id/design', projectController.upsertDesign);

// ==================== EXECUTION (DPR) ====================
router.get('/projects/:id/executions', executionController.listExecutions);
router.post('/projects/:id/executions', executionController.createExecution);
router.patch('/executions/:entryId', executionController.updateExecution);
router.delete('/executions/:entryId', executionController.deleteExecution);

// ==================== ACTUAL MEASUREMENTS ====================
router.get('/projects/:id/actuals', executionController.listActuals);
router.post('/projects/:id/actuals', executionController.createActual);
router.patch('/actuals/:entryId', executionController.updateActual);
router.delete('/actuals/:entryId', executionController.deleteActual);

// ==================== STAGE ENTRIES (PROCESS FLOW SOP) ====================
router.get('/projects/:id/stage-entries', executionController.listStageEntries);
router.put('/stage-entries/:stageEntryId', executionController.upsertStageEntry);
router.put('/projects/:id/stage-entries/:stageEntryId', executionController.upsertStageEntry);

// ==================== CONTRACTOR PIPELINE STAGES ====================

router.get('/projects/:id/finalize-consultant', projectController.getFinalizeConsultant);
router.put('/projects/:id/finalize-consultant', projectController.upsertFinalizeConsultant);

// ==================== DRAWINGS & APPROVALS ====================
router.get('/projects/:id/drawing-upload', projectController.getDrawingUpload);
router.put('/projects/:id/drawing-upload', projectController.upsertDrawingUpload);

router.get('/projects/:id/final-approval', projectController.getFinalApproval);
router.put('/projects/:id/final-approval', projectController.upsertFinalApproval);

router.get('/projects/:id/drawings', projectController.getDrawings);
router.put('/projects/:id/drawings', projectController.upsertDrawings);

// ==================== MATERIAL REQUIREMENTS ====================
router.get('/projects/:id/material-requirements', projectController.listMaterialRequirements);
router.post('/projects/:id/material-requirements', projectController.createMaterialRequirement);
router.delete('/material-requirements/:reqId', projectController.deleteMaterialRequirement);

// ==================== RM / RA BILLS ====================
router.get('/projects/:id/rm-bills', billingController.listRMBills);
router.post('/projects/:id/rm-bills', billingController.createRMBill);
router.get('/rm-bills/:billId', billingController.getRMBill);
router.patch('/rm-bills/:billId', billingController.updateRMBill);
router.delete('/rm-bills/:billId', billingController.deleteRMBill);

// ==================== CALCULATION ENGINES STATE ====================
router.get('/projects/:id/calc-state/:stateType', projectController.getCalcState);
router.put('/projects/:id/calc-state/:stateType', projectController.upsertCalcState);

// ==================== PRODUCT IMF ====================
router.get('/product-imf/:poNumber', projectController.getProductIMF);
router.put('/product-imf/:poNumber', projectController.upsertProductIMF);

// ==================== DOCUMENTS & EMAIL LOGS ====================
router.get('/documents', documentController.listDocuments);
router.post('/documents', documentController.createDocument);
router.delete('/documents/:docId', documentController.deleteDocument);

router.get('/email-logs', documentController.listEmailLogs);
router.post('/email-logs', documentController.createEmailLog);

// ==================== INDENTS ====================
// ?stage=Pending,VendorRated (current stage), ?reviewed=indent|vendor|technical|management (History tabs), ?po_required=true
router.get('/indents', indentController.list);
router.post('/indents', indentController.create);
router.patch('/indents/:id/approve', indentController.approve);
router.patch('/indents/:id/vendor-rates', indentController.updateVendorRates);
router.patch('/indents/:id/technical-approval', indentController.technicalApproval);
router.patch('/indents/:id/management-approval', indentController.managementApproval);
router.delete('/indents/:id', indentController.delete);

// ==================== PURCHASE ORDERS ====================
router.get('/pos', poController.list);
router.post('/pos', poController.create);
router.get('/pos/:id', poController.getById);

export default router;

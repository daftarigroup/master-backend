import { Router } from 'express';
import { requireCostAccess, requireCostEdit } from '../../../middleware/requireCostAccess';
import { validateParsed } from '../../../middleware/validateParsed.middleware';
import { costController as c } from '../controllers/cost.controller';
import {
  billingEventsSchema, billingExportSchema, billingSummarySchema, costLogsSchema, costReportSchema, createCostEntrySchema, createRateSchema, createWbsSchema, endRateSchema, equipmentListSchema,
  equipmentSummarySchema, fleetCostSchema, getSettingsSchema, listWbsSchema, machineCostSchema, putSettingsSchema, setReceiptRateSchema,
  trendSchema, updateCostEntrySchema, updateWbsSchema, voidCostEntrySchema,
} from '../validators/cost.validator';

// Mounted inside the /api/fleet router (behind authenticateJWT). Every service is firm-scoped.
// Access rule: anything that shows or changes cost, rates or rental amounts goes through requireCostAccess (view) or
// requireCostEdit (change). The equipment list and WBS lookup are open to site users: they carry no cost.
const router = Router();

// Equipment Master (no cost unless the caller may see it; the service decides what to load)
router.get('/equipment', validateParsed(equipmentListSchema), c.equipmentList);
router.get('/equipment/:id/summary', validateParsed(equipmentSummarySchema), c.equipmentSummary);

// Cost Tracking (cost data: view permission)
router.get('/costs/fleet', requireCostAccess, validateParsed(fleetCostSchema), c.fleetCost);
router.get('/costs/report', requireCostAccess, validateParsed(costReportSchema), c.report);
router.get('/costs/machines/:id', requireCostAccess, validateParsed(machineCostSchema), c.machineCost);
router.get('/costs/machines/:id/trend', requireCostAccess, validateParsed(trendSchema), c.machineTrend);
router.get('/costs/machines/:id/logs/:kind', requireCostAccess, validateParsed(costLogsSchema), c.machineLogs);

// Billing data (Phase 7): read-only machine events for the billing team; cost data, so view permission
router.get('/billing/events', requireCostAccess, validateParsed(billingEventsSchema), c.billingEvents);
router.get('/billing/events/export', requireCostAccess, validateParsed(billingExportSchema), c.billingExport);
router.get('/billing/machines/:id/summary', requireCostAccess, validateParsed(billingSummarySchema), c.billingSummary);

// Rate card and manual cost entries (change: admin)
router.post('/machines/:id/rates', requireCostEdit, validateParsed(createRateSchema), c.createRate);
router.post('/machines/:id/rates/:rateId/end', requireCostEdit, validateParsed(endRateSchema), c.endRate);
router.post('/cost-entries', requireCostEdit, validateParsed(createCostEntrySchema), c.createCostEntry);
router.patch('/cost-entries/:id', requireCostEdit, validateParsed(updateCostEntrySchema), c.updateCostEntry);
router.post('/cost-entries/:id/void', requireCostEdit, validateParsed(voidCostEntrySchema), c.voidCostEntry);
router.patch('/diesel/receipts/:id/rate', requireCostEdit, validateParsed(setReceiptRateSchema), c.setReceiptRate);

// WBS activities: anyone who can open Daily Entry may read them; only an admin creates or closes them
router.get('/wbs', validateParsed(listWbsSchema), c.listWbs);
router.post('/wbs', requireCostEdit, validateParsed(createWbsSchema), c.createWbs);
router.patch('/wbs/:id', requireCostEdit, validateParsed(updateWbsSchema), c.updateWbs);

// Firm settings (shift, idle threshold, default diesel price: a price is cost data)
router.get('/settings', requireCostAccess, validateParsed(getSettingsSchema), c.getSettings);
router.put('/settings', requireCostEdit, validateParsed(putSettingsSchema), c.putSettings);

export default router;

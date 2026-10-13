import { Router } from 'express';
import { requireLogin } from '../../../middleware/auth.middleware';
import { validateParsed } from '../../../middleware/validateParsed.middleware';
import costRoutes from './cost.routes';
import documentRoutes from './document.routes';
import opsRoutes from './ops.routes';
import { fleetController as c } from '../controllers/fleet.controller';
import {
  alertsSchema, closeUsageLogSchema, createReceiptSchema, createUsageLogSchema, dailyEntrySchema,
  efficiencySchema, ledgerExportSchema, ledgerSchema, listDieselLogsSchema, listFleetMachinesSchema, listReceiptsSchema,
  listUsageLogsSchema, machineHistorySchema, machineIdSchema, voidSchema,
} from '../validators/fleet.validator';

// Mounted at /api/fleet behind authenticateJWT. Every route is firm-scoped in its service.
const router = Router();
router.use(requireLogin); // fleet data is for logged-in users only

// Machine pickers and per-machine logbook
router.get('/machines', validateParsed(listFleetMachinesSchema), c.machines);
router.get('/machines/:id/last-reading', validateParsed(machineIdSchema), c.lastReading);
router.get('/machines/:id/history', validateParsed(machineHistorySchema), c.history);

// Site diesel stock: receipts in, issues out
router.post('/diesel/receipts', validateParsed(createReceiptSchema), c.createReceipt);
router.get('/diesel/receipts', validateParsed(listReceiptsSchema), c.listReceipts);
router.post('/diesel/receipts/:id/void', validateParsed(voidSchema), c.voidReceipt);
router.get('/diesel/logs', validateParsed(listDieselLogsSchema), c.listDieselLogs);
router.post('/diesel/logs/:id/void', validateParsed(voidSchema), c.voidDieselLog);

// Machine usage logbook (meter readings)
router.post('/usage-logs', validateParsed(createUsageLogSchema), c.createUsageLog);
router.get('/usage-logs', validateParsed(listUsageLogsSchema), c.listUsageLogs);
router.patch('/usage-logs/:id/close', validateParsed(closeUsageLogSchema), c.closeUsageLog);
router.post('/usage-logs/:id/void', validateParsed(voidSchema), c.voidUsageLog);

// One save for diesel + usage together (single transaction)
router.post('/daily-entry', validateParsed(dailyEntrySchema), c.dailyEntry);

// Reporting
router.get('/ledger', validateParsed(ledgerSchema), c.ledger);
router.get('/ledger/export', validateParsed(ledgerExportSchema), c.exportLedger);
router.get('/efficiency', validateParsed(efficiencySchema), c.efficiency);
router.get('/alerts', validateParsed(alertsSchema), c.alerts);

// Equipment Master, Cost Tracking, rate cards, cost entries, WBS and fleet settings
router.use(costRoutes);
router.use(opsRoutes); // work logs, assignments, operators, availability, transfers
router.use('/documents', documentRoutes); // machine and operator documents

export default router;

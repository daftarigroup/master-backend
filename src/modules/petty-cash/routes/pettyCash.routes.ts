import { Router } from 'express';
import { creditsController } from '../controllers/credits.controller';
import { expensesController } from '../controllers/expenses.controller';
import { ledgerController } from '../controllers/ledger.controller';
import { settingsController } from '../controllers/settings.controller';
import { projectMasterController } from '../controllers/projectMaster.controller';
import { dashboardController } from '../controllers/dashboard.controller';

const router = Router();

// Dashboard
router.get('/dashboard/summary', dashboardController.getSummary);

// Credits
router.get('/credits', creditsController.list);
router.get('/credits/:id', creditsController.getById);
router.post('/credits', creditsController.create);
router.put('/credits/:id', creditsController.update);

// Expenses
router.get('/expenses', expensesController.list);
router.get('/expenses/:id', expensesController.getById);
router.post('/expenses', expensesController.create);
router.put('/expenses/:id', expensesController.update);
router.put('/expenses/:id/status', expensesController.updateStatus);

// Ledger
router.get('/ledger', ledgerController.list);
router.get('/ledger/balance/:personName', ledgerController.getBalance);

// Settings
router.get('/settings', settingsController.get);
router.put('/settings', settingsController.update);
router.post('/settings/payment-modes', settingsController.addPaymentMode);
router.delete('/settings/payment-modes/:name', settingsController.removePaymentMode);

// Project Master
router.get('/project-master', projectMasterController.list);
router.get('/project-master/:id', projectMasterController.getById);
router.post('/project-master', projectMasterController.create);
router.put('/project-master/:id', projectMasterController.update);
router.delete('/project-master/:id', projectMasterController.delete);

export default router;

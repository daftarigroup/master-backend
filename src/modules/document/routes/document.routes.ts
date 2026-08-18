import { Router } from 'express';
import { documentsController } from '../controllers/documents.controller';
import { subscriptionsController } from '../controllers/subscriptions.controller';
import { loansController } from '../controllers/loans.controller';

const router = Router();

// Documents
router.get('/documents', documentsController.list);
router.get('/documents/renewals', documentsController.listRenewals);
router.get('/documents/shares', documentsController.listShares);
router.get('/documents/shares/:serial', documentsController.listShares);
router.get('/documents/:id', documentsController.getById);
router.post('/documents', documentsController.create);
router.put('/documents/:id', documentsController.update);
router.delete('/documents/:id', documentsController.delete);
router.get('/documents/:id/renewals', documentsController.listRenewals);
router.post('/documents/:id/renewals', documentsController.recordRenewal);
router.post('/documents/:id/share', documentsController.recordShare);

// Subscriptions
router.get('/subscriptions', subscriptionsController.list);
router.get('/subscriptions/renewals', subscriptionsController.listRenewals);
router.get('/subscriptions/:id', subscriptionsController.getById);
router.post('/subscriptions', subscriptionsController.create);
router.put('/subscriptions/:id', subscriptionsController.update);
router.delete('/subscriptions/:id', subscriptionsController.delete);
router.put('/subscriptions/:id/approval', subscriptionsController.recordApproval);
router.put('/subscriptions/:id/payment', subscriptionsController.recordPayment);
router.get('/subscriptions/:id/renewals', subscriptionsController.listRenewals);
router.post('/subscriptions/:id/renewals', subscriptionsController.recordRenewal);

// Loans
router.get('/loans', loansController.list);
router.get('/loans/:id', loansController.getById);
router.post('/loans', loansController.create);
router.put('/loans/:id', loansController.update);
router.delete('/loans/:id', loansController.delete);
router.put('/loans/:id/foreclosure', loansController.requestForeclosure);
router.put('/loans/:id/documents', loansController.collectDocuments);
router.put('/loans/:id/noc', loansController.collectNoc);
router.put('/loans/:id/settlement', loansController.settleLoan);

export default router;

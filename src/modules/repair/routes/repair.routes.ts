import { Router } from 'express';
import { validate } from '../../../middleware/validate.middleware';
import { indentController } from '../controllers/indent.controller';
import { vendorController, technicianController, sparePartController, amcController } from '../controllers/misc.controller';
import { approveIndentSchema, createAmcSchema, createIndentSchema, createSparePartSchema, createTechnicianSchema, createVendorSchema } from '../validators/repair.validator';

const router = Router();

// Reporting / aggregate views
router.get('/dashboard-stats', indentController.dashboardStats);
router.get('/daily-report', indentController.dailyReport);
router.get('/calendar', indentController.calendar);
router.get('/store-in', indentController.storeIn);
router.get('/sent-machine', indentController.sentMachine);
router.get('/payments', indentController.payments);

// Indents
router.get('/indents/next-serial', indentController.nextSerial);
router.get('/indents/by-machine', indentController.byMachine);
router.get('/indents/:id', indentController.getById);
router.get('/indents', indentController.list);
router.post('/indents', validate(createIndentSchema), indentController.create);
router.patch('/indents/:id', indentController.update);
router.post('/indents/:id/approve', validate(approveIndentSchema), indentController.approve);
router.post('/indents/:id/reject', indentController.reject);
router.post('/indents/:id/assign-technician', indentController.assignTechnician);
router.post('/indents/:id/complete', indentController.complete);
router.post('/indents/:id/inspection', indentController.submitInspection);

// Outhouse vendor lifecycle (per indent)
router.post('/indents/:id/outhouse/vendor', indentController.saveOuthouseVendor);
router.post('/indents/:id/outhouse/offers', indentController.saveOuthouseOffers);
router.post('/indents/:id/outhouse/offers/:offerId/approve', indentController.approveOuthouseRate);
router.post('/indents/:id/outhouse/dispatch', indentController.recordOuthouseDispatch);
router.post('/indents/:id/outhouse/receiving', indentController.recordOuthouseReceiving);
router.post('/indents/:id/outhouse/payment', indentController.completeOuthousePayment);

// Vendors
router.get('/vendors', vendorController.list);
router.post('/vendors', validate(createVendorSchema), vendorController.create);

// Technicians
router.get('/technicians/page', technicianController.page);
router.get('/technicians', technicianController.list);
router.post('/technicians', validate(createTechnicianSchema), technicianController.create);
router.patch('/technicians/:id', technicianController.update);
router.delete('/technicians/:id', technicianController.delete);

// Spare Parts
router.get('/spare-parts/vendors', sparePartController.uniqueVendors);
router.get('/spare-parts/parts', sparePartController.uniqueParts);
router.get('/spare-parts/machine-types', sparePartController.uniqueMachineTypes);
router.get('/spare-parts', sparePartController.list);
router.post('/spare-parts', validate(createSparePartSchema), sparePartController.create);
router.delete('/spare-parts/:id', sparePartController.delete);

// AMC
router.get('/amc', amcController.list);
router.post('/amc', validate(createAmcSchema), amcController.create);

export default router;

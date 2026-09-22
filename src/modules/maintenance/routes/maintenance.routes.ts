import { Router } from 'express';
import { validate } from '../../../middleware/validate.middleware';
import { machineController } from '../controllers/machine.controller';
import { machinePartController } from '../controllers/machinePart.controller';
import { activityTypeController } from '../controllers/activityType.controller';
import { planController } from '../controllers/plan.controller';
import { workOrderController } from '../controllers/workOrder.controller';
import { breakdownController } from '../controllers/breakdown.controller';
import { dailyMachineLogController } from '../controllers/dailyMachineLog.controller';
import { reportsController } from '../controllers/reports.controller';
import {
  cancelWorkOrderSchema,
  createBreakdownSchema,
  createDailyMachineLogSchema,
  createMachineSchema,
  createPlanSchema,
  extendWorkOrderSchema,
  markNotDoneSchema,
  rejectWorkOrderSchema,
  transferWorkOrderSchema,
} from '../validators/maintenance.validator';

const router = Router();

// Reports (mounted before /machines etc. only matters for path specificity, not overlap here)
router.get('/reports/cost-analysis', reportsController.costAnalysis);
router.get('/reports/machine-reliability', reportsController.machineReliability);

// Shared Dropdowns
const getDepartments = async (_req: any, res: any, next: any) => {
  try {
    const { prisma } = await import('../../../database/prisma');
    const departments = await prisma.department.findMany({ orderBy: { name: 'asc' } });
    res.json({
      status: 'success',
      data: departments.map((d: any) => ({ id: d.id.toString(), name: d.name, code: null, status: 'ACTIVE' })),
      pagination: { total: departments.length, limit: 200, page: 1 },
    });
  } catch (err) {
    next(err);
  }
};

const getFirms = async (_req: any, res: any, next: any) => {
  try {
    const { prisma } = await import('../../../database/prisma');
    const firms = await prisma.firm.findMany({ where: { active: true }, orderBy: { firm_name: 'asc' } });
    res.json({
      status: 'success',
      data: firms.map((f: any) => ({
        id: f.id.toString(),
        name: f.firm_name,
        code: f.id.toString(),
        billingAddress: f.billing_address || null,
        destinationAddress: f.destination_address || null,
        contactPerson: f.contact_person || null,
        active: f.active,
      })),
      pagination: { total: firms.length, limit: 200, page: 1 },
    });
  } catch (err) {
    next(err);
  }
};

router.get('/departments', getDepartments);
router.get('/firms', getFirms);
router.get('/projects', getFirms);

// Activity Types
router.get('/activity-types', activityTypeController.list);
router.post('/activity-types', activityTypeController.create);
router.delete('/activity-types/:id', activityTypeController.delete);

// Machines
router.get('/machines', machineController.list);
router.get('/machines/:id', machineController.getById);
router.post('/machines', validate(createMachineSchema), machineController.create);
router.patch('/machines/:id', machineController.update);
router.delete('/machines/:id', machineController.delete);

// Machine Parts
router.get('/machine-parts', machinePartController.list);
router.get('/machine-parts/:id', machinePartController.getById);
router.post('/machine-parts', machinePartController.create);
router.patch('/machine-parts/:id', machinePartController.update);
router.delete('/machine-parts/:id', machinePartController.delete);

// Plans
router.get('/plans', planController.list);
router.get('/plans/:id', planController.getById);
router.post('/plans', validate(createPlanSchema), planController.create);
router.patch('/plans/:id', planController.update);
router.post('/plans/:id/pause', planController.pause);
router.post('/plans/:id/resume', planController.resume);
router.post('/plans/:id/archive', planController.archive);

// Work Orders
router.get('/work-orders/approval-history', workOrderController.approvalHistory);
router.get('/work-orders/stats', workOrderController.stats);
router.get('/work-orders/:id', workOrderController.getById);
router.get('/work-orders', workOrderController.list);
router.post('/work-orders/:id/transfer', validate(transferWorkOrderSchema), workOrderController.transfer);
router.post('/work-orders/:id/mark-done', workOrderController.markDone);
router.post('/work-orders/:id/mark-not-done', validate(markNotDoneSchema), workOrderController.markNotDone);
router.post('/work-orders/:id/extend', validate(extendWorkOrderSchema), workOrderController.extend);
router.post('/work-orders/:id/hold', workOrderController.hold);
router.post('/work-orders/:id/cancel', validate(cancelWorkOrderSchema), workOrderController.cancel);
router.post('/work-orders/:id/skip', workOrderController.skip);
router.post('/work-orders/:id/approve', workOrderController.approve);
router.post('/work-orders/:id/reject', validate(rejectWorkOrderSchema), workOrderController.reject);
router.post('/work-orders/:id/process-repair', workOrderController.processRepair);

// Breakdowns
router.get('/breakdowns', breakdownController.list);
router.post('/breakdowns', validate(createBreakdownSchema), breakdownController.create);
router.put('/breakdowns/:id/resolve', breakdownController.resolve);
router.put('/breakdowns/:id/status', breakdownController.updateStatus);

// Daily Machine Logs
router.get('/daily-machine-logs/stats', dailyMachineLogController.stats);
router.get('/daily-machine-logs', dailyMachineLogController.list);
router.post('/daily-machine-logs', validate(createDailyMachineLogSchema), dailyMachineLogController.create);

export default router;

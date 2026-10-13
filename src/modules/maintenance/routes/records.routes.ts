import { Router } from 'express';
import { validateParsed } from '../../../middleware/validateParsed.middleware';
import { recordsController as c } from '../controllers/records.controller';
import {
  createScheduleSchema, listRecordsSchema, listSchedulesSchema, listTemplatesSchema, recordMachineSchema,
  recordPageSchema, saveTemplateSchema, scheduleServiceSchema, updateScheduleSchema,
} from '../validators/records.validator';

// Mounted inside the /api/maintenance router (behind authenticateJWT + requireLogin). Machines are firm-scoped in the services;
// schedules and templates are admin changes; Schedule Service is for admins and the machine's responsible person.
const router = Router();

router.get('/records', validateParsed(listRecordsSchema), c.list);
router.get('/records/:machineId', validateParsed(recordMachineSchema), c.summary);
router.get('/records/:machineId/history', validateParsed(recordPageSchema), c.history);
router.get('/records/:machineId/parts', validateParsed(recordPageSchema), c.parts);

router.get('/schedules', validateParsed(listSchedulesSchema), c.listSchedules);
router.post('/schedules', validateParsed(createScheduleSchema), c.createSchedule);
router.patch('/schedules/:id', validateParsed(updateScheduleSchema), c.updateSchedule);
router.post('/schedules/:id/schedule-service', validateParsed(scheduleServiceSchema), c.scheduleService);

router.get('/checklist-templates', validateParsed(listTemplatesSchema), c.listTemplates);
router.put('/checklist-templates', validateParsed(saveTemplateSchema), c.saveTemplate);


export default router;

import { z } from 'zod';
import { bigId, blankToUndefined, optBigId, optDate, optText } from '../../../utils/zodIds';

// Maintenance Records, service schedules, checklist templates and machine documents (used with validateParsed).
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const nullableDay = z.union([day, z.null()]).optional();
const limit = z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(500).optional());
const offset = z.preprocess(blankToUndefined, z.coerce.number().int().min(0).optional());
const machineParams = z.object({ machineId: z.string().min(1) });
const idParams = z.object({ id: z.string().min(1) });
const positive = z.preprocess(blankToUndefined, z.coerce.number().positive().optional());
const nonNeg = z.preprocess(blankToUndefined, z.coerce.number().min(0).optional());

export const listRecordsSchema = z.object({
  query: z.object({
    firmId: z.string().optional(),
    dueStatus: z.preprocess(blankToUndefined, z.enum(['OVERDUE', 'DUE_SOON', 'OK', 'NOT_SET']).optional()),
    q: optText,
    category: optText,
    ownership: z.preprocess(blankToUndefined, z.enum(['OWNED', 'RENTED']).optional()),
    siteId: optBigId,
    limit,
    offset,
  }),
});
export const recordMachineSchema = z.object({ params: machineParams });
export const recordPageSchema = z.object({ params: machineParams, query: z.object({ limit, offset }) });

export const listSchedulesSchema = z.object({ query: z.object({ machineId: z.string().min(1, 'machineId is required') }) });
const scheduleFields = {
  intervalValue: positive,
  intervalDays: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  leadValue: nonNeg,
  leadDays: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).optional()),
  lastServiceAt: z.preprocess(blankToUndefined, day.optional()),
  lastServiceReading: nonNeg,
  checklistTemplateId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
};
export const createScheduleSchema = z.object({ body: z.object({ machineId: z.string().min(1), name: z.string().trim().min(1).max(120), ...scheduleFields }) });
export const updateScheduleSchema = z.object({
  params: idParams,
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    ...scheduleFields,
    isActive: z.boolean().optional(),
  }),
});
export const scheduleServiceSchema = z.object({
  params: idParams,
  body: z.object({
    dueAt: optDate,
    assigneeId: optBigId,
    responsibleId: optBigId,
    estPartsCost: nonNeg,
    estLabourCost: nonNeg,
    serviceMode: z.preprocess(blankToUndefined, z.enum(['IN_HOUSE', 'VENDOR']).optional()),
    vendorId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  }),
});

export const listTemplatesSchema = z.object({ query: z.object({ firmId: bigId }) });
export const saveTemplateSchema = z.object({
  body: z.object({
    id: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    firmId: bigId,
    name: z.string().trim().min(1).max(120),
    items: z.array(z.string().trim().max(200)).min(1).max(60),
    isActive: z.boolean().optional(),
  }),
});


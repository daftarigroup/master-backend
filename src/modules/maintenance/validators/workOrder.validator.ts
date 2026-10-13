import { z } from 'zod';
import { blankToUndefined, optBigId, optDate, optText, reqNumber } from '../../../utils/zodIds';

// Used with validateParsed (coerced / trimmed values reach the service; unknown keys are dropped).

const workOrderType = z.enum(['SCHEDULED', 'BREAKDOWN', 'ONE_TIME', 'REPAIR']);
// Priority: the enum, or the 1 (Low) .. 4 (Critical) numbers the screens already use.
const PRIORITY_NAMES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const priority = z.preprocess((v) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  // 1..4 map to the enum; any other number is left as-is so the enum check rejects it (it used to default silently)
  return Number.isInteger(n) && n >= 1 && n <= 4 ? PRIORITY_NAMES[n - 1] : v;
}, z.enum(PRIORITY_NAMES).optional());

export const createWorkOrderSchema = z.object({
  body: z.object({
    type: workOrderType,
    machineId: z.string().min(1, 'machineId is required'),
    firmId: optBigId,
    title: z.string().trim().min(1, 'title is required').max(200),
    description: optText,
    activityTypeId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    dueAt: z.coerce.date(),
    assigneeId: optBigId,
    priority,
    documentUrl: optText,
    machinePartId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    // task assignment and service details
    responsibleId: optBigId,
    scheduleId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    serviceMode: z.preprocess(blankToUndefined, z.enum(['IN_HOUSE', 'VENDOR']).optional()),
    vendorId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    estPartsCost: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional()),
    estLabourCost: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional()),
    breakdownReportId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    failureType: optText,
    failureTime: z.preprocess(blankToUndefined, z.coerce.date().optional()),
    estimatedDowntimeHours: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional()),
    rootCause: optText,
    remarks: optText,
  }),
});

const optMoney = z.preprocess(blankToUndefined, z.coerce.number().min(0).optional());

export const markDoneSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    completionNote: optText,
    actualMinutesTaken: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).optional()),
    documentUrl: optText,
    readingAtService: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional()),
    actualPartsCost: optMoney,
    actualLabourCost: optMoney,
  }).passthrough(),
});

export const reassignSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    toUserId: z.union([z.string(), z.number()]).transform(String),
    type: z.enum(['OCCURRENCE_TRANSFER', 'PERMANENT_TRANSFER', 'TEMPORARY_COVER']).default('OCCURRENCE_TRANSFER'),
    reason: z.string().trim().min(3, 'Give a reason for reassigning (at least 3 characters)').max(300),
    newDueDate: optDate,
  }),
});

export const checklistItemSchema = z.object({
  params: z.object({ id: z.string().min(1), itemId: z.string().min(1) }),
  body: z.object({
    state: z.enum(['PENDING', 'DONE', 'ISSUE']),
    note: optText,
    photoUrl: optText,
  }),
});

export const partUsedSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    partName: z.string().trim().min(1).max(200),
    quantity: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(1)),
    unitCost: optMoney,
    vendorName: optText,
    machinePartId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    warrantyFromDate: optDate,
    warrantyToDate: optDate,
  }),
});

const idParams = z.object({ id: z.string().min(1) });

export const outsourceSendSchema = z.object({
  params: idParams,
  body: z.object({
    vendorId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    vendorName: optText,
    sentAt: optDate,
  }),
});

export const outsourceReceiveSchema = z.object({
  params: idParams,
  body: z.object({
    receivedAt: optDate,
    billNo: optText,
    billAmount: reqNumber.min(0, 'billAmount cannot be negative'),
    billUrl: optText,
  }),
});

export const outsourcePaySchema = z.object({
  params: idParams,
  body: z.object({
    paidAt: optDate,
    amount: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional()),
  }),
});

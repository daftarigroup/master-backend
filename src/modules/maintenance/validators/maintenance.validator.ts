import { z } from 'zod';

const machineCategory = z.enum(['PRODUCTION', 'UTILITY', 'MATERIAL_HANDLING', 'HVAC', 'ELECTRICAL', 'INSTRUMENTATION', 'SAFETY', 'FACILITY']);

export const createMachineSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'name is required'),
    assetCode: z.string().trim().optional(),
    category: machineCategory,
    firmId: z.string().optional(),
    projectId: z.string().optional(),
    departmentId: z.string().optional(),
    serialNumber: z.string().optional(),
    modelNumber: z.string().optional(),
    manufacturer: z.string().optional(),
    supplier: z.string().optional(),
    location: z.string().optional(),
    criticalityLevel: z.coerce.number().int().min(1).max(5).optional(),
  }),
});

const planFrequency = z.enum([
  'ONE_TIME', 'DAILY', 'WEEKLY', 'FORTNIGHTLY', 'ALTERNATE_DAYS', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY',
  'IN_FIRST_WEEK', 'IN_SECOND_WEEK', 'IN_THIRD_WEEK', 'IN_FOURTH_WEEK', 'RUNNING_HOURS', 'METER_BASED',
]);

export const createPlanSchema = z.object({
  body: z.object({
    machineId: z.string().min(1),
    assignedToId: z.string().min(1),
    title: z.string().trim().min(1),
    activityTypeId: z.string().optional(),
    frequency: planFrequency,
    startDate: z.string().min(1),
    priority: z.coerce.number().int().min(1).max(4).optional(),
    description: z.string().optional(),
    machinePartId: z.string().optional(),
    documentUrl: z.string().optional(),
    documentMediaId: z.string().optional(),
    isRepair: z.boolean().optional(),
    workOrderType: z.string().optional(),
    scheduleConfig: z.record(z.string(), z.any()).optional(),
  }),
});

const breakdownSeverity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

export const createBreakdownSchema = z.object({
  body: z.object({
    machineId: z.string().min(1),
    failureType: z.string().trim().min(1),
    description: z.string().trim().min(1),
    severity: breakdownSeverity,
    estimatedDowntimeHours: z.coerce.number().nonnegative().optional(),
    remarks: z.string().optional(),
    assignToUserId: z.string().optional(),
  }),
});

export const createDailyMachineLogSchema = z.object({
  body: z.object({
    machineId: z.string().min(1),
    date: z.string().min(1),
    startTimeReading: z.string().optional(),
    endTimeReading: z.string().optional(),
    runtimeHours: z.coerce.number().nonnegative(),
    temperature: z.coerce.number(),
    load: z.coerce.number(),
    operatorName: z.string().trim().min(1),
    remarks: z.string().optional(),
  }),
});

export const transferWorkOrderSchema = z.object({
  body: z.object({
    toUserId: z.string().min(1),
    type: z.enum(['OCCURRENCE_TRANSFER', 'PERMANENT_TRANSFER', 'TEMPORARY_COVER']),
    reason: z.string().optional(),
    newDueDate: z.string().optional(),
  }),
});

export const cancelWorkOrderSchema = z.object({ body: z.object({ reason: z.string().trim().min(1) }) });
export const markNotDoneSchema = z.object({ body: z.object({ reason: z.string().trim().min(1) }) });
export const extendWorkOrderSchema = z.object({ body: z.object({ newDueDate: z.string().min(1), reason: z.string().optional() }) });
export const rejectWorkOrderSchema = z.object({ body: z.object({ reviewNote: z.string().trim().min(1), newDueDate: z.string().optional() }) });

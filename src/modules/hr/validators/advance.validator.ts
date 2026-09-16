import { z } from 'zod';

const advanceBodySchema = z.object({
  employeeId: z.string().min(1, 'Employee ID is required'),
  employeeName: z.string().min(1, 'Employee name is required'),
  empCode: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  departmentName: z.string().optional().nullable(),
  requestAmount: z.number().positive('Request amount must be greater than 0'),
  monthlyDeduction: z.number().positive('Monthly deduction must be greater than 0'),
  noOfMonths: z.number().int().positive('Number of months must be positive').optional().nullable(),
  reason: z.string().min(1, 'Reason is required'),
}).passthrough();

export const submitAdvanceRequestSchema = z.object({ body: advanceBodySchema });

export const updateAdvanceStatusSchema = z.object({
  body: z
    .object({
      status: z.enum(['pending', 'approved', 'rejected', 'completed']),
      remarks: z.string().optional().nullable(),
      approvedAmount: z.coerce.number().positive().optional().nullable(),
      approvedMonthlyDeduction: z.coerce.number().positive().optional().nullable(),
      approvedNoOfMonths: z.coerce.number().int().positive().optional().nullable(),
      startDeductionMonth: z
        .string()
        .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Must be in YYYY-MM or YYYY-MM-DD format')
        .or(z.literal(''))
        .optional()
        .nullable(),
    })
    .passthrough(),
});

export const updateAdvanceRequestSchema = z.object({
  body: advanceBodySchema
    .extend({
      approvedAmount: z.coerce.number().positive().optional().nullable(),
      approvedMonthlyDeduction: z.coerce.number().positive().optional().nullable(),
      approvedNoOfMonths: z.coerce.number().int().positive().optional().nullable(),
      startDeductionMonth: z
        .string()
        .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Must be in YYYY-MM or YYYY-MM-DD format')
        .or(z.literal(''))
        .optional()
        .nullable(),
      remarks: z.string().optional().nullable(),
      status: z.enum(['pending', 'approved', 'rejected', 'completed']).optional().nullable(),
    })
    .partial()
    .passthrough(),
});

import { z } from 'zod';

export const recordResignationSchema = z.object({
  body: z.object({
    employeeId: z.union([z.string(), z.number()]),
    resignationDate: z.string().min(1, 'Resignation date is required'),
    lastWorkingDay: z.string().min(1, 'Last working day is required'),
    leavingReason: z.string().optional().nullable(),
  }),
});

export const processExitSchema = z.object({
  body: z.object({
    status: z.enum(['on_notice', 'exit_interview', 'left', 'completed']).optional(),
    exitChecklist: z.record(z.string(), z.any()).optional(),
    advancePaymentTaken: z.boolean().optional(),
    advancePaymentAmount: z.number().optional().nullable(),
    advancePaymentSettled: z.boolean().optional(),
    experienceLetterIssued: z.boolean().optional(),
  }),
});

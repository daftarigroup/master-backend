import { z } from 'zod';

export const upsertAttendanceSchema = z.object({
  body: z.object({
    employeeId: z.string().min(1, 'Employee ID is required'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    shiftId: z.string().optional().nullable(),
    checkIn: z.string().optional().nullable(),
    checkOut: z.string().optional().nullable(),
    status: z.string().optional(),
    notes: z.string().optional().nullable(),
  }),
});

export const updateAttendanceConfigSchema = z.object({
  body: z.object({
    fullDayHours: z.number().min(1).max(24),
    halfDayMinHours: z.number().min(1).max(12),
    lateGraceMinutes: z.number().min(0).max(120),
  }),
});

const claimBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  claimType: z.enum(['PUNCH_MIS', 'OVERTIME', 'WEEKEND_PRESENT']),
  checkIn: z.string().optional().nullable(),
  checkOut: z.string().optional().nullable(),
  overtimeHours: z.number().optional().nullable(),
  reason: z.string().min(1, 'Reason is required'),
});

export const submitClaimSchema = z.object({ body: claimBodySchema });

export const adminSubmitClaimSchema = z.object({
  body: claimBodySchema.extend({
    employeeId: z.string().min(1, 'Employee ID is required'),
  }),
});

export const claimReviewSchema = z.object({
  body: z.object({
    reviewNote: z.string().optional().nullable(),
    status: z.enum(['APPROVED', 'REJECTED']).optional(),
  }),
});

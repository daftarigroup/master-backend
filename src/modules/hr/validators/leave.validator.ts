import { z } from 'zod';

export const leaveDayEntrySchema = z.object({
  date: z.string(),
  type: z.enum(['full', 'half']),
  half: z.enum(['first', 'second']).optional(),
  decision: z.enum(['approved', 'rejected']).optional(),
});

export const taskTransferDecisionSchema = z.object({
  taskId: z.string(),
  action: z.enum(['transfer', 'skip']),
  newDoerId: z.string().optional(),
  newDoerName: z.string().optional(),
});

export const submitLeaveSchema = z.object({
  body: z.object({
    employeeId: z.string().min(1, 'Employee ID is required'),
    employeeName: z.string().min(1, 'Employee name is required'),
    departmentId: z.union([z.string(), z.number()]).optional().nullable(),
    hodName: z.string().min(1, 'HOD name is required'),
    hodId: z.string().optional().nullable(),
    substitute: z.string().min(1, 'Substitute is required'),
    leaveType: z.string().optional().nullable(),
    fromDate: z.string().min(1, 'From date is required'),
    toDate: z.string().min(1, 'To date is required'),
    days: z.number().optional(),
    leaveDays: z.array(leaveDayEntrySchema).optional(),
    reason: z.string().min(1, 'Reason is required'),
    status: z.string().optional(),
  }),
});

export const updateLeaveStatusSchema = z.object({
  body: z.object({
    status: z.enum(['approved', 'rejected', 'pending']),
    remarks: z.string().optional().nullable(),
    leaveDays: z.array(leaveDayEntrySchema).optional(),
    taskDecisions: z.array(taskTransferDecisionSchema).optional(),
  }),
});

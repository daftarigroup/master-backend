import { z } from 'zod';

export const issueGatePassSchema = z.object({
  body: z.object({
    employeeId: z.string().min(1, 'Employee ID is required'),
    employeeName: z.string().optional().nullable(),
    empCode: z.string().optional().nullable(),
    departmentName: z.string().optional().nullable(),
    type: z.union([z.enum(['Personal', 'Official']), z.string()]).default('Official'),
    placeToVisit: z.string().min(1, 'Place to visit is required'),
    reason: z.string().min(1, 'Reason is required'),
    departureTime: z.string().optional().nullable(),
    expectedArrival: z.string().optional().nullable(),
    outTime: z.string().optional().nullable(),
    inTime: z.string().optional().nullable(),
    approvedBy: z.string().optional().nullable(),
    whatsappNo: z.string().optional().nullable(),
    attachment: z.string().optional().nullable(),
    status: z.string().optional(),
  }),
});

export const updateGatePassStatusSchema = z.object({
  body: z.object({
    status: z.enum(['open', 'out', 'closed', 'rejected', 'pending']),
    notes: z.string().optional().nullable(),
  }),
});

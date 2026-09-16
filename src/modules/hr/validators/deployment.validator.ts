import { z } from 'zod';

export const createAssignmentSchema = z.object({
  body: z
    .object({
      employee_id: z.string().nullish(),
      employeeId: z.string().nullish(),
      firm_id: z.coerce.number().nullish(),
      projectId: z.coerce.number().nullish(),
      firm_name: z.string().nullish(),
      projectName: z.string().nullish(),
      role_on_project: z.string().nullish(),
      roleOnProject: z.string().nullish(),
      assigned_date: z.string().nullish(),
      assignedDate: z.string().nullish(),
      reason: z.string().nullish(),
      approved_by: z.string().nullish(),
      approvedBy: z.string().nullish(),
    })
    .refine((d) => !!(d.employee_id || d.employeeId), {
      message: 'employee_id or employeeId is required',
    })
    .refine((d) => d.firm_id !== undefined || d.projectId !== undefined, {
      message: 'firm_id or projectId is required',
    }),
});

export const shiftAssignmentSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Assignment id is required'),
  }),
  body: z
    .object({
      to_firm_id: z.coerce.number().nullish(),
      toProjectId: z.coerce.number().nullish(),
      to_firm_name: z.string().nullish(),
      toProjectName: z.string().nullish(),
      role_on_project: z.string().nullish(),
      roleOnProject: z.string().nullish(),
      shift_date: z.string().nullish(),
      shiftDate: z.string().nullish(),
      reason: z.string().nullish(),
      approved_by: z.string().nullish(),
      approvedBy: z.string().nullish(),
    })
    .refine((d) => d.to_firm_id !== undefined || d.toProjectId !== undefined, {
      message: 'to_firm_id or toProjectId is required',
    }),
});

export const leaveAssignmentSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Assignment id is required'),
  }),
  body: z.object({
    reason: z.string().nullish(),
    effective_date: z.string().nullish(),
    effectiveDate: z.string().nullish(),
  }),
});

export const resumeAssignmentSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Assignment id is required'),
  }),
  body: z.object({
    reason: z.string().nullish(),
    effective_date: z.string().nullish(),
    effectiveDate: z.string().nullish(),
  }),
});

export const removeAssignmentSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Assignment id is required'),
  }),
  body: z.object({
    reason: z.string().nullish(),
    effective_date: z.string().nullish(),
    effectiveDate: z.string().nullish(),
  }),
});

export const completeAssignmentSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Assignment id is required'),
  }),
  body: z.object({
    reason: z.string().nullish(),
    effective_date: z.string().nullish(),
    effectiveDate: z.string().nullish(),
  }),
});

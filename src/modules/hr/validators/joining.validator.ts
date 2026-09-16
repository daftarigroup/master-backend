import { z } from 'zod';

export const initiateJoiningRouteSchema = z.object({
  body: z.object({
    candidateId: z.number().int().positive(),
    joiningDate: z.string().min(1, 'Joining date is required'),
    status: z.string().optional(),
  }),
});

export const updateJoiningRouteSchema = z.object({
  body: z.object({
    status: z.string().optional(),
    documents: z.record(z.string(), z.any()).optional(),
  }),
});

export const onboardingUpdateSchema = z.object({
  body: z.object({
    offerLetterIssued: z.boolean().optional(),
    idCardIssued: z.boolean().optional(),
    inductionDone: z.boolean().optional(),
    onboardingChecklist: z.record(z.string(), z.boolean()).optional(),
    customChecklistItems: z
      .array(
        z.object({
          key: z.string(),
          label: z.string(),
          checked: z.boolean().optional(),
        })
      )
      .optional(),
  }),
});

export const checklistConfigSchema = z.object({
  body: z.object({
    disabledStandardKeys: z.array(z.string()).default([]),
    globalCustomItems: z
      .array(
        z.object({
          key: z.string(),
          label: z.string(),
        })
      )
      .default([]),
  }),
});

export const bulkImportSchema = z.object({
  body: z.object({
    rows: z.array(
      z.object({
        row: z.number(),
        name: z.string().min(1, 'Name is required'),
        phone: z.string().min(1, 'Phone is required'),
        email: z.string().optional().nullable(),
        empCode: z.string().optional().nullable(),
        designation: z.string().optional().nullable(),
        department: z.string().optional().nullable(),
        joiningDate: z.string().optional().nullable(),
        workLocation: z.string().optional().nullable(),
        managerName: z.string().optional().nullable(),
        bloodGroup: z.string().optional().nullable(),
        bankAccount: z.string().optional().nullable(),
        ifscCode: z.string().optional().nullable(),
        monthlySalary: z.number().optional().nullable(),
        confirmAccountLinkOverwrite: z.boolean().optional(),
      })
    ),
  }),
});

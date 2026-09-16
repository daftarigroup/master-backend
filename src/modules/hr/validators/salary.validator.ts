import { z } from 'zod';

const structureBody = z
  .object({
    basicPercent: z.number().min(0).max(100),
    hraPercent: z.number().min(0).max(100),
    conveyancePercent: z.number().min(0).max(100),
    medicalPercent: z.number().min(0).max(100),
    specialAllowancePercent: z.number().min(0).max(100),
    deductions: z.array(z.any()).optional().default([]),
  })
  .refine(
    (data) => {
      const sum =
        data.basicPercent +
        data.hraPercent +
        data.conveyancePercent +
        data.medicalPercent +
        data.specialAllowancePercent;
      return sum <= 100;
    },
    { message: 'Total salary component percentages cannot exceed 100%' }
  );

export const upsertStructureSchema = z.object({ body: structureBody });

export const previewStructureSchema = z.object({ body: structureBody });

export const holdSalarySchema = z.object({
  body: z.object({
    hold: z.boolean(),
    reason: z.string().optional().nullable(),
  }),
});

export const generatePayslipSchema = z.object({
  body: z.object({
    employeeId: z.string().optional(),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(2020).max(2100),
  }),
});

export const payPolicySchema = z.object({
  body: z.object({
    otEnabled: z.boolean(),
    otMode: z.enum(['PAY', 'COMP_OFF']),
    standardShiftHours: z.number().min(1).max(24),
    overtimeRateMultiplier: z.number().min(0),
    weekendOtMultiplier: z.number().min(0),
    holidayOtMultiplier: z.number().min(0),
    weekendWorkMultiplier: z.number().min(0),
    holidayWorkMultiplier: z.number().min(0),
    lateGraceMinutes: z.number().int().min(0),
    lateDeductType: z.enum(['PER_MINUTE', 'HALF_DAY', 'NONE']),
    halfDayAfterLateMinutes: z.number().int().min(0),
    punchMisTreatment: z.enum(['ABSENT', 'HALF_DAY', 'PRESENT']),
    pfEnabled: z.boolean(),
    pfEmployeeRate: z.number().min(0).max(100),
    pfEmployerRate: z.number().min(0).max(100),
    esiEnabled: z.boolean(),
    esiEmployeeRate: z.number().min(0).max(100),
    esiEmployerRate: z.number().min(0).max(100),
    esiGrossLimit: z.number().min(0),
    professionalTaxEnabled: z.boolean(),
  }),
});

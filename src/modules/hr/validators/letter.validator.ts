import { z } from 'zod';

const templateBodySchema = z.object({
  name: z.string().min(1, 'Template name is required'),
  letterType: z.string().min(1, 'Letter type is required'),
  content: z.string().min(1, 'Content is required'),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  fields: z.array(z.any()).optional(),
});

export const createTemplateSchema = z.object({ body: templateBodySchema });

export const updateTemplateSchema = z.object({ body: templateBodySchema.partial() });

export const saveFieldValuesSchema = z.object({
  body: z.object({
    employeeId: z.string().optional().default(''),
    fieldValues: z.record(z.string(), z.string()).or(
      z.array(
        z.object({
          fieldKey: z.string(),
          value: z.string(),
        })
      )
    ),
  }),
});

import { z } from 'zod';

const FREQUENCY_VALUES = [
  'daily',
  'alternate-day',
  'weekly',
  'fortnight',
  'monthly',
  'quarterly',
  'half-yearly',
  'yearly',
  'end-of-1st-week',
  'end-of-2nd-week',
  'end-of-3rd-week',
  'end-of-4rth-week',
  'one-time',
] as const;

export const assignTaskSchema = z.object({
  body: z.object({
    firm_id: z.coerce.number(),
    firm_name: z.string().nullish(),
    doer_id: z.coerce.number(),
    doer_name: z.string().nullish(),
    given_by_id: z.coerce.number().nullish(),
    given_by_name: z.string().nullish(),
    task_description: z.string().min(1, 'task_description is required'),
    frequency: z.enum(FREQUENCY_VALUES),
    task_start_date: z.string().min(1, 'task_start_date is required'),
    duration: z.string().nullish(),
    require_attachment: z.boolean().nullish(),
    enable_reminder: z.boolean().nullish(),
    reminder_days_before: z.coerce.number().int().nullish(),
    instruction_attachment_url: z.string().nullish(),
    instruction_attachment_type: z.string().nullish(),
    remark: z.string().nullish(),
  }),
});

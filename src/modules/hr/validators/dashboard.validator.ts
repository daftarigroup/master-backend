import { z } from 'zod';

export const dashboardFilterSchema = z.object({
  year: z.number().optional(),
  month: z.number().optional(),
});

import { z } from 'zod';

export const submitChecklistTaskSchema = z.object({
  body: z.object({
    image: z.string().nullish(),
    audio_url: z.string().nullish(),
    remark: z.string().nullish(),
  }),
});

export const rejectChecklistTaskSchema = z.object({
  body: z.object({
    remark: z.string().nullish(),
  }),
});

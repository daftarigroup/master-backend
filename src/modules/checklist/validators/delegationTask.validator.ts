import { z } from 'zod';

export const submitDelegationTaskSchema = z.object({
  body: z
    .object({
      status: z.enum(['done', 'extend']),
      image: z.string().nullish(),
      audio_url: z.string().nullish(),
      remark: z.string().nullish(),
      next_extend_date: z.string().nullish(),
      reason: z.string().nullish(),
    })
    .refine((data) => data.status !== 'extend' || !!data.next_extend_date, {
      message: 'next_extend_date is required when status is "extend"',
      path: ['next_extend_date'],
    }),
});

export const rejectDelegationTaskSchema = z.object({
  body: z.object({
    remark: z.string().nullish(),
  }),
});

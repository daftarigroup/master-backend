import { z } from 'zod';

const PLATFORMS = ['LinkedIn', 'Facebook', 'Twitter', 'Instagram', 'YouTube'] as const;

export const connectAccountSchema = z.object({
  body: z.object({
    platform: z.enum(PLATFORMS),
    handle: z.string().trim().min(1, 'Account handle is required'),
    profileUrl: z.string().trim().optional().nullable(),
    autoPublishJobs: z.boolean().optional().default(true),
    trackReferrals: z.boolean().optional().default(true),
  }),
});

export const syncAccountSchema = z.object({
  body: z.object({
    followersNum: z.number().int().min(0),
    impressions30d: z.number().int().min(0),
    engagementRate: z.number().min(0).max(100),
    jobClicks30d: z.number().int().min(0),
    applicants30d: z.number().int().min(0),
  }),
});

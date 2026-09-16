import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { HrAuditService } from '../services/hrAudit.service';

export class SocialController {
  private mapPost(p: any) {
    return {
      id: Number(p.id),
      title: p.title,
      type: p.type,
      indentId: p.indent_id,
      publishedAt: p.published_at.toISOString().slice(0, 10),
      views: p.views,
      clicks: p.clicks,
      applies: p.applies ?? null,
      likes: p.likes,
    };
  }

  private mapAccount(a: any) {
    return {
      id: Number(a.id),
      platform: a.platform,
      handle: a.handle,
      profileUrl: a.profile_url,
      status: a.status,
      autoPublishJobs: a.auto_publish_jobs,
      trackReferrals: a.track_referrals,
      followersNum: a.followers_num,
      growthPercent: Number(a.growth_percent),
      impressions30d: a.impressions_30d,
      engagementRate: Number(a.engagement_rate),
      jobClicks30d: a.job_clicks_30d,
      applicants30d: a.applicants_30d,
      lastSyncedAt: a.last_synced_at?.toISOString() || null,
      connectedAt: a.connected_at.toISOString(),
      recentPosts: Array.isArray(a.posts) ? a.posts.map((p: any) => this.mapPost(p)) : [],
    };
  }

  /**
   * GET /social/accounts
   */
  listAccounts = asyncHandler(async (_req: Request, res: Response) => {
    const accounts = await prisma.hrSocialAccount.findMany({
      orderBy: { platform: 'asc' },
      include: { posts: { orderBy: { published_at: 'desc' }, take: 5 } },
    });

    res.json({ success: true, data: accounts.map((a: any) => this.mapAccount(a)) });
  });

  /**
   * POST /social/accounts/connect
   */
  connectAccount = asyncHandler(async (req: Request, res: Response) => {
    const { platform, handle, profileUrl, autoPublishJobs, trackReferrals } = req.body;
    const resolvedUrl =
      profileUrl?.trim() || `https://${platform.toLowerCase()}.com/${String(handle).replace('@', '')}`;

    const account = await prisma.hrSocialAccount.upsert({
      where: { platform },
      create: {
        platform,
        handle,
        profile_url: resolvedUrl,
        status: 'connected',
        auto_publish_jobs: autoPublishJobs,
        track_referrals: trackReferrals,
      },
      update: {
        handle,
        profile_url: resolvedUrl,
        status: 'connected',
        auto_publish_jobs: autoPublishJobs,
        track_referrals: trackReferrals,
      },
      include: { posts: { orderBy: { published_at: 'desc' }, take: 5 } },
    });

    await HrAuditService.log({
      entityType: 'social',
      entityId: `social_${account.id}`,
      eventType: 'SOCIAL_ACCOUNT_CONNECTED',
      performedBy: (req as any).user?.name || 'Admin',
      notes: `Connected ${platform} account (${handle})`,
    });

    res.json({ success: true, message: `${platform} account connected`, data: this.mapAccount(account) });
  });

  /**
   * PATCH /social/accounts/:id/disconnect
   */
  disconnectAccount = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const existing = await prisma.hrSocialAccount.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Social account not found');

    const account = await prisma.hrSocialAccount.update({
      where: { id },
      data: { status: 'disconnected' },
      include: { posts: { orderBy: { published_at: 'desc' }, take: 5 } },
    });

    res.json({ success: true, message: `${account.platform} account disconnected`, data: this.mapAccount(account) });
  });

  /**
   * PATCH /social/accounts/:id/reconnect
   */
  reconnectAccount = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const existing = await prisma.hrSocialAccount.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Social account not found');

    const account = await prisma.hrSocialAccount.update({
      where: { id },
      data: { status: 'connected' },
      include: { posts: { orderBy: { published_at: 'desc' }, take: 5 } },
    });

    res.json({ success: true, message: `${account.platform} account reconnected`, data: this.mapAccount(account) });
  });

  /**
   * POST /social/accounts/:id/sync
   * Records a new analytics snapshot and recomputes growth % server-side
   * from the previous snapshot, instead of trusting a typed-in growth value.
   */
  syncAccount = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { followersNum, impressions30d, engagementRate, jobClicks30d, applicants30d } = req.body;

    const existing = await prisma.hrSocialAccount.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Social account not found');

    const account = await prisma.$transaction(async (tx) => {
      const prevSnapshot = await tx.hrSocialAnalyticsSnapshot.findFirst({
        where: { account_id: id },
        orderBy: { recorded_at: 'desc' },
      });

      const growthPercent = prevSnapshot && Number(prevSnapshot.followers_num) > 0
        ? Number((((followersNum - prevSnapshot.followers_num) / prevSnapshot.followers_num) * 100).toFixed(2))
        : 0;

      await tx.hrSocialAnalyticsSnapshot.create({
        data: {
          account_id: id,
          followers_num: followersNum,
          impressions_30d: impressions30d,
          engagement_rate: engagementRate,
          job_clicks_30d: jobClicks30d,
          applicants_30d: applicants30d,
          growth_percent: growthPercent,
          recorded_by: (req as any).user?.name || 'Admin',
        },
      });

      return tx.hrSocialAccount.update({
        where: { id },
        data: {
          followers_num: followersNum,
          growth_percent: growthPercent,
          impressions_30d: impressions30d,
          engagement_rate: engagementRate,
          job_clicks_30d: jobClicks30d,
          applicants_30d: applicants30d,
          last_synced_at: new Date(),
        },
        include: { posts: { orderBy: { published_at: 'desc' }, take: 5 } },
      });
    });

    res.json({ success: true, message: 'Analytics synced successfully', data: this.mapAccount(account) });
  });
}

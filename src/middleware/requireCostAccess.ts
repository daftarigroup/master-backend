import { NextFunction, Response } from 'express';
import { prisma } from '../database/prisma';
import { ApiError } from '../utils/ApiError';
import { UserAuthContext, currentUserContext } from '../utils/currentUser';
import { AuthenticatedRequest } from './auth.middleware';

// Cost, rate and rental data is sensitive: operators and store-keepers must never see it, at any screen size, in any export.
// This is the ONE server-side check. The UI gate (`assetCost` in permissionMapping.ts) is a convenience only.
//
//   view: ADMIN / SUPER_ADMIN, or a user whose page_access carries the `asset_cost` page (the new permission key).
//   edit: ADMIN / SUPER_ADMIN only (rates, rental terms and cost entries change what the firm pays and charges out).

const COST_PAGE_KEYS = ['asset_cost', 'assetCost'];
const OFF = new Set(['', 'NONE', 'NO', 'FALSE', 'FALSY', 'DENIED']);

export const isAdminRole = (role: string | undefined) => role === 'SUPER_ADMIN' || role === 'ADMIN';

function grants(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return !OFF.has(value.trim().toUpperCase());
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(grants);
  return false;
}

/**
 * Whether the user's page_access grants any of these page keys. ADMIN / SUPER_ADMIN always do. `page_access` may be a JSON object,
 * a JSON string, or the string ALL. One lookup per call: callers that need several keys pass them together.
 */
export async function hasPageAccessKey(ctx: UserAuthContext, keys: string[]): Promise<boolean> {
  if (isAdminRole(ctx.role)) return true;
  if (ctx.userId === null) return false;
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { page_access: true } });
  let access: unknown = user?.page_access;
  if (typeof access === 'string' && access.trim().startsWith('{')) {
    try {
      access = JSON.parse(access);
    } catch {
      return false;
    }
  }
  if (typeof access === 'string') return access.toUpperCase() === 'ALL';
  if (!access || typeof access !== 'object') return false;
  const record = access as Record<string, unknown>;
  return keys.some((k) => grants(record[k]));
}

export const canViewCost = (ctx: UserAuthContext): Promise<boolean> => hasPageAccessKey(ctx, COST_PAGE_KEYS);

export const canEditCost = (ctx: UserAuthContext): boolean => isAdminRole(ctx.role);

export async function requireCostAccess(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await canViewCost(currentUserContext(req)))) throw ApiError.forbidden('You do not have access to cost data');
    next();
  } catch (e) {
    next(e);
  }
}

export function requireCostEdit(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  if (!canEditCost(currentUserContext(req))) return next(ApiError.forbidden('Only an admin can change rates and cost entries'));
  next();
}

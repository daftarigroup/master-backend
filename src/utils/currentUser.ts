import { AuthenticatedRequest } from '../middleware/auth.middleware';

export function currentUserId(req: AuthenticatedRequest): bigint | null {
  if (!req.user?.id) return null;
  try {
    return BigInt(req.user.id);
  } catch {
    return null;
  }
}

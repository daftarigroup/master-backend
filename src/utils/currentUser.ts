import { AuthenticatedRequest } from '../middleware/auth.middleware';

export interface UserAuthContext {
  userId: bigint | null;
  role: string;
  permittedFirms: bigint[];
}

export function currentUserId(req: AuthenticatedRequest): bigint | null {
  if (!req.user?.id) return null;
  try {
    return BigInt(req.user.id);
  } catch {
    return null;
  }
}

export function currentUserContext(req: AuthenticatedRequest): UserAuthContext {
  const userId = currentUserId(req);
  const role = req.user?.role || 'USER';
  const rawFirms = req.user?.permittedFirms || [];
  const permittedFirms = rawFirms
    .filter((f) => /^\d+$/.test(String(f)))
    .map((f) => BigInt(f));

  return {
    userId,
    role,
    permittedFirms,
  };
}

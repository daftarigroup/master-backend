import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { ApiError } from '../../../utils/ApiError';

export type ChecklistRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

export const requireRole = (...roles: ChecklistRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, 'Unauthorized: login required'));
    }
    if (!roles.includes(req.user.role as ChecklistRole)) {
      return next(new ApiError(403, 'Forbidden: insufficient role'));
    }
    next();
  };
};

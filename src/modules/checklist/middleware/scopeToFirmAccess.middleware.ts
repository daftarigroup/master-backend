import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { ApiError } from '../../../utils/ApiError';

/**
 * Attaches req.firmScope: null means unrestricted (SUPER_ADMIN), otherwise an
 * array of firm ids (as strings) the caller may read/write. USER additionally
 * gets req.doerScope set to their own user id — controllers must further
 * restrict USER-role requests to rows where doer_id === req.doerScope.
 */
export interface FirmScopedRequest extends AuthenticatedRequest {
  firmScope?: string[] | null;
  doerScope?: string | null;
}

export const scopeToFirmAccess = (req: FirmScopedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new ApiError(401, 'Unauthorized: login required'));
  }

  if (req.user.role === 'SUPER_ADMIN') {
    req.firmScope = null;
    req.doerScope = null;
    return next();
  }

  if (req.user.role === 'ADMIN') {
    req.firmScope = req.user.permittedFirms || [];
    req.doerScope = null;
    return next();
  }

  // USER: no firm-level access, restricted to their own tasks as doer
  req.firmScope = [];
  req.doerScope = req.user.id;
  next();
};

export const assertFirmAllowed = (req: FirmScopedRequest, firmId: string | null | undefined) => {
  if (req.firmScope === null || req.firmScope === undefined) return; // SUPER_ADMIN
  if (!firmId || !req.firmScope.includes(String(firmId))) {
    throw new ApiError(403, 'Forbidden: project not in your assigned access');
  }
};

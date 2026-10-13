import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { ApiError } from '../utils/ApiError';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    permittedFirms?: string[];
  };
}

export const authenticateJWT = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

    jwt.verify(token, config.jwt.secret, (err: any, user: any) => {
      if (err) {
        return next(new ApiError(403, 'Forbidden: Invalid or expired token'));
      }
      req.user = user;
      next();
    });
  } else {
    // No token: the request carries no user and carries on, exactly as it always did in production. This middleware is mounted
    // on ALL of /api, including login, the public QR page and the health check, so it must not reject here; routes that need a
    // user use requireLogin (below) or requireUserId. Outside production the request used to be silently promoted to
    // SUPER_ADMIN, which bypasses all firm scoping and cost permissions on any non-production deployment: that is now an
    // explicit local-dev opt-in.
    if (config.env !== 'production' && process.env.ALLOW_DEV_AUTH_FALLBACK === 'true') {
      req.user = {
        id: '1',
        email: 'admin@example.com',
        role: 'SUPER_ADMIN',
        permittedFirms: [],
      };
    }
    next();
  }
};

/** For routers that are for logged-in users only (the fleet / equipment / cost routes): no user is a 401. */
export const requireLogin = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new ApiError(401, 'Unauthorized: login required'));
  next();
};

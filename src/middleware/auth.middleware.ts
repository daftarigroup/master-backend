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
    // For development / backwards compatibility during initial migration, allow optional auth context fallback
    next();
  }
};

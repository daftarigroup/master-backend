import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import { config } from '../config';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  let { statusCode, message } = err;

  if (!(err instanceof ApiError)) {
    statusCode = err.statusCode || 500;
    message = err.message || 'Internal Server Error';
  }

  const response = {
    success: false,
    statusCode,
    message,
    error: message, // additive: lets new-endpoint clients read { success, data, error } uniformly
    ...(err.errors && { errors: err.errors }),
    ...(config.env === 'development' && { stack: err.stack }),
  };

  res.status(statusCode).json(response);
};

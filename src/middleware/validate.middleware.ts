import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny, ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';

export const validate = (schema: ZodTypeAny) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await schema.parseAsync({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    return next();
  } catch (error) {
    if (error instanceof ZodError) {
      const issueMessages = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return next(new ApiError(400, 'Validation Error', issueMessages));
    }
    return next(error);
  }
};

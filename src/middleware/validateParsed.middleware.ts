import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny, ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';

// Unlike the legacy `validate` middleware, which parses and then throws the result away
// (so z.coerce, .trim() and unknown-key stripping never take effect), this one replaces
// req.body / req.params / req.query with the parsed output. Use it on new and rewritten
// routes only: switching existing routes over changes the input they receive.
//
// Express 5 makes req.query a read-only getter, so it is redefined rather than assigned.
export const validateParsed =
  (schema: ZodTypeAny) => async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = (await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      })) as { body?: unknown; query?: unknown; params?: unknown };

      if (parsed.body !== undefined) req.body = parsed.body;
      if (parsed.params !== undefined) req.params = parsed.params as Request['params'];
      if (parsed.query !== undefined) {
        Object.defineProperty(req, 'query', { value: parsed.query, writable: true, configurable: true, enumerable: true });
      }
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issueMessages = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        return next(new ApiError(400, 'Validation Error', issueMessages));
      }
      return next(error);
    }
  };

import { Response } from 'express';

// One response envelope for new endpoints: { success, data, error }.
// Errors keep flowing through ApiError -> errorHandler, which returns
// { success: false, statusCode, message, errors? } (see the additive `error` field there).

export interface Envelope<T> {
  success: true;
  data: T;
  error: null;
  warnings?: unknown[];
}

export function ok<T>(res: Response, data: T, status = 200, extra: { warnings?: unknown[]; [k: string]: unknown } = {}) {
  const body: Envelope<T> & Record<string, unknown> = { success: true, data, error: null, ...extra };
  return res.status(status).json(body);
}

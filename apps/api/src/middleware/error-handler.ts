import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@mecca/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiError = { ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } };
  res.status(404).json(body);
};

/** Unexpected errors are logged with the request id and, if set up, emailed. */
export const createErrorHandler =
  (onUnexpected?: (err: unknown, ctx: Record<string, unknown>) => void): ErrorRequestHandler =>
  (err, req, res, next) =>
    handle(err, req, res, next, onUnexpected);

export const errorHandler: ErrorRequestHandler = (err, req, res, next) =>
  handle(err, req, res, next);

function handle(
  err: unknown,
  req: Parameters<ErrorRequestHandler>[1],
  res: Parameters<ErrorRequestHandler>[2],
  _next: Parameters<ErrorRequestHandler>[3],
  onUnexpected?: (err: unknown, ctx: Record<string, unknown>) => void,
) {
  if (err instanceof AppError) {
    const body: ApiError = {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.status).json(body);
    return;
  }
  if (err instanceof ZodError) {
    const body: ApiError = {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten() },
    };
    res.status(400).json(body);
    return;
  }
  // Body too large, bad JSON and similar client mistakes carry their own status.
  const status =
    (err as { status?: number; statusCode?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Bad request' } });
    return;
  }
  const ctx = {
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    userId: req.auth?.id,
  };
  logger.error({ err, ...ctx }, 'Unhandled error');
  onUnexpected?.(err, ctx);
  const body: ApiError = {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
      details: { requestId: req.requestId },
    },
  };
  res.status(500).json(body);
}

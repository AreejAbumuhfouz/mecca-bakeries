import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@mecca/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiError = { ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
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
  logger.error({ err }, 'Unhandled error');
  const body: ApiError = {
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  };
  res.status(500).json(body);
};

import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

/** Every request gets an id, returned in X-Request-Id and written to the logs. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

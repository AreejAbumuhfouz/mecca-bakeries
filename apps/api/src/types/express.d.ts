import type { AuthUser } from '@mecca/shared';
import type { AuditContext } from '../modules/audit/audit.service.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` for logged-in requests. */
      auth?: AuthUser;
      /** Who/where for audit log rows. Always set (userId is null for anonymous requests). */
      audit: AuditContext;
      /** Raw JSON body bytes (for webhook signatures). */
      rawBody?: Buffer;
    }
  }
}

export {};

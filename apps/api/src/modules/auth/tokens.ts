import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@mecca/shared';

export type AccessClaims = { sub: string; role: Role };

export function createTokenService(secret: string, accessTtlMin: number) {
  const key = new TextEncoder().encode(secret);
  return {
    accessTtlSeconds: accessTtlMin * 60,
    async signAccess(claims: AccessClaims) {
      return new SignJWT({ role: claims.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.sub)
        .setIssuedAt()
        .setIssuer('mecca-api')
        .setExpirationTime(`${accessTtlMin}m`)
        .sign(key);
    },
    async verifyAccess(token: string): Promise<AccessClaims> {
      const { payload } = await jwtVerify(token, key, {
        issuer: 'mecca-api',
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.role !== 'string')
        throw new Error('Bad token');
      return { sub: payload.sub, role: payload.role as Role };
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;

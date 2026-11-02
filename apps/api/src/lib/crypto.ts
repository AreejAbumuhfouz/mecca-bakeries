import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 hex digest. Used for OTP codes and refresh tokens (never stored in plain text). */
export const hmac = (value: string, secret: string) =>
  createHmac('sha256', secret).update(value).digest('hex');

export const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/** 6-digit numeric code, uniformly random. */
export const generateOtp = () => randomInt(0, 1_000_000).toString().padStart(6, '0');

export const generateToken = (bytes = 48) => randomBytes(bytes).toString('base64url');

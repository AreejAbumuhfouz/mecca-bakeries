import { OAuth2Client } from 'google-auth-library';

export type GoogleIdentity = { email: string; emailVerified: boolean; name?: string };
export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity>;

/** Verifies a Google Sign-In ID token against our client IDs (web / iOS / Android). */
export function createGoogleVerifier(clientIds: string[]): GoogleVerifier | null {
  if (clientIds.length === 0) return null;
  const client = new OAuth2Client();
  return async (idToken) => {
    const ticket = await client.verifyIdToken({ idToken, audience: clientIds });
    const payload = ticket.getPayload();
    if (!payload?.email) throw new Error('Google token has no email');
    return {
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name,
    };
  };
}

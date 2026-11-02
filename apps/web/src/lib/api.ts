import type { ApiResponse, LoginResult } from '@mecca/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<LoginResult | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const setSessionExpiredHandler = (fn: (() => void) | null) => {
  onSessionExpired = fn;
};

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) throw new ApiRequestError(res.status, 'BAD_RESPONSE', 'تعذّر الاتصال بالخادم');
  if (!body.ok) throw new ApiRequestError(res.status, body.error.code, body.error.message);
  return body.data;
}

/** Uses the httpOnly refresh cookie to get a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<LoginResult | null> {
  refreshing ??= fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((res) => (res.ok ? parse<LoginResult>(res) : null))
    .then((result) => {
      setAccessToken(result?.accessToken ?? null);
      return result;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** JSON request to the API with the access token; retries once after refreshing an expired token. */
export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  if (res.status === 401 && retry && !path.startsWith('/api/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, init, false);
    onSessionExpired?.();
  }
  return parse<T>(res);
}

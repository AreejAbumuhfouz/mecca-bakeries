import type { ApiResponse, LoginResult } from '@mecca/shared';
import { getLocale, t } from '@/lib/i18n';

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
  if (!body) throw new ApiRequestError(res.status, 'BAD_RESPONSE', t('تعذّر الاتصال بالخادم'));
  if (!body.ok) throw new ApiRequestError(res.status, body.error.code, body.error.message);
  return body.data;
}

/** Uses the httpOnly refresh cookie to get a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<LoginResult | null> {
  refreshing ??= fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Locale': getLocale() },
  })
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
  // JSON bodies only: FormData uploads must let the browser set the multipart boundary.
  if (typeof init.body === 'string' && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('X-Locale', getLocale());
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  if (res.status === 401 && retry && !path.startsWith('/api/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, init, false);
    onSessionExpired?.();
  }
  return parse<T>(res);
}

export type UploadedFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  isPublic: boolean;
};

/** Uploads one file (logo, item image or contract attachment). */
export function uploadFile(file: File, isPublic: boolean) {
  const body = new FormData();
  body.append('isPublic', String(isPublic));
  body.append('file', file);
  return api<UploadedFile>('/api/files', { method: 'POST', body });
}

/** Posts a multipart form (e.g. an Excel file to import). */
export const uploadForm = <T>(path: string, body: FormData) =>
  api<T>(path, { method: 'POST', body });

/** URL for a public file (logos, item images) usable in <img src>. */
export const fileUrl = (id: string) => `${API_URL}/api/files/${id}`;

/** Opens a private file (contract attachment) in a new tab using the current session. */
export const openPrivateFile = (id: string) => openAuthed(`/api/files/${id}`);

/** Downloads a protected file (PDF, signature…) with the session token. */
export async function fetchAuthedBlob(path: string) {
  const load = () =>
    fetch(`${API_URL}${path}`, {
      headers: {
        'X-Locale': getLocale(),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      credentials: 'include',
    });
  let res = await load();
  if (res.status === 401 && (await refreshSession())) res = await load();
  if (!res.ok) throw new ApiRequestError(res.status, 'FILE_ERROR', t('تعذّر فتح الملف'));
  return res.blob();
}

export async function openAuthed(path: string) {
  const url = URL.createObjectURL(await fetchAuthedBlob(path));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Readable Arabic message from any thrown error. */
export const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiRequestError ? err.message : fallback;

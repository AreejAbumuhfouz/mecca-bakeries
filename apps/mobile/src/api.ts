import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { ApiResponse, LoginResult } from '@mecca/shared';

/** On a real phone "localhost" is the phone itself: set your Mac's Wi-Fi IP in apps/mobile/.env */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const REFRESH_KEY = 'mb_refresh_token';

/** Phone keychain on iOS/Android; the browser's storage when the app is opened on the web for testing. */
export const store = {
  get: async (key: string) =>
    Platform.OS === 'web'
      ? (globalThis.localStorage?.getItem(key) ?? null)
      : SecureStore.getItemAsync(key),
  set: async (key: string, value: string) =>
    Platform.OS === 'web'
      ? globalThis.localStorage?.setItem(key, value)
      : SecureStore.setItemAsync(key, value),
  remove: async (key: string) =>
    Platform.OS === 'web'
      ? globalThis.localStorage?.removeItem(key)
      : SecureStore.deleteItemAsync(key),
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<LoginResult | null> | null = null;
let onExpired: (() => void) | null = null;

export const setExpiredHandler = (fn: (() => void) | null) => {
  onExpired = fn;
};

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) throw new ApiError(res.status, 'BAD_RESPONSE', 'تعذّر الاتصال بالخادم');
  if (!body.ok)
    throw new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  return body.data;
}

export async function saveSession(result: LoginResult) {
  accessToken = result.accessToken;
  await store.set(REFRESH_KEY, result.refreshToken);
}

export async function clearSession() {
  accessToken = null;
  await store.remove(REFRESH_KEY);
}

/** Exchanges the stored refresh token for a new session (the token rotates every time). */
export function refreshSession(): Promise<LoginResult | null> {
  refreshing ??= (async () => {
    const refreshToken = await store.get(REFRESH_KEY);
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401) await clearSession();
        return null;
      }
      const result = await parse<LoginResult>(res);
      await saveSession(result);
      return result;
    } catch {
      return null;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  retry = true,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'لا يوجد اتصال بالخادم — تأكد من الإنترنت');
  }
  if (res.status === 401 && retry && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) return api<T>(path, init, false);
    onExpired?.();
  }
  return parse<T>(res);
}

/** A protected file (used for PDFs when the app runs in a browser). */
export async function fetchBlob(path: string) {
  const load = () =>
    fetch(`${API_URL}${path}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  let res = await load();
  if (res.status === 401 && (await refreshSession())) res = await load();
  if (!res.ok) throw new ApiError(res.status, 'FILE_ERROR', 'تعذّر فتح الملف');
  return res.blob();
}

export const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

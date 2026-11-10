'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthUser, LoginResult, Permission } from '@mecca/shared';
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from './api';
import { getLocale, hasChosenLocale, setLocale } from './i18n';

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setUser(null);
    });
    refreshSession()
      .then((r) => setUser(r?.user ?? null))
      .finally(() => setLoading(false));
    return () => setSessionExpiredHandler(null);
  }, []);

  const requestCode = useCallback(async (email: string) => {
    await api('/api/auth/otp/request', { method: 'POST', body: JSON.stringify({ email }) });
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const result = await api<LoginResult>('/api/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
    setAccessToken(result.accessToken);
    // A language picked in this browser wins and is saved on the account; otherwise the
    // account's language is used (e.g. signing in on a new computer).
    if (hasChosenLocale()) {
      if (result.user.locale !== getLocale())
        await api('/api/auth/me/locale', {
          method: 'PATCH',
          body: JSON.stringify({ locale: getLocale() }),
        }).catch(() => undefined);
    } else if (result.user.locale !== getLocale()) {
      setLocale(result.user.locale);
    }
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      requestCode,
      verifyCode,
      logout,
      can: (p) => user?.permissions.includes(p) ?? false,
    }),
    [user, loading, requestCode, verifyCode, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser, LoginResult } from '@mecca/shared';
import { api, clearSession, refreshSession, saveSession, setExpiredHandler } from './api';
import { registerForPush, unregisterPush } from './push';
import { t } from './i18n';

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setExpiredHandler(() => setUser(null));
    void refreshSession()
      .then((r) => {
        setUser(r?.user ?? null);
        if (r) void registerForPush();
      })
      .finally(() => setLoading(false));
    return () => setExpiredHandler(null);
  }, []);

  const requestCode = useCallback(async (email: string) => {
    await api('/api/auth/otp/request', { method: 'POST', body: { email } });
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const result = await api<LoginResult>('/api/auth/otp/verify', {
      method: 'POST',
      body: { email, code },
    });
    const p = result.user.permissions;
    if (!p.includes('orders.place') && !p.includes('deliveries.confirm')) {
      throw new Error(t('هذا التطبيق لحسابات المطاعم والسائقين. استخدم لوحة التحكم من الكمبيوتر.'));
    }
    await saveSession(result);
    setUser(result.user);
    void registerForPush();
  }, []);

  const logout = useCallback(async () => {
    await unregisterPush();
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    await clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, requestCode, verifyCode, logout }),
    [user, loading, requestCode, verifyCode, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

'use client';

import { useCallback } from 'react';
import type { Locale } from '@mecca/shared';
import { api } from '@/lib/api';
import { setLocale } from '@/lib/i18n';

/** Changes the interface language: saved on the account (if signed in) and in this browser. */
export function useSwitchLocale() {
  return useCallback(async (locale: Locale, signedIn = true) => {
    if (signedIn) {
      await api('/api/auth/me/locale', {
        method: 'PATCH',
        body: JSON.stringify({ locale }),
      }).catch(() => undefined);
    }
    setLocale(locale);
  }, []);
}

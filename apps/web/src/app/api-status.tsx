'use client';

import { useEffect, useState } from 'react';
import type { ApiResponse, HealthStatus } from '@mecca/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Temporary component that proves the dashboard can reach the API. Removed when login is built. */
export function ApiStatus() {
  const [state, setState] = useState<'loading' | 'ok' | 'down'>('loading');

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((r) => r.json() as Promise<ApiResponse<HealthStatus>>)
      .then((body) => setState(body.ok && body.data.status === 'ok' ? 'ok' : 'down'))
      .catch(() => setState('down'));
  }, []);

  const styles = {
    loading: 'bg-brand-gold-light text-brand-brown',
    ok: 'bg-green-50 text-green-800',
    down: 'bg-red-50 text-red-800',
  }[state];
  const label = {
    loading: 'جارٍ الاتصال بالخادم…',
    ok: 'الخادم وقاعدة البيانات يعملان ✓',
    down: 'تعذّر الاتصال بالخادم',
  }[state];

  return (
    <span className={`inline-block rounded-full px-4 py-1.5 text-sm font-bold ${styles}`}>
      {label}
    </span>
  );
}

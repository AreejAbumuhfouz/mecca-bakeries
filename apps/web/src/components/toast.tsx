'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { t } from '@/lib/i18n';

type Tone = 'success' | 'error' | 'info';
type Toast = { id: number; tone: Tone; message: string };
type Api = { success: (m: string) => void; error: (m: string) => void; info: (m: string) => void };

const Ctx = createContext<Api | null>(null);

/** Short notices in the corner ("Saved", "Could not send") that close by themselves. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = Date.now() + Math.random();
      setItems((l) => [...l.slice(-3), { id, tone, message }]);
      setTimeout(() => remove(id), tone === 'error' ? 7000 : 3500);
    },
    [remove],
  );
  const api = useMemo<Api>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );
  const icon = { success: CheckCircle2, error: XCircle, info: Info };
  const tone = {
    success: 'border-green-200 bg-green-50 text-green-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    info: 'border-brand-line bg-surface text-brand-brown',
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 start-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2 print:hidden"
      >
        {items.map((x) => {
          const Icon = icon[x.tone];
          return (
            <div
              key={x.id}
              role={x.tone === 'error' ? 'alert' : 'status'}
              className={`mb-toast pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ${tone[x.tone]}`}
            >
              <Icon size={18} className="mt-0.5 shrink-0" />
              <span className="flex-1 leading-6">{x.message}</span>
              <button aria-label={t('إغلاق')} onClick={() => remove(x.id)} className="opacity-60 hover:opacity-100">
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): Api {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

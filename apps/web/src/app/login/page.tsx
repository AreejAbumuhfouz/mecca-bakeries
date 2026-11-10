'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Languages, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { ApiRequestError } from '@/lib/api';
import { Button, Input } from '@/components/ui';
import { getLocale, setLocale, t } from '@/lib/i18n';

export default function LoginPage() {
  const { user, loading, requestCode, verifyCode } = useAuth();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  async function run(fn: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      // A fetch that never reached the API (server stopped, no internet) is not an ApiRequestError.
      setError(
        e instanceof ApiRequestError ? e.message : t('لا يوجد اتصال بالخادم — تأكد من الإنترنت'),
      );
      setBusy(false);
    }
  }

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await requestCode(email);
      setStep('code');
      setBusy(false);
    });
  };

  const onCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      // Stays busy until the dashboard opens, so the code can't be sent twice.
      await verifyCode(email, code);
      router.replace('/');
    });
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <div className="absolute top-4 inset-e-4 flex gap-2">
        <button
          onClick={() => setLocale(getLocale() === 'ar' ? 'en' : 'ar')}
          className="flex items-center gap-1.5 rounded-lg border border-brand-line bg-surface px-2.5 py-2 text-xs font-bold text-brand-brown"
        >
          <Languages size={16} /> {getLocale() === 'ar' ? 'English' : 'العربية'}
        </button>
        <button
          onClick={toggle}
          className="rounded-lg border border-brand-line bg-surface p-2 text-brand-brown"
          aria-label={theme === 'dark' ? t('الوضع الفاتح') : t('الوضع الداكن')}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-brand-line bg-surface p-8 shadow-sm">
        <div className="mx-auto w-fit rounded-xl bg-white p-2">
          <Image src="/logo.png" alt={t('مخابز مكة')} width={120} height={101} priority />
        </div>
        <h1 className="mt-4 text-center text-xl font-bold text-brand-brown">{t('تسجيل الدخول')}</h1>
        <p className="mt-1 text-center text-sm text-brand-muted">{t('لوحة تحكم مخابز مكة')}</p>

        {step === 'email' ? (
          <form onSubmit={onEmail} className="mt-6 space-y-4">
            <Input
              label={t('البريد الإلكتروني')}
              type="email"
              dir="ltr"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@gmail.com"
            />
            {error && <p className="text-sm text-red-700">{error}</p>}
            <Button type="submit" disabled={busy || !email} className="w-full">
              {busy ? t('جارٍ الإرسال…') : t('إرسال رمز الدخول')}
            </Button>
          </form>
        ) : (
          <form onSubmit={onCode} className="mt-6 space-y-4">
            <p className="text-sm text-brand-muted">
              {t('أرسلنا رمزاً من 6 أرقام إلى')} <b dir="ltr">{email}</b>
            </p>
            <Input
              label={t('رمز الدخول')}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
            />
            {error && <p className="text-sm text-red-700">{error}</p>}
            <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
              {busy ? t('جارٍ التحقق…') : t('دخول')}
            </Button>
            <button
              type="button"
              className="w-full text-sm text-brand-muted underline"
              onClick={() => {
                setStep('email');
                setCode('');
                setError('');
              }}
            >
              {t('تغيير البريد أو إعادة الإرسال')}
            </button>
          </form>
        )}
      </div>
      <a href="/privacy" className="absolute bottom-4 text-xs text-brand-muted underline">
        {t('سياسة الخصوصية')}
      </a>
    </main>
  );
}

'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { ApiRequestError } from '@/lib/api';
import { Button, Input } from '@/components/ui';

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
      setError(e instanceof ApiRequestError ? e.message : 'حدث خطأ، حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  }

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await requestCode(email);
      setStep('code');
    });
  };

  const onCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await verifyCode(email, code);
      router.replace('/');
    });
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <button
        onClick={toggle}
        className="absolute top-4 left-4 rounded-lg border border-brand-line bg-surface p-2 text-brand-brown"
        aria-label={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
      >
        {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      <div className="w-full max-w-sm rounded-2xl border border-brand-line bg-surface p-8 shadow-sm">
        <div className="mx-auto w-fit rounded-xl bg-white p-2">
          <Image src="/logo.png" alt="مخابز مكة" width={120} height={101} priority />
        </div>
        <h1 className="mt-4 text-center text-xl font-bold text-brand-brown">تسجيل الدخول</h1>
        <p className="mt-1 text-center text-sm text-brand-muted">لوحة تحكم مخابز مكة</p>

        {step === 'email' ? (
          <form onSubmit={onEmail} className="mt-6 space-y-4">
            <Input
              label="البريد الإلكتروني"
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
              {busy ? 'جارٍ الإرسال…' : 'إرسال رمز الدخول'}
            </Button>
          </form>
        ) : (
          <form onSubmit={onCode} className="mt-6 space-y-4">
            <p className="text-sm text-brand-muted">
              أرسلنا رمزاً من 6 أرقام إلى <b dir="ltr">{email}</b>
            </p>
            <Input
              label="رمز الدخول"
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
              {busy ? 'جارٍ التحقق…' : 'دخول'}
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
              تغيير البريد أو إعادة الإرسال
            </button>
          </form>
        )}
      </div>
      <a href="/privacy" className="absolute bottom-4 text-xs text-brand-muted underline">
        سياسة الخصوصية
      </a>
    </main>
  );
}

'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { ApiRequestError } from '@/lib/api';
import { Button, Input } from '@/components/ui';

export default function LoginPage() {
  const { user, loading, requestCode, verifyCode } = useAuth();
  const router = useRouter();
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-brand-line bg-white p-8 shadow-sm">
        <Image
          src="/logo.png"
          alt="مخابز مكة"
          width={120}
          height={101}
          className="mx-auto"
          priority
        />
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
    </main>
  );
}

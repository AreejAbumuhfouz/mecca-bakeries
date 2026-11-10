import { AlertCircle, Inbox } from 'lucide-react';
import { t } from '@/lib/i18n';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

const fieldClass =
  'w-full rounded-lg border border-brand-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand-gold focus:ring-2 focus:ring-brand-gold-light';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'gold' | 'outline' }) {
  const styles = {
    primary: 'bg-primary text-on-primary hover:bg-primary-hover',
    gold: 'bg-brand-gold text-white hover:opacity-90',
    outline: 'border border-brand-brown text-brand-brown bg-surface hover:bg-brand-cream',
  }[variant];
  return (
    <button
      className={`rounded-lg px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input({
  label,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-brand-brown">{label}</span>
      <input className={fieldClass} {...props} />
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

export function Card({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-brand-line bg-surface p-4 shadow-[0_1px_2px_rgba(62,42,28,0.05)] sm:p-5">
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-lg font-bold text-brand-brown">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'green' | 'red' | 'gold' | 'neutral';
  children: ReactNode;
}) {
  const styles = {
    green: 'bg-green-50 text-green-800',
    red: 'bg-red-50 text-red-800',
    gold: 'bg-brand-gold-light text-brand-brown',
    neutral: 'bg-stone-100 text-stone-700',
  }[tone];
  return (
    <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-bold ${styles}`}>
      {children}
    </span>
  );
}

export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-brand-brown">{label}</span>
      <select className={fieldClass} {...props}>
        {children}
      </select>
    </label>
  );
}

export function Textarea({
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-brand-brown">{label}</span>
      <textarea className={fieldClass} rows={2} {...props} />
    </label>
  );
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
    >
      <AlertCircle size={17} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** A friendly empty state for lists and tables. */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-cream text-brand-gold">
        <Inbox size={22} />
      </span>
      <p className="font-bold text-brand-brown">{title}</p>
      {hint && <p className="max-w-sm text-sm text-brand-muted">{hint}</p>}
    </div>
  );
}

/** Placeholder blocks shown while a page loads its data. */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label={t('جارٍ التحميل…')}>
      <div className="mb-skeleton h-8 w-56" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mb-skeleton h-20" />
        ))}
      </div>
      <div className="space-y-2 rounded-2xl border border-brand-line bg-surface p-5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="mb-skeleton h-6" />
        ))}
      </div>
    </div>
  );
}

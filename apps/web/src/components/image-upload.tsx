'use client';

import { useRef, useState } from 'react';
import { errorMessage, fileUrl, uploadFile } from '@/lib/api';

/** Picks an image, uploads it as a public file and returns its id. */
export function ImageUpload({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (fileId: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      onChange((await uploadFile(file, true)).id);
    } catch (err) {
      setError(errorMessage(err, 'تعذّر رفع الصورة'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-bold text-brand-brown">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-brand-line bg-white">
          {value ? (
            <img src={fileUrl(value)} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-brand-muted">لا يوجد</span>
          )}
        </div>
        <div className="flex flex-col items-start gap-1 text-xs">
          <button
            type="button"
            className="text-brand-brown underline disabled:opacity-50"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? 'جارٍ الرفع…' : value ? 'تغيير الصورة' : 'رفع صورة'}
          </button>
          {value && (
            <button type="button" className="text-red-700 underline" onClick={() => onChange(null)}>
              إزالة
            </button>
          )}
          <span className="text-brand-muted">PNG / JPG / WEBP — حتى 5 ميغابايت</span>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </div>
  );
}

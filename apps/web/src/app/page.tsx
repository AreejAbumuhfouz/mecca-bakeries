import Image from 'next/image';
import { ApiStatus } from './api-status';

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-brand-line bg-white p-8 text-center shadow-sm">
        <Image
          src="/logo.png"
          alt="مخابز مكة"
          width={140}
          height={118}
          className="mx-auto"
          priority
        />
        <h1 className="mt-4 text-2xl font-bold text-brand-brown">لوحة تحكم مخابز مكة</h1>
        <p className="mt-1 text-sm text-brand-muted">نظام إدارة الطلبات والإنتاج والتوزيع</p>
        <div className="mt-6">
          <ApiStatus />
        </div>
      </div>
    </main>
  );
}

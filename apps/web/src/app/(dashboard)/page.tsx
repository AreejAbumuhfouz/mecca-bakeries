'use client';

import { useAuth } from '@/lib/auth';
import { Card } from '@/components/ui';

export default function DashboardHome() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-brown">أهلاً {user?.name}</h1>
        <p className="text-sm text-brand-muted">
          مؤشرات اليوم تظهر هنا بعد بناء وحدات الطلبات والفواتير.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {['طلبات اليوم', 'مطاعم لم تطلب', 'مبيعات اليوم', 'ذمم مستحقة'].map((label) => (
          <Card key={label}>
            <div className="text-sm text-brand-muted">{label}</div>
            <div className="mt-1 text-2xl font-bold text-brand-brown">—</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

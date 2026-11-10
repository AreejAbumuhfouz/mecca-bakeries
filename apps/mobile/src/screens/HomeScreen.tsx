import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { formatJod } from '@mecca/shared';
import { api, ApiError, errorText } from '../api';
import { Button, Countdown, StatusBadge } from '../components';
import { colors, ui } from '../theme';
import type { Me } from '../types';
import { t } from '../i18n';

export function HomeScreen({
  onOpenOrder,
  refreshKey,
}: {
  onOpenOrder: (branchId: string, orderId: string | null) => void;
  refreshKey: number;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyBranch, setBusyBranch] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMe(await api<Me>('/api/app/me'));
      setError('');
    } catch (err) {
      setError(errorText(err, t('تعذّر التحميل')));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function repeat(branchId: string) {
    setError('');
    setBusyBranch(branchId);
    try {
      const order = await api<{ id: string }>('/api/app/orders/repeat', {
        method: 'POST',
        body: { branchId },
      });
      onOpenOrder(branchId, order.id);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'NO_PREVIOUS_ORDER'
          ? t('لا يوجد طلب سابق لهذا الفرع — أنشئ طلباً جديداً')
          : errorText(err, t('تعذّر تكرار الطلب')),
      );
    } finally {
      setBusyBranch(null);
    }
  }

  async function confirmDraft(branchId: string, orderId: string) {
    setBusyBranch(branchId);
    try {
      await api(`/api/app/orders/${orderId}/submit`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorText(err, t('تعذّر تأكيد المسودة')));
    } finally {
      setBusyBranch(null);
    }
  }

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
    >
      {me && (
        <>
          <Text style={ui.h1}>{t('أهلاً {0}', me.user.name)}</Text>
          <Text style={ui.text}>
            {t('طلب يوم')} <Text style={{ fontWeight: '700' }}>{me.deliveryDate}</Text>
          </Text>
          <Countdown cutoffAt={me.cutoffAt} serverNow={me.now} />
          {!me.credit.allowed && (
            <View style={[ui.card, { borderColor: colors.red }]}>
              <Text style={[ui.h2, { color: colors.red }]}>{t('تنبيه من المخبز')}</Text>
              {me.credit.reasons.map((r) => (
                <Text key={r.code} style={ui.text}>
                  • {r.message}
                </Text>
              ))}
              <Text style={ui.muted}>
                {t('يمكنك الطلب، وسيُراجع طلبك من الإدارة قبل اعتماده.')}
              </Text>
            </View>
          )}
        </>
      )}
      {error ? <Text style={ui.error}>{error}</Text> : null}

      {me?.branches.map((b) => (
        <View key={b.id} style={ui.card}>
          <View style={ui.between}>
            <Text style={ui.h2}>{b.name}</Text>
            {b.order && <StatusBadge status={b.order.status} />}
          </View>
          {b.address ? <Text style={ui.muted}>{b.address}</Text> : null}
          {b.order ? (
            <>
              <Text style={ui.text}>
                {t(
                  '{0} — {1} أصناف — {2}',
                  b.order.number,
                  b.order.itemCount,
                  formatJod(b.order.total),
                )}
              </Text>
              {b.order.status === 'draft' && (
                <Text style={ui.muted}>
                  {t('جهّزنا هذه المسودة من طلب الأمس. أكّدها أو عدّلها قبل الإغلاق.')}
                </Text>
              )}
              <View style={{ gap: 8 }}>
                {b.order.status === 'draft' && (
                  <Button
                    title={t('تأكيد المسودة كما هي')}
                    variant="gold"
                    busy={busyBranch === b.id}
                    onPress={() => void confirmDraft(b.id, b.order!.id)}
                  />
                )}
                <Button
                  title={t('عرض / تعديل الطلب')}
                  variant="outline"
                  onPress={() => onOpenOrder(b.id, b.order!.id)}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={ui.muted}>{t('لم يُرسل طلب لهذا الفرع بعد.')}</Text>
              <View style={{ gap: 8 }}>
                <Button title={t('طلب جديد')} onPress={() => onOpenOrder(b.id, null)} />
                <Button
                  title={t('نفس طلب آخر مرة')}
                  variant="gold"
                  busy={busyBranch === b.id}
                  onPress={() => void repeat(b.id)}
                />
              </View>
            </>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

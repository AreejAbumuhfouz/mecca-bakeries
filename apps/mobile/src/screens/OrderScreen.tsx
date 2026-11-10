import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { formatJod, ITEM_UNIT_LABELS_AR, ORDER_EVENT_LABELS_AR } from '@mecca/shared';
import { api, ApiError, errorText } from '../api';
import { Button, StatusBadge } from '../components';
import { colors, ui } from '../theme';
import type { CatalogItem, Order } from '../types';
import { t } from '../i18n';

type Quantities = Record<string, number>;

/** New order (orderId null) or view/edit of an existing one. */
export function OrderScreen({
  branchId,
  orderId: initialId,
  onClose,
}: {
  branchId: string;
  orderId: string | null;
  onClose: (changed: boolean) => void;
}) {
  const [orderId, setOrderId] = useState(initialId);
  const [order, setOrder] = useState<Order | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [qty, setQty] = useState<Quantities>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const o = orderId ? await api<Order>(`/api/app/orders/${orderId}`) : null;
        setOrder(o);
        if (o) {
          setQty(Object.fromEntries(o.lines.map((l) => [l.itemId, l.quantity])));
          setNotes(o.notes ?? '');
        }
        const date = o ? `&date=${o.deliveryDate}` : '';
        setCatalog(await api<CatalogItem[]>(`/api/app/catalog?branchId=${branchId}${date}`));
      } catch (err) {
        setError(errorText(err, t('تعذّر التحميل')));
      }
    })();
  }, [branchId, orderId]);

  const editable = !order || order.editableByRestaurant;
  const sections = useMemo(() => [...new Set(catalog.map((i) => i.sectionName))], [catalog]);
  const total = catalog.reduce((s, i) => s + (qty[i.id] ?? 0) * i.price, 0);
  const lines = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));

  const change = (id: string, q: number) =>
    setQty((prev) => {
      const next = { ...prev };
      if (q > 0) next[id] = Math.min(100_000, q);
      else delete next[id];
      return next;
    });

  async function save() {
    setError('');
    setBusy(true);
    try {
      const body = { lines, notes: notes.trim() || null };
      const result = order
        ? await api<Order>(`/api/app/orders/${order.id}`, { method: 'PATCH', body })
        : await api<Order>('/api/app/orders', { method: 'POST', body: { branchId, ...body } });
      setOrder(result);
      setOrderId(result.id);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ORDER_EXISTS') {
        const existing = (err.details as { orderId?: string } | undefined)?.orderId;
        if (existing) setOrderId(existing);
      }
      setError(errorText(err, t('تعذّر حفظ الطلب')));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!order) return;
    setBusy(true);
    try {
      await api(`/api/app/orders/${order.id}/cancel`, { method: 'POST', body: {} });
      onClose(true);
    } catch (err) {
      setError(errorText(err, t('تعذّر الإلغاء')));
      setBusy(false);
    }
  }

  return (
    <View style={ui.screen}>
      <View
        style={[
          ui.between,
          {
            padding: 16,
            borderBottomWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.white,
          },
        ]}
      >
        <Pressable onPress={() => onClose(saved)} hitSlop={12}>
          <Text style={{ color: colors.brown, fontSize: 16 }}>{t('→ رجوع')}</Text>
        </Pressable>
        <Text style={ui.h2}>{order ? order.number : t('طلب جديد')}</Text>
        {order ? <StatusBadge status={order.status} /> : <View style={{ width: 40 }} />}
      </View>

      <ScrollView contentContainerStyle={ui.content}>
        {order && (
          <Text style={ui.muted}>
            {t('{0} — تسليم يوم {1}', order.branchName, order.deliveryDate)}
          </Text>
        )}
        {saved && order && (
          <Text style={[ui.error, { backgroundColor: colors.greenBg, color: colors.green }]}>
            {order.status === 'pending_approval'
              ? t('تم الحفظ — الطلب بانتظار موافقة الإدارة')
              : t('تم إرسال الطلب ✓ يمكنك تعديله حتى موعد الإغلاق')}
          </Text>
        )}
        {order?.status === 'pending_approval' &&
          order.creditReasons?.map((r) => (
            <Text key={r.code} style={ui.error}>
              {t(r.key ?? r.message, ...(r.args ?? []))}
            </Text>
          ))}
        {!editable && (
          <Text style={ui.error}>{t('انتهى وقت تعديل هذا الطلب. للتغيير تواصل مع المخبز.')}</Text>
        )}
        {error ? <Text style={ui.error}>{error}</Text> : null}

        {sections.map((section) => (
          <View key={section} style={ui.card}>
            <Text style={ui.h2}>{section}</Text>
            {catalog
              .filter((i) => i.sectionName === section)
              .map((i) => {
                const q = qty[i.id] ?? 0;
                return (
                  <View
                    key={i.id}
                    style={[
                      ui.between,
                      { paddingVertical: 8, borderTopWidth: 1, borderColor: colors.cream },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[ui.text, { fontWeight: '700' }]}>{i.name}</Text>
                      <Text style={ui.muted}>
                        {formatJod(i.price)} / {t(ITEM_UNIT_LABELS_AR[i.unit])}
                        {i.source === 'contract' ? t(' — سعرك الخاص') : ''}
                      </Text>
                    </View>
                    {editable ? (
                      <View style={ui.row}>
                        <Stepper label="−" onPress={() => change(i.id, q - 1)} />
                        <TextInput
                          value={q ? String(q) : ''}
                          placeholder="0"
                          keyboardType="number-pad"
                          onChangeText={(v) => change(i.id, Number(v.replace(/\D/g, '')) || 0)}
                          style={[ui.input, { width: 64, textAlign: 'center', paddingVertical: 8 }]}
                          accessibilityLabel={t('كمية {0}', i.name)}
                        />
                        <Stepper label="+" onPress={() => change(i.id, q + 1)} />
                      </View>
                    ) : (
                      <Text style={[ui.text, { fontWeight: '700' }]}>{q || '—'}</Text>
                    )}
                  </View>
                );
              })}
          </View>
        ))}

        {editable && (
          <TextInput
            style={[ui.input, { minHeight: 60 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder={t('ملاحظات للمخبز (اختياري)')}
            multiline
          />
        )}

        {order && order.events.length > 0 && (
          <View style={ui.card}>
            <Text style={ui.h2}>{t('سجل الطلب')}</Text>
            {order.events.map((e) => (
              <Text key={e.id} style={ui.muted}>
                {t(ORDER_EVENT_LABELS_AR[e.type])} — {new Date(e.createdAt).toLocaleString('ar-JO')}
              </Text>
            ))}
          </View>
        )}

        {editable &&
          order &&
          order.status !== 'draft' &&
          (confirmCancel ? (
            <Button
              title={t('تأكيد إلغاء الطلب')}
              variant="danger"
              busy={busy}
              onPress={() => void cancel()}
            />
          ) : (
            <Button
              title={t('إلغاء الطلب')}
              variant="outline"
              onPress={() => setConfirmCancel(true)}
            />
          ))}
      </ScrollView>

      {editable && (
        <View
          style={{
            padding: 16,
            borderTopWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.white,
            gap: 8,
          }}
        >
          <View style={ui.between}>
            <Text style={ui.text}>{t('{0} أصناف', lines.length)}</Text>
            <Text style={ui.h2}>{formatJod(total)}</Text>
          </View>
          <Button
            title={
              order
                ? order.status === 'draft'
                  ? t('تأكيد الطلب')
                  : t('حفظ التعديل')
                : t('إرسال الطلب')
            }
            onPress={() => void save()}
            busy={busy}
            disabled={lines.length === 0}
          />
        </View>
      )}
    </View>
  );
}

function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.line,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.white,
      }}
    >
      <Text style={{ fontSize: 22, color: colors.brown }}>{label}</Text>
    </Pressable>
  );
}

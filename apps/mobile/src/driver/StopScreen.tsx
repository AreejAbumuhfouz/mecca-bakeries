import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import {
  DELIVERY_REASON_LABELS_AR,
  filsToJodString,
  formatJod,
  PAYMENT_METHOD_LABELS_AR,
  PAYMENT_TYPE_LABELS_AR,
  type DeliveryReason,
  type PaymentMethod,
} from '@mecca/shared';
import { Button } from '../components';
import { colors, ui } from '../theme';
import { SignaturePad, type SignatureValue } from './SignaturePad';
import { enqueue, newClientRef } from './offline';
import type { Confirmation, DriverDay, Stop } from './types';
import { t } from '../i18n';

const SHORT_REASONS: DeliveryReason[] = [
  'bakery_shortage',
  'customer_refused',
  'damaged',
  'quality',
  'other',
];
const RETURN_REASONS: DeliveryReason[] = ['unsold', 'damaged', 'quality', 'wrong_item', 'other'];
const FAIL_REASONS: DeliveryReason[] = ['shop_closed', 'customer_refused', 'other'];

function Chips<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: T[];
  value: T | null;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: value === o ? colors.gold : colors.line,
            backgroundColor: value === o ? colors.goldLight : colors.white,
          }}
        >
          <Text
            style={{ fontSize: 13, color: colors.brown, fontWeight: value === o ? '700' : '400' }}
          >
            {t(labels[o])}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Stepper({
  value,
  max,
  onChange,
  label,
}: {
  value: number;
  max?: number;
  onChange: (n: number) => void;
  label: string;
}) {
  const btn = (icon: 'remove' | 'add', next: number, disabled: boolean) => (
    <Pressable
      accessibilityLabel={`${icon === 'add' ? t('زيادة') : t('إنقاص')} ${label}`}
      disabled={disabled}
      onPress={() => onChange(next)}
      style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.goldLight,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Ionicons name={icon} size={20} color={colors.brown} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {btn('remove', Math.max(0, value - 1), value <= 0)}
      <TextInput
        accessibilityLabel={label}
        keyboardType="number-pad"
        value={String(value)}
        onChangeText={(tr) => {
          const n = Number(tr.replace(/[^\d]/g, '') || 0);
          onChange(max !== undefined ? Math.min(max, n) : n);
        }}
        style={[ui.input, { width: 64, paddingVertical: 6, textAlign: 'center' }]}
      />
      {btn(
        'add',
        max !== undefined ? Math.min(max, value + 1) : value + 1,
        max !== undefined && value >= max,
      )}
    </View>
  );
}

async function currentPosition() {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ]);
    return pos
      ? {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? null,
        }
      : null;
  } catch {
    return null;
  }
}

export function StopScreen({
  stop,
  catalog,
  onClose,
}: {
  stop: Stop;
  catalog: DriverDay['catalog'];
  onClose: (queued: boolean) => void;
}) {
  const [delivered, setDelivered] = useState<Record<string, number>>(() =>
    Object.fromEntries(stop.items.map((i) => [i.itemId, i.quantity])),
  );
  const [shortReason, setShortReason] = useState<Record<string, DeliveryReason>>({});
  const [returns, setReturns] = useState<
    { itemId: string; qty: number; reason: DeliveryReason | null }[]
  >([]);
  const [pickReturn, setPickReturn] = useState(false);
  const [receiver, setReceiver] = useState('');
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [cash, setCash] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [failing, setFailing] = useState(false);
  const [failReason, setFailReason] = useState<DeliveryReason | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const priceOf = (itemId: string) => stop.items.find((i) => i.itemId === itemId)?.unitPrice ?? 0;
  // Rough value of what is being handed over (the server issues the real invoice).
  const estimate =
    stop.items.reduce((sum, i) => sum + (delivered[i.itemId] ?? 0) * i.unitPrice, 0) -
    returns.reduce((sum, r) => sum + r.qty * priceOf(r.itemId), 0);

  function build(outcome: 'delivered' | 'failed'): Confirmation | string {
    if (outcome === 'failed') {
      if (!failReason) return t('اختر سبب عدم التسليم');
      return {
        clientRef: newClientRef(),
        outcome,
        failReason,
        lines: [],
        deliveredAt: new Date().toISOString(),
        note: note || null,
      };
    }
    for (const i of stop.items)
      if ((delivered[i.itemId] ?? 0) < i.quantity && !shortReason[i.itemId])
        return t('اختر سبب النقص في {0}', i.name);
    for (const r of returns) if (r.qty > 0 && !r.reason) return t('اختر سبب كل مرتجع');
    if (receiver.trim().length < 2 && !signature) return t('اكتب اسم المستلم أو خذ توقيعه');
    const amount = cash.trim()
      ? Math.round(Number(cash.replace(/[٠-٩]/g, (d) => String(t('٠١٢٣٤٥٦٧٨٩').indexOf(d)))) * 1000)
      : 0;
    if (Number.isNaN(amount) || amount < 0) return t('المبلغ المحصّل غير صحيح');
    if (amount > 0 && method === 'cheque' && !reference.trim()) return t('اكتب رقم الشيك');
    const lines = stop.items.map((i) => ({
      itemId: i.itemId,
      deliveredQty: delivered[i.itemId] ?? 0,
      shortReason: (delivered[i.itemId] ?? 0) < i.quantity ? shortReason[i.itemId] : null,
      returnedQty: returns.filter((r) => r.itemId === i.itemId).reduce((s, r) => s + r.qty, 0),
      returnReason: returns.find((r) => r.itemId === i.itemId)?.reason ?? null,
    }));
    for (const r of returns)
      if (!stop.items.some((i) => i.itemId === r.itemId) && r.qty > 0)
        lines.push({
          itemId: r.itemId,
          deliveredQty: 0,
          shortReason: null,
          returnedQty: r.qty,
          returnReason: r.reason,
        });
    return {
      clientRef: newClientRef(),
      outcome,
      lines,
      receiverName: receiver.trim() || null,
      signature,
      deliveredAt: new Date().toISOString(),
      collected: amount > 0 ? { amount, method, reference: reference.trim() || null } : null,
      note: note.trim() || null,
    };
  }

  async function submit(outcome: 'delivered' | 'failed') {
    const c = build(outcome);
    if (typeof c === 'string') return setError(c);
    setError('');
    setBusy(true);
    // Location is read only now, at the moment of confirmation.
    const pos = await currentPosition();
    await enqueue({
      deliveryId: stop.deliveryId,
      confirmation: { ...c, ...(pos ?? {}) },
      label: `${stop.customer.name} — ${stop.branch.name}`,
      queuedAt: new Date().toISOString(),
    });
    setBusy(false);
    onClose(true);
  }

  const phone = stop.branch.phone ?? stop.customer.phone;

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.content}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={() => onClose(false)} style={ui.row}>
        <Ionicons name="arrow-forward" size={18} color={colors.muted} />
        <Text style={ui.muted}>{t('رجوع للمسار')}</Text>
      </Pressable>
      <View style={ui.card}>
        <Text style={ui.h1}>
          {stop.position}. {stop.customer.name}
        </Text>
        <Text style={ui.text}>{stop.branch.name}</Text>
        {stop.branch.address ? <Text style={ui.muted}>{stop.branch.address}</Text> : null}
        <View style={ui.between}>
          <Text style={ui.muted}>
            {stop.order.number} — {t(PAYMENT_TYPE_LABELS_AR[stop.paymentType])}
          </Text>
          {phone ? (
            <Pressable onPress={() => void Linking.openURL(`tel:${phone}`)} style={ui.row}>
              <Ionicons name="call" size={16} color={colors.gold} />
              <Text style={{ color: colors.gold, fontWeight: '700' }}>{phone}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={ui.between}>
          <Text style={ui.muted}>{t('رصيد سابق على العميل')}</Text>
          <Text
            style={[
              ui.text,
              { fontWeight: '700', color: stop.balance > 0 ? colors.red : colors.green },
            ]}
          >
            {formatJod(stop.balance)}
          </Text>
        </View>
        {stop.order.notes ? (
          <Text style={ui.muted}>{t('ملاحظة الطلب: {0}', stop.order.notes)}</Text>
        ) : null}
      </View>

      {error ? <Text style={ui.error}>{error}</Text> : null}

      {failing ? (
        <View style={ui.card}>
          <Text style={ui.h2}>{t('لم يُسلَّم — السبب')}</Text>
          <Chips
            options={FAIL_REASONS}
            value={failReason}
            onChange={setFailReason}
            labels={DELIVERY_REASON_LABELS_AR}
          />
          <TextInput
            placeholder={t('ملاحظة (اختياري)')}
            placeholderTextColor={colors.muted}
            value={note}
            onChangeText={setNote}
            style={ui.input}
          />
          <Button
            title={t('تأكيد: لم يُسلَّم')}
            variant="danger"
            busy={busy}
            onPress={() => void submit('failed')}
          />
          <Button title={t('رجوع')} variant="outline" onPress={() => setFailing(false)} />
        </View>
      ) : (
        <>
          <View style={ui.card}>
            <Text style={ui.h2}>{t('الأصناف')}</Text>
            {stop.items.map((i) => {
              const q = delivered[i.itemId] ?? 0;
              return (
                <View
                  key={i.itemId}
                  style={{
                    gap: 6,
                    borderBottomWidth: 1,
                    borderColor: colors.line,
                    paddingBottom: 10,
                  }}
                >
                  <View style={ui.between}>
                    <View style={{ flex: 1 }}>
                      <Text style={[ui.text, { fontWeight: '700' }]}>{i.name}</Text>
                      <Text style={ui.muted}>{t('المطلوب {0} {1}', i.quantity, i.unitLabel)}</Text>
                    </View>
                    <Stepper
                      value={q}
                      max={i.quantity}
                      label={i.name}
                      onChange={(n) => setDelivered({ ...delivered, [i.itemId]: n })}
                    />
                  </View>
                  {q < i.quantity && (
                    <View style={{ gap: 4 }}>
                      <Text style={{ color: colors.red, fontSize: 13 }}>
                        {t('ناقص {0} — السبب:', i.quantity - q)}
                      </Text>
                      <Chips
                        options={SHORT_REASONS}
                        value={shortReason[i.itemId] ?? null}
                        onChange={(r) => setShortReason({ ...shortReason, [i.itemId]: r })}
                        labels={DELIVERY_REASON_LABELS_AR}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {stop.allowReturns && (
            <View style={ui.card}>
              <View style={ui.between}>
                <Text style={ui.h2}>{t('المرتجع من العميل')}</Text>
                <Text style={ui.muted}>{t('حتى {0}%', stop.maxReturnBps / 100)}</Text>
              </View>
              {returns.map((r, idx) => {
                const item = catalog.find((c) => c.id === r.itemId);
                return (
                  <View key={idx} style={{ gap: 6 }}>
                    <View style={ui.between}>
                      <Text style={[ui.text, { flex: 1 }]}>{item?.name}</Text>
                      <Stepper
                        value={r.qty}
                        label={t('مرتجع {0}', item?.name ?? '')}
                        onChange={(n) =>
                          setReturns(returns.map((x, j) => (j === idx ? { ...x, qty: n } : x)))
                        }
                      />
                      <Pressable
                        accessibilityLabel={t('حذف المرتجع')}
                        onPress={() => setReturns(returns.filter((_, j) => j !== idx))}
                      >
                        <Ionicons name="close-circle" size={22} color={colors.red} />
                      </Pressable>
                    </View>
                    <Chips
                      options={RETURN_REASONS}
                      value={r.reason}
                      onChange={(reason) =>
                        setReturns(returns.map((x, j) => (j === idx ? { ...x, reason } : x)))
                      }
                      labels={DELIVERY_REASON_LABELS_AR}
                    />
                  </View>
                );
              })}
              {pickReturn ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {catalog
                    .filter((c) => !returns.some((r) => r.itemId === c.id))
                    .map((c) => (
                      <Pressable
                        key={c.id}
                        onPress={() => {
                          setReturns([...returns, { itemId: c.id, qty: 1, reason: null }]);
                          setPickReturn(false);
                        }}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: colors.line,
                          backgroundColor: colors.white,
                        }}
                      >
                        <Text style={{ color: colors.brown, fontSize: 13 }}>{c.name}</Text>
                      </Pressable>
                    ))}
                </View>
              ) : (
                <Pressable onPress={() => setPickReturn(true)} style={ui.row}>
                  <Ionicons name="add-circle-outline" size={20} color={colors.gold} />
                  <Text style={{ color: colors.gold, fontWeight: '700' }}>{t('إضافة مرتجع')}</Text>
                </Pressable>
              )}
            </View>
          )}

          <View style={ui.card}>
            <View style={ui.between}>
              <Text style={ui.h2}>{t('قيمة التسليم (تقريباً)')}</Text>
              <Text style={[ui.h2, { color: colors.gold }]}>{formatJod(estimate)}</Text>
            </View>
            <Text style={ui.muted}>
              {t('الفاتورة النهائية تصدر من النظام على الكمية المسلّمة.')}
            </Text>
          </View>

          <View style={ui.card}>
            <Text style={ui.h2}>{t('المستلم')}</Text>
            <TextInput
              accessibilityLabel={t('اسم المستلم')}
              placeholder={t('اسم المستلم')}
              placeholderTextColor={colors.muted}
              value={receiver}
              onChangeText={setReceiver}
              style={ui.input}
            />
            <SignaturePad onChange={setSignature} />
          </View>

          <View style={ui.card}>
            <Text style={ui.h2}>{t('التحصيل')}</Text>
            <Chips
              options={['cash', 'cheque', 'transfer'] as PaymentMethod[]}
              value={method}
              onChange={setMethod}
              labels={PAYMENT_METHOD_LABELS_AR}
            />
            <TextInput
              accessibilityLabel={t('المبلغ المحصّل')}
              placeholder={
                stop.paymentType === 'cash'
                  ? t('مثلاً {0}', filsToJodString(estimate))
                  : t('المبلغ المحصّل (إن وجد)')
              }
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              value={cash}
              onChangeText={setCash}
              style={ui.input}
            />
            {method !== 'cash' && (
              <TextInput
                placeholder={method === 'cheque' ? t('رقم الشيك') : t('رقم الحوالة')}
                placeholderTextColor={colors.muted}
                value={reference}
                onChangeText={setReference}
                style={ui.input}
              />
            )}
            <TextInput
              placeholder={t('ملاحظة (اختياري)')}
              placeholderTextColor={colors.muted}
              value={note}
              onChangeText={setNote}
              style={ui.input}
            />
          </View>

          <Button
            title={t('تأكيد التسليم')}
            variant="gold"
            busy={busy}
            onPress={() => void submit('delivered')}
          />
          <Button title={t('لم يُسلَّم')} variant="outline" onPress={() => setFailing(true)} />
          <Text style={[ui.muted, { textAlign: 'center' }]}>
            {t('يُسجَّل موقعك لحظة التأكيد فقط.')}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

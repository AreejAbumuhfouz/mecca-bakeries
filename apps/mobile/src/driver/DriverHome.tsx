import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DELIVERY_STATUS_LABELS_AR, formatJod, type DeliveryStatus } from '@mecca/shared';
import { useAuth } from '../auth';
import { Button, Empty } from '../components';
import { colors, ui, useTheme } from '../theme';
import { discard, loadDay, loadQueue, pendingIds, sync } from './offline';
import { StopScreen } from './StopScreen';
import type { DriverDay, Queued, Stop } from './types';
import { t } from '../i18n';

const tone = (s: DeliveryStatus | 'queued'): [string, string] =>
  ({
    pending: [colors.grayBg, colors.muted],
    queued: [colors.goldLight, colors.brown],
    delivered: [colors.greenBg, colors.green],
    partial: [colors.goldLight, colors.brown],
    failed: [colors.redBg, colors.red],
  })[s] as [string, string];

export function DriverHome() {
  const { user, logout } = useAuth();
  const { mode, toggle } = useTheme();
  const [day, setDay] = useState<DriverDay | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState<Stop | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    const r = await sync();
    if (r.day) setDay(r.day);
    setQueue(r.queue);
    setOnline(r.online);
    setSyncing(false);
    setLoading(false);
    busy.current = false;
  }, []);

  useEffect(() => {
    // Show what the phone has right away, then try the server.
    void Promise.all([loadDay(), loadQueue()]).then(([d, q]) => {
      if (d) {
        setDay(d);
        setLoading(false);
      }
      setQueue(q);
      void refresh();
    });
    const timer = setInterval(() => void refresh(), 30_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  if (open && day)
    return (
      <StopScreen
        stop={open}
        catalog={day.catalog}
        onClose={(queued) => {
          setOpen(null);
          void loadQueue().then(setQueue);
          if (queued) void refresh();
        }}
      />
    );

  const waiting = pendingIds(queue);
  const problems = queue.filter((q) => q.error);
  const stops = day?.trips.flatMap((tr) => tr.stops) ?? [];
  const done = stops.filter((s) => s.status !== 'pending' || waiting.has(s.deliveryId)).length;

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void refresh()} />}
    >
      <View style={ui.between}>
        <View>
          <Text style={ui.h1}>{t('توزيع اليوم')}</Text>
          <Text style={ui.muted}>
            {user?.name} — {day?.date ?? ''}
          </Text>
        </View>
        <View style={ui.row}>
          <Pressable accessibilityLabel={t('تغيير المظهر')} onPress={toggle} style={{ padding: 8 }}>
            <Ionicons
              name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
              size={22}
              color={colors.brown}
            />
          </Pressable>
          <Pressable
            accessibilityLabel={t('تسجيل الخروج')}
            onPress={() => void logout()}
            style={{ padding: 8 }}
          >
            <Ionicons name="log-out-outline" size={22} color={colors.brown} />
          </Pressable>
        </View>
      </View>

      <View style={[ui.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
        <Ionicons
          name={online ? 'cloud-done-outline' : 'cloud-offline-outline'}
          size={24}
          color={online ? colors.green : colors.red}
        />
        <View style={{ flex: 1 }}>
          <Text style={[ui.text, { fontWeight: '700' }]}>
            {online ? t('متصل') : t('بدون إنترنت — التطبيق يعمل والتأكيدات محفوظة')}
          </Text>
          <Text style={ui.muted}>
            {waiting.size ? t('{0} تأكيد بانتظار الإرسال', waiting.size) : t('كل التأكيدات أُرسلت')}
          </Text>
        </View>
        {syncing ? (
          <ActivityIndicator color={colors.gold} />
        ) : (
          <Pressable onPress={() => void refresh()} accessibilityLabel={t('مزامنة الآن')}>
            <Ionicons name="sync" size={22} color={colors.gold} />
          </Pressable>
        )}
      </View>

      {problems.map((q) => (
        <View key={q.deliveryId} style={[ui.card, { borderColor: colors.red }]}>
          <Text style={[ui.text, { fontWeight: '700', color: colors.red }]}>
            {t('لم يُقبل تأكيد: {0}', q.label)}
          </Text>
          <Text style={ui.muted}>{q.error?.message}</Text>
          <Button
            title={t('إزالته من الهاتف')}
            variant="outline"
            onPress={() => void discard(q.deliveryId).then(() => refresh())}
          />
        </View>
      ))}

      {loading && !day ? <ActivityIndicator color={colors.gold} size="large" /> : null}
      {day && day.trips.length === 0 && <Empty>{t('لا يوجد مسار لك اليوم.')}</Empty>}

      {day?.trips.map((tr) => (
        <View key={tr.id} style={{ gap: 10 }}>
          <View style={ui.between}>
            <Text style={ui.h2}>{tr.route.name}</Text>
            <Text style={ui.muted}>
              {done}/{stops.length} — {tr.vehicle?.name ?? ''}
            </Text>
          </View>
          {tr.stops.map((s) => {
            const st: DeliveryStatus | 'queued' =
              s.status === 'pending' && waiting.has(s.deliveryId) ? 'queued' : s.status;
            const [bg, fg] = tone(st);
            return (
              <Pressable
                key={s.deliveryId}
                disabled={st !== 'pending'}
                onPress={() => setOpen(s)}
                style={({ pressed }) => [ui.card, pressed && { opacity: 0.85 }]}
              >
                <View style={ui.between}>
                  <Text style={[ui.h2, { flex: 1 }]}>
                    {s.position}. {s.customer.name}
                  </Text>
                  <Text
                    style={{
                      backgroundColor: bg,
                      color: fg,
                      paddingHorizontal: 10,
                      paddingVertical: 3,
                      borderRadius: 999,
                      overflow: 'hidden',
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  >
                    {st === 'queued' ? t('بانتظار الإرسال') : DELIVERY_STATUS_LABELS_AR[st]}
                  </Text>
                </View>
                <Text style={ui.text}>{s.branch.name}</Text>
                {s.branch.address ? <Text style={ui.muted}>{s.branch.address}</Text> : null}
                <View style={ui.between}>
                  <Text style={ui.muted}>
                    {t('{0} صنف — {1}', s.items.length, formatJod(s.order.total))}
                  </Text>
                  {s.balance > 0 && (
                    <Text style={{ color: colors.red, fontSize: 13 }}>
                      {t('رصيد {0}', formatJod(s.balance))}
                    </Text>
                  )}
                </View>
                {s.result?.invoice && (
                  <Text style={ui.muted}>
                    {t(
                      'فاتورة {0} — {1}',
                      s.result.invoice.number,
                      formatJod(s.result.invoice.total),
                    )}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { formatJod } from '@mecca/shared';
import { api, errorText } from '../api';
import { Empty, StatusBadge } from '../components';
import { ui } from '../theme';
import type { OrderRow } from '../types';

export function OrdersScreen({
  onOpenOrder,
  refreshKey,
}: {
  onOpenOrder: (branchId: string, orderId: string) => void;
  refreshKey: number;
}) {
  const [orders, setOrders] = useState<(OrderRow & { branchId: string })[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(
        (await api<{ items: (OrderRow & { branchId: string })[] }>('/api/app/orders?pageSize=50'))
          .items,
      );
      setError('');
    } catch (err) {
      setError(errorText(err, 'تعذّر التحميل'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
    >
      <Text style={ui.h1}>طلباتي</Text>
      {error ? <Text style={ui.error}>{error}</Text> : null}
      {orders?.map((o) => (
        <Pressable key={o.id} onPress={() => onOpenOrder(o.branchId, o.id)}>
          <View style={ui.card}>
            <View style={ui.between}>
              <Text style={ui.h2}>{o.deliveryDate}</Text>
              <StatusBadge status={o.status} />
            </View>
            <Text style={ui.text}>
              {o.branchName} — {o.number}
            </Text>
            <Text style={ui.muted}>
              {o.itemCount} أصناف — {formatJod(o.total)}
            </Text>
          </View>
        </Pressable>
      ))}
      {orders?.length === 0 && <Empty>لا توجد طلبات بعد</Empty>}
    </ScrollView>
  );
}

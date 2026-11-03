import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from '../api';
import type { Confirmation, DriverDay, Queued } from './types';

/**
 * The driver works without a connection: the day's trips are cached on the phone, and each
 * confirmation goes into a queue that is sent when the network is back. The server accepts
 * a re-sent confirmation (same clientRef) as a duplicate, so retrying is always safe.
 * If the office changed something in the meantime the server refuses the item; it stays
 * in the queue with the reason until the driver removes it.
 */
const CACHE = 'mb_driver_day';
const QUEUE = 'mb_driver_queue';

export async function loadDay(): Promise<DriverDay | null> {
  const raw = await AsyncStorage.getItem(CACHE);
  return raw ? (JSON.parse(raw) as DriverDay) : null;
}
export const saveDay = (day: DriverDay) => AsyncStorage.setItem(CACHE, JSON.stringify(day));

export async function loadQueue(): Promise<Queued[]> {
  const raw = await AsyncStorage.getItem(QUEUE);
  return raw ? (JSON.parse(raw) as Queued[]) : [];
}
const saveQueue = (q: Queued[]) => AsyncStorage.setItem(QUEUE, JSON.stringify(q));

export async function enqueue(item: Queued) {
  const q = await loadQueue();
  await saveQueue([...q.filter((x) => x.deliveryId !== item.deliveryId), item]);
}

export async function discard(deliveryId: string) {
  await saveQueue((await loadQueue()).filter((x) => x.deliveryId !== deliveryId));
}

/** A reference unique to this confirmation, generated on the phone. */
export function newClientRef() {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `drv-${Date.now().toString(36)}-${rnd()}${rnd()}`;
}

export type SyncResult = { online: boolean; day: DriverDay | null; queue: Queued[]; sent: number };

/** Sends what is waiting, then refreshes the day. Never throws. */
export async function sync(): Promise<SyncResult> {
  let queue = await loadQueue();
  const waiting = queue.filter((q) => !q.error);
  try {
    if (waiting.length) {
      const r = await api<{
        results: {
          deliveryId: string;
          ok: boolean;
          error?: { status: number; code: string; message: string };
        }[];
        trips: DriverDay;
      }>('/api/driver/sync', {
        method: 'POST',
        body: {
          items: waiting.map((q) => ({ deliveryId: q.deliveryId, confirmation: q.confirmation })),
        },
      });
      let sent = 0;
      queue = queue.flatMap((q) => {
        const res = r.results.find((x) => x.deliveryId === q.deliveryId);
        if (!res) return [q];
        if (res.ok) {
          sent++;
          return [];
        }
        // 5xx: try again later; anything else needs the driver's attention.
        if ((res.error?.status ?? 500) >= 500) return [q];
        return [{ ...q, error: { code: res.error!.code, message: res.error!.message } }];
      });
      await saveQueue(queue);
      await saveDay(r.trips);
      return { online: true, day: r.trips, queue, sent };
    }
    const day = await api<DriverDay>('/api/driver/trips');
    await saveDay(day);
    return { online: true, day, queue, sent: 0 };
  } catch (err) {
    const offline = err instanceof ApiError && err.code === 'NETWORK';
    return { online: !offline, day: await loadDay(), queue, sent: 0 };
  }
}

export function pendingIds(queue: Queued[]) {
  return new Set(queue.filter((q) => !q.error).map((q) => q.deliveryId));
}

export type { Confirmation };

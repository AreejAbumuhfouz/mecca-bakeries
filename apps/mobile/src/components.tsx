import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ORDER_STATUS_LABELS_AR, type OrderStatus } from '@mecca/shared';
import { colors } from './theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'gold' | 'outline' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const v = styles[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        v,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'outline' ? colors.brown : colors.white} />
      ) : (
        <Text style={[styles.buttonText, variant === 'outline' && { color: colors.brown }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const STATUS_COLORS: Record<OrderStatus, [string, string]> = {
  draft: ['#EEE', colors.muted],
  submitted: [colors.goldLight, colors.brown],
  pending_approval: [colors.redBg, colors.red],
  confirmed: [colors.greenBg, colors.green],
  delivered: [colors.greenBg, colors.green],
  rejected: [colors.redBg, colors.red],
  cancelled: ['#EEE', colors.muted],
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const [bg, fg] = STATUS_COLORS[status];
  return (
    <Text style={[styles.badge, { backgroundColor: bg, color: fg }]}>
      {ORDER_STATUS_LABELS_AR[status]}
    </Text>
  );
}

/** Live countdown to the cutoff, corrected for the phone's clock using the server time. */
export function Countdown({ cutoffAt, serverNow }: { cutoffAt: string; serverNow: string }) {
  const [skew] = useState(() => Date.parse(serverNow) - Date.now());
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(id);
  }, [skew]);
  const left = Math.max(0, Date.parse(cutoffAt) - now);
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <View style={styles.countdown}>
      <Text style={styles.countdownLabel}>{left > 0 ? 'يُغلق الطلب بعد' : 'أُغلق الطلب'}</Text>
      {left > 0 && <Text style={styles.countdownTime}>{`${pad(h)}:${pad(m)}:${pad(s)}`}</Text>}
    </View>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <Text style={{ textAlign: 'center', color: colors.muted, padding: 24 }}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primary: { backgroundColor: colors.brown },
  gold: { backgroundColor: colors.gold },
  outline: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.brown },
  danger: { backgroundColor: colors.red },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '700',
  },
  countdown: {
    backgroundColor: colors.brown,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  countdownLabel: { color: colors.goldLight, fontSize: 14 },
  countdownTime: {
    color: colors.white,
    fontSize: 34,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});

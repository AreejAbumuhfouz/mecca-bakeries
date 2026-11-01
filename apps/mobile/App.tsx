import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, Image, StyleSheet, Text, View } from 'react-native';
import type { ApiResponse, HealthStatus } from '@mecca/shared';

// The app is Arabic-first. forceRTL takes effect after the first reload.
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

// On a real phone "localhost" is the phone itself: set this to your Mac's Wi-Fi IP in .env
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const colors = { brown: '#3E2A1C', gold: '#C8862A', cream: '#FBF7F0', muted: '#7A6E62' };

export default function App() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'down'>('loading');

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((r) => r.json() as Promise<ApiResponse<HealthStatus>>)
      .then((body) => setStatus(body.ok && body.data.status === 'ok' ? 'ok' : 'down'))
      .catch(() => setStatus('down'));
  }, []);

  const label = {
    loading: 'جارٍ الاتصال بالخادم…',
    ok: 'متصل بالخادم ✓',
    down: 'تعذّر الاتصال بالخادم',
  }[status];

  return (
    <View style={styles.container}>
      {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
      <Image source={require('./assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>مخابز مكة</Text>
      <Text style={styles.subtitle}>تطبيق المطاعم والسائقين</Text>
      <Text
        style={[styles.badge, status === 'ok' ? styles.ok : status === 'down' ? styles.down : null]}
      >
        {label}
      </Text>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  logo: { width: 160, height: 135 },
  title: { marginTop: 16, fontSize: 26, fontWeight: '700', color: colors.brown },
  subtitle: { marginTop: 4, fontSize: 15, color: colors.muted },
  badge: {
    marginTop: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#F7EAD0',
    color: colors.brown,
    fontWeight: '700',
  },
  ok: { backgroundColor: '#E3F2E8', color: '#2E7D4F' },
  down: { backgroundColor: '#F9E3E0', color: '#B83A2E' },
});

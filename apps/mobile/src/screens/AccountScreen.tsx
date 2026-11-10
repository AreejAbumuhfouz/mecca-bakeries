import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatJod } from '@mecca/shared';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components';
import { colors, ui, useTheme } from '../theme';
import type { Me } from '../types';
import { t } from '../i18n';

export function AccountScreen() {
  const { user, logout } = useAuth();
  const { mode, toggle } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void api<Me>('/api/app/me')
      .then(setMe)
      .catch((err) => setError(errorText(err, t('تعذّر التحميل'))));
  }, []);

  const c = me?.credit;
  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
      <Text style={ui.h1}>{t('حسابي')}</Text>
      <View style={ui.card}>
        <Text style={ui.h2}>{user?.name}</Text>
        <Text style={ui.muted}>{user?.email}</Text>
      </View>
      {error ? <Text style={ui.error}>{error}</Text> : null}
      {c && (
        <View style={ui.card}>
          <Text style={ui.h2}>{t('العقد والرصيد')}</Text>
          <Row label={t('رقم العقد')} value={c.contract ? c.contract.number : t('لا يوجد عقد')} />
          {c.contract && <Row label={t('ينتهي في')} value={c.contract.endDate} />}
          <Row label={t('الرصيد المستحق')} value={formatJod(c.outstanding)} />
          <Row
            label={t('متأخر السداد')}
            value={formatJod(c.overdueAmount)}
            danger={c.overdueAmount > 0}
          />
          <Row
            label={t('الائتمان المتاح')}
            value={c.available === null ? t('نقدي') : formatJod(Math.max(0, c.available))}
          />
          {c.reasons.map((r) => (
            <Text key={r.code} style={ui.error}>
              {r.message}
            </Text>
          ))}
        </View>
      )}
      {me && (
        <View style={ui.card}>
          <Text style={ui.h2}>{t('الفروع')}</Text>
          {me.branches.map((b) => (
            <Text key={b.id} style={ui.text}>
              • {b.name} <Text style={ui.muted}>{b.code}</Text>
            </Text>
          ))}
        </View>
      )}
      <Pressable onPress={toggle} style={[ui.card, ui.between]} accessibilityRole="switch">
        <View style={ui.row}>
          <Ionicons name={mode === 'dark' ? 'moon' : 'sunny'} size={20} color={colors.gold} />
          <Text style={ui.text}>{t('المظهر')}</Text>
        </View>
        <Text style={[ui.text, { fontWeight: '700' }]}>
          {mode === 'dark' ? t('داكن') : t('فاتح')}
        </Text>
      </Pressable>
      <Button title={t('تسجيل الخروج')} variant="outline" onPress={() => void logout()} />
      {process.env.EXPO_PUBLIC_PRIVACY_URL ? (
        <Pressable onPress={() => void Linking.openURL(process.env.EXPO_PUBLIC_PRIVACY_URL!)}>
          <Text style={[ui.muted, { textAlign: 'center', textDecorationLine: 'underline' }]}>
            {t('سياسة الخصوصية')}
          </Text>
        </Pressable>
      ) : null}
      <Text style={[ui.muted, { textAlign: 'center', color: colors.muted }]}>
        {t('مخابز مكة — الإصدار 1.0.0')}
      </Text>
    </ScrollView>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={ui.between}>
      <Text style={ui.muted}>{label}</Text>
      <Text style={[ui.text, { fontWeight: '700' }, danger && { color: colors.red }]}>{value}</Text>
    </View>
  );
}

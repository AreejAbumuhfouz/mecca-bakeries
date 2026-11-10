import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, SafeAreaView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider, useAuth } from './src/auth';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { OrderScreen } from './src/screens/OrderScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { AccountScreen } from './src/screens/AccountScreen';
import { InvoicesScreen } from './src/screens/InvoicesScreen';
import { DriverHome } from './src/driver/DriverHome';
import { colors, ThemeProvider, useTheme } from './src/theme';
import { t } from './src/i18n';

// The layout direction follows the language (set in src/i18n.ts before App loads).

type Tab = 'home' | 'orders' | 'invoices' | 'account';
type IconName = keyof typeof Ionicons.glyphMap;
const TABS: { key: Tab; label: string; icon: IconName; active: IconName }[] = [
  { key: 'home', label: t('طلب اليوم'), icon: 'basket-outline', active: 'basket' },
  { key: 'orders', label: t('طلباتي'), icon: 'list-outline', active: 'list' },
  { key: 'invoices', label: t('فواتيري'), icon: 'receipt-outline', active: 'receipt' },
  { key: 'account', label: t('حسابي'), icon: 'person-outline', active: 'person' },
];

function Main() {
  const { user, loading } = useAuth();
  const { mode } = useTheme(); // re-renders the whole tree when the theme changes
  const [tab, setTab] = useState<Tab>('home');
  const [open, setOpen] = useState<{ branchId: string; orderId: string | null } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const body = (() => {
    if (loading)
      return (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.cream,
          }}
        >
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      );
    if (!user) return <LoginScreen />;
    // Drivers get the delivery app; restaurants get ordering.
    if (
      user.permissions.includes('deliveries.confirm') &&
      !user.permissions.includes('orders.place')
    )
      return <DriverHome />;
    if (open)
      return (
        <OrderScreen
          branchId={open.branchId}
          orderId={open.orderId}
          onClose={() => {
            setOpen(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      );
    const openOrder = (branchId: string, orderId: string | null) => setOpen({ branchId, orderId });
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream }}>
        <View style={{ flex: 1 }}>
          {tab === 'home' && <HomeScreen onOpenOrder={openOrder} refreshKey={refreshKey} />}
          {tab === 'orders' && <OrdersScreen onOpenOrder={openOrder} refreshKey={refreshKey} />}
          {tab === 'invoices' && <InvoicesScreen />}
          {tab === 'account' && <AccountScreen />}
        </View>
        <View
          style={{
            flexDirection: 'row',
            borderTopWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.bar,
          }}
        >
          {TABS.map((tr) => {
            const on = tab === tr.key;
            return (
              <Pressable
                key={tr.key}
                onPress={() => setTab(tr.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 8, gap: 2 }}
              >
                <Ionicons
                  name={on ? tr.active : tr.icon}
                  size={22}
                  color={on ? colors.gold : colors.muted}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: on ? '700' : '400',
                    color: on ? colors.gold : colors.muted,
                  }}
                >
                  {tr.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  })();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bar }}>
      {body}
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Main />
      </AuthProvider>
    </ThemeProvider>
  );
}

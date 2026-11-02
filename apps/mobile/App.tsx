import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, I18nManager, Pressable, SafeAreaView, Text, View } from 'react-native';
import { AuthProvider, useAuth } from './src/auth';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { OrderScreen } from './src/screens/OrderScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { AccountScreen } from './src/screens/AccountScreen';
import { colors } from './src/theme';

// Arabic first. forceRTL takes effect after the first reload of the app.
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

type Tab = 'home' | 'orders' | 'account';
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'home', label: 'طلب اليوم', icon: '🥖' },
  { key: 'orders', label: 'طلباتي', icon: '📋' },
  { key: 'account', label: 'حسابي', icon: '👤' },
];

function Main() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('home');
  const [open, setOpen] = useState<{ branchId: string; orderId: string | null } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
        <ActivityIndicator color={colors.brown} size="large" />
      </View>
    );
  if (!user) return <LoginScreen />;

  if (open)
    return (
      <OrderScreen
        branchId={open.branchId}
        orderId={open.orderId}
        onClose={(changed) => {
          setOpen(null);
          if (changed) setRefreshKey((k) => k + 1);
          else setRefreshKey((k) => k + 1);
        }}
      />
    );

  const openOrder = (branchId: string, orderId: string | null) => setOpen({ branchId, orderId });

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen onOpenOrder={openOrder} refreshKey={refreshKey} />}
        {tab === 'orders' && <OrdersScreen onOpenOrder={openOrder} refreshKey={refreshKey} />}
        {tab === 'account' && <AccountScreen />}
      </View>
      <View
        style={{
          flexDirection: 'row',
          borderTopWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.white,
        }}
      >
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10 }}
          >
            <Text style={{ fontSize: 20 }}>{t.icon}</Text>
            <Text
              style={{
                fontSize: 12,
                fontWeight: tab === t.key ? '700' : '400',
                color: tab === t.key ? colors.gold : colors.muted,
              }}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }}>
        <Main />
      </SafeAreaView>
      <StatusBar style="dark" />
    </AuthProvider>
  );
}

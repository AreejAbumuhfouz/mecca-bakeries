import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';

let currentToken: string | null = null;

// Show notifications while the app is open too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Asks for permission and sends the Expo push token to the API.
 * Needs a real device and an EAS project id (set when the client's Expo account is ready);
 * Android push does not work inside Expo Go. Any failure is ignored: push is optional.
 */
export async function registerForPush() {
  try {
    if (!Device.isDevice) return;
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;
    if (Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'الطلبات',
        importance: Notifications.AndroidImportance.HIGH,
      });
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api('/api/app/push-token', { method: 'POST', body: { token, platform: Platform.OS } });
    currentToken = token;
  } catch {
    // Push is a convenience; ordering works without it.
  }
}

export async function unregisterPush() {
  if (!currentToken) return;
  await api('/api/app/push-token', { method: 'DELETE', body: { token: currentToken } }).catch(
    () => undefined,
  );
  currentToken = null;
}

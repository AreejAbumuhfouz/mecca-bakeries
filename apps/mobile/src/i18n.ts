import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, DevSettings, I18nManager } from 'react-native';
import { DEFAULT_LOCALE, LOCALES, setLocaleSource, translate, type Locale } from '@mecca/shared';

/**
 * App language. index.ts loads it before the app's modules are evaluated, so constants
 * at the top of screen files are already in the right language.
 */
const KEY = 'mb-locale';
let current: Locale = DEFAULT_LOCALE;

export const getLocale = () => current;
setLocaleSource(getLocale);
export const t = (text: string, ...args: unknown[]) => translate(current, text, args);

/** Reads the saved language and sets the layout direction to match it. */
export async function loadLocale() {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v && (LOCALES as readonly string[]).includes(v)) current = v as Locale;
  } catch {
    // keep Arabic
  }
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(current === 'ar');
  return current;
}

/** True when the layout direction still has to be applied by a restart. */
export const needsRestart = () => I18nManager.isRTL !== (current === 'ar');

async function reload() {
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  try {
    const Updates = await import('expo-updates');
    await Updates.reloadAsync();
  } catch {
    Alert.alert(t('تم تغيير اللغة'), t('أغلق التطبيق وافتحه من جديد لتطبيق اللغة.'));
  }
}

/** Saves the language and restarts the app so texts and direction switch together. */
export async function setLocale(locale: Locale) {
  await AsyncStorage.setItem(KEY, locale);
  I18nManager.forceRTL(locale === 'ar');
  await reload();
}

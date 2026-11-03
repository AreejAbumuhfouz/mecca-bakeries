import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, StyleSheet } from 'react-native';
import { store } from './api';

/**
 * Two palettes with the same keys. `colors` and `ui` are updated in place when the theme
 * changes, so screens keep reading `colors.brown` / `ui.card` and simply re-render.
 * In dark mode the brown/white pair swaps: brown is the light text colour and "white"
 * is the card surface, so text on buttons stays readable in both.
 */
const LIGHT = {
  brown: '#3E2A1C',
  brown2: '#5A3E2B',
  gold: '#C8862A',
  goldLight: '#F7EAD0',
  cream: '#FBF7F0',
  line: '#E8DCC8',
  muted: '#7A6E62',
  white: '#FFFFFF',
  green: '#2E7D4F',
  greenBg: '#E3F2E8',
  red: '#B83A2E',
  redBg: '#F9E3E0',
  grayBg: '#EEEEEE',
  bar: '#FFFFFF',
};
const DARK: typeof LIGHT = {
  brown: '#F1E6D6',
  brown2: '#E0D2BF',
  gold: '#DC9A3C',
  goldLight: '#3D2C14',
  cream: '#15110D',
  line: '#3A2F25',
  muted: '#A89A8B',
  white: '#1E1813',
  green: '#86D9A1',
  greenBg: '#12301D',
  red: '#F4A097',
  redBg: '#3A1714',
  grayBg: '#2D251E',
  bar: '#0F0B08',
};

export type ThemeMode = 'light' | 'dark';
export const colors = { ...LIGHT };

const makeUi = () =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.cream },
    content: { padding: 16, paddingBottom: 32, gap: 12 },
    card: {
      backgroundColor: colors.white,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.line,
      padding: 16,
      gap: 8,
    },
    h1: { fontSize: 22, fontWeight: '700', color: colors.brown },
    h2: { fontSize: 17, fontWeight: '700', color: colors.brown },
    text: { fontSize: 15, color: colors.brown },
    muted: { fontSize: 13, color: colors.muted },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    between: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      backgroundColor: colors.white,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.brown,
    },
    error: {
      backgroundColor: colors.redBg,
      color: colors.red,
      padding: 10,
      borderRadius: 10,
      overflow: 'hidden',
      fontSize: 14,
    },
    notice: {
      backgroundColor: colors.greenBg,
      color: colors.green,
      padding: 10,
      borderRadius: 10,
      overflow: 'hidden',
      fontSize: 14,
    },
  });

export const ui = makeUi();

function apply(mode: ThemeMode) {
  Object.assign(colors, mode === 'dark' ? DARK : LIGHT);
  Object.assign(ui, makeUi());
}

const KEY = 'mb_theme';
const Ctx = createContext<{ mode: ThemeMode; toggle: () => void }>({
  mode: 'light',
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const m: ThemeMode = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
    apply(m);
    return m;
  });
  useEffect(() => {
    void store.get(KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark') {
        apply(saved);
        setMode(saved);
      }
    });
  }, []);
  const toggle = useCallback(() => {
    setMode((m) => {
      const next: ThemeMode = m === 'dark' ? 'light' : 'dark';
      apply(next);
      void store.set(KEY, next);
      return next;
    });
  }, []);
  return createElement(Ctx.Provider, { value: { mode, toggle } }, children);
}

/** Components that call this re-render when the theme changes. */
export const useTheme = () => useContext(Ctx);

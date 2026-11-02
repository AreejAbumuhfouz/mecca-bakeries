import { StyleSheet } from 'react-native';

export const colors = {
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
};

export const ui = StyleSheet.create({
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
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
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
});

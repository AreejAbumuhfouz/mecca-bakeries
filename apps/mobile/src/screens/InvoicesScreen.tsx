import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { filsToJodString, formatJod } from '@mecca/shared';
import { api, errorText, fetchBlob } from '../api';
import { Empty } from '../components';
import { colors, ui } from '../theme';
import { t } from '../i18n';

type Row = {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  total: number;
  balance: number;
  branchName: string | null;
};
type Detail = Row & {
  lines: {
    id: number;
    kind: 'sale' | 'return';
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  discount2Amount: number;
  paid: number;
};
type Balance = { balance: number; overdue: number; credit: number };
type Statement = {
  from: string;
  to: string;
  opening: number;
  closing: number;
  rows: {
    date: string;
    number: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
};

/** Restaurant: balance, invoices and the account statement. */
export function InvoicesScreen() {
  const [view, setView] = useState<'invoices' | 'statement'>('invoices');
  const [balance, setBalance] = useState<Balance | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([
      api<Balance>('/api/app/account/balance').then(setBalance),
      api<{ items: Row[] }>('/api/app/account/invoices?pageSize=50').then((r) => setRows(r.items)),
    ]).catch((err) => setError(errorText(err, t('تعذّر التحميل'))));
  }, []);
  useEffect(() => {
    if (view === 'statement' && !statement)
      void api<Statement>('/api/app/account/statement')
        .then(setStatement)
        .catch((err) => setError(errorText(err, t('تعذّر التحميل'))));
  }, [view, statement]);

  if (open)
    return (
      <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
        <Pressable onPress={() => setOpen(null)} style={ui.row}>
          <Ionicons name="arrow-forward" size={18} color={colors.muted} />
          <Text style={ui.muted}>{t('فواتيري')}</Text>
        </Pressable>
        <View style={ui.card}>
          <Text style={ui.h1}>{t('فاتورة {0}', open.number)}</Text>
          <Text style={ui.muted}>{t('{0} — الاستحقاق {1}', open.issueDate, open.dueDate)}</Text>
          {open.lines.map((l) => (
            <View key={l.id} style={ui.between}>
              <Text style={[ui.text, { flex: 1 }, l.kind === 'return' && { color: colors.red }]}>
                {l.kind === 'return' ? t('مرتجع: ') : ''}
                {l.description} × {l.quantity}
              </Text>
              <Text style={ui.text}>{filsToJodString(l.lineTotal)}</Text>
            </View>
          ))}
          {open.discount2Amount > 0 && (
            <View style={ui.between}>
              <Text style={ui.muted}>{t('خصم')}</Text>
              <Text style={ui.text}>− {filsToJodString(open.discount2Amount)}</Text>
            </View>
          )}
          <View
            style={[ui.between, { borderTopWidth: 1, borderColor: colors.line, paddingTop: 8 }]}
          >
            <Text style={ui.h2}>{t('المجموع')}</Text>
            <Text style={ui.h2}>{formatJod(open.total)}</Text>
          </View>
          <View style={ui.between}>
            <Text style={ui.muted}>{t('المدفوع')}</Text>
            <Text style={ui.text}>{formatJod(open.paid)}</Text>
          </View>
          <View style={ui.between}>
            <Text style={ui.muted}>{t('المتبقي')}</Text>
            <Text
              style={[
                ui.text,
                { fontWeight: '700', color: open.balance > 0 ? colors.red : colors.green },
              ]}
            >
              {formatJod(Math.max(0, open.balance))}
            </Text>
          </View>
        </View>
        {Platform.OS === 'web' && (
          <Pressable
            onPress={() => void openPdf(`/api/app/account/invoices/${open.id}/pdf`)}
            style={ui.row}
          >
            <Ionicons name="document-text-outline" size={18} color={colors.gold} />
            <Text style={{ color: colors.gold, fontWeight: '700' }}>{t('فتح PDF')}</Text>
          </Pressable>
        )}
      </ScrollView>
    );

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
      <Text style={ui.h1}>{t('فواتيري وحسابي')}</Text>
      {error ? <Text style={ui.error}>{error}</Text> : null}
      {balance && (
        <View style={[ui.card, { flexDirection: 'row', gap: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={ui.muted}>{t('الرصيد المستحق')}</Text>
            <Text style={[ui.h1, { color: colors.gold }]}>{formatJod(balance.balance)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ui.muted}>{t('منها متأخر')}</Text>
            <Text style={[ui.h2, { color: balance.overdue ? colors.red : colors.green }]}>
              {formatJod(balance.overdue)}
            </Text>
          </View>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(
          [
            ['invoices', t('الفواتير')],
            ['statement', t('كشف الحساب')],
          ] as const
        ).map(([k, label]) => (
          <Pressable
            key={k}
            onPress={() => setView(k)}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 12,
              alignItems: 'center',
              backgroundColor: view === k ? colors.brown : colors.white,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Text style={{ fontWeight: '700', color: view === k ? colors.white : colors.brown }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {view === 'invoices' &&
        (rows === null ? (
          <ActivityIndicator color={colors.gold} />
        ) : rows.length === 0 ? (
          <Empty>{t('لا توجد فواتير بعد')}</Empty>
        ) : (
          rows.map((r) => (
            <Pressable
              key={r.id}
              style={ui.card}
              onPress={() =>
                void api<Detail>(`/api/app/account/invoices/${r.id}`)
                  .then(setOpen)
                  .catch((err) => setError(errorText(err, t('تعذّر الفتح'))))
              }
            >
              <View style={ui.between}>
                <Text style={ui.h2}>{r.number}</Text>
                <Text style={ui.h2}>{formatJod(r.total)}</Text>
              </View>
              <View style={ui.between}>
                <Text style={ui.muted}>
                  {r.issueDate}
                  {r.branchName ? ` — ${r.branchName}` : ''}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: r.balance > 0 ? colors.red : colors.green,
                  }}
                >
                  {r.balance > 0 ? t('متبقي {0}', filsToJodString(r.balance)) : t('مدفوعة ✓')}
                </Text>
              </View>
            </Pressable>
          ))
        ))}

      {view === 'statement' &&
        (!statement ? (
          <ActivityIndicator color={colors.gold} />
        ) : (
          <View style={ui.card}>
            <Text style={ui.muted}>{t('من {0} إلى {1}', statement.from, statement.to)}</Text>
            <View style={ui.between}>
              <Text style={[ui.text, { fontWeight: '700' }]}>{t('رصيد سابق')}</Text>
              <Text style={ui.text}>{filsToJodString(statement.opening)}</Text>
            </View>
            {statement.rows.map((r, i) => (
              <View key={i} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 6 }}>
                <View style={ui.between}>
                  <Text style={ui.text}>{r.description}</Text>
                  <Text style={[ui.text, { color: r.credit ? colors.green : colors.brown }]}>
                    {r.credit ? `− ${filsToJodString(r.credit)}` : filsToJodString(r.debit)}
                  </Text>
                </View>
                <View style={ui.between}>
                  <Text style={ui.muted}>
                    {r.date} — {r.number}
                  </Text>
                  <Text style={ui.muted}>{t('الرصيد {0}', filsToJodString(r.balance))}</Text>
                </View>
              </View>
            ))}
            <View
              style={[ui.between, { borderTopWidth: 1, borderColor: colors.line, paddingTop: 8 }]}
            >
              <Text style={ui.h2}>{t('الرصيد الختامي')}</Text>
              <Text style={ui.h2}>{formatJod(statement.closing)}</Text>
            </View>
            {Platform.OS === 'web' && (
              <Pressable
                onPress={() => void openPdf('/api/app/account/statement/pdf')}
                style={ui.row}
              >
                <Ionicons name="document-text-outline" size={18} color={colors.gold} />
                <Text style={{ color: colors.gold, fontWeight: '700' }}>{t('فتح PDF')}</Text>
              </Pressable>
            )}
          </View>
        ))}
    </ScrollView>
  );
}

async function openPdf(path: string) {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  globalThis.open?.(url, '_blank');
}

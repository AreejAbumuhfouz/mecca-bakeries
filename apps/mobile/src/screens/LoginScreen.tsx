import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../auth';
import { errorText } from '../api';
import { Button } from '../components';
import { colors, ui } from '../theme';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../../assets/logo.png') as number;

export function LoginScreen() {
  const { requestCode, verifyCode } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setError('');
    setBusy(true);
    try {
      await requestCode(email.trim().toLowerCase());
      setStep('code');
    } catch (err) {
      setError(errorText(err, 'تعذّر إرسال الرمز'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError('');
    setBusy(true);
    try {
      await verifyCode(email.trim().toLowerCase(), code);
    } catch (err) {
      setError(err instanceof Error ? err.message : errorText(err, 'الرمز غير صحيح'));
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={ui.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14 }}
      >
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <Image source={logo} style={{ width: 150, height: 125 }} resizeMode="contain" />
          <Text style={[ui.h1, { marginTop: 8 }]}>مخابز مكة</Text>
          <Text style={ui.muted}>تطبيق طلبات المطاعم</Text>
        </View>

        {step === 'email' ? (
          <>
            <Text style={ui.h2}>البريد الإلكتروني</Text>
            <TextInput
              style={[ui.input, { textAlign: 'left' }]}
              value={email}
              onChangeText={setEmail}
              placeholder="name@gmail.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
            />
            {error ? <Text style={ui.error}>{error}</Text> : null}
            <Button
              title="إرسال رمز الدخول"
              onPress={() => void send()}
              busy={busy}
              disabled={!email.includes('@')}
            />
          </>
        ) : (
          <>
            <Text style={ui.muted}>أرسلنا رمزاً من 6 أرقام إلى {email}</Text>
            <TextInput
              style={[ui.input, { textAlign: 'center', fontSize: 24, letterSpacing: 8 }]}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              placeholder="••••••"
            />
            {error ? <Text style={ui.error}>{error}</Text> : null}
            <Button
              title="دخول"
              onPress={() => void verify()}
              busy={busy}
              disabled={code.length !== 6}
            />
            <Button
              title="تغيير البريد أو إعادة الإرسال"
              variant="outline"
              onPress={() => {
                setStep('email');
                setCode('');
                setError('');
              }}
            />
          </>
        )}
        <Text style={[ui.muted, { textAlign: 'center', marginTop: 8, color: colors.muted }]}>
          الحسابات يضيفها المخبز. للتسجيل تواصل مع مخابز مكة.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

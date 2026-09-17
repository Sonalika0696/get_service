import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, TextInput, KeyboardAvoidingView, Platform, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/auth/AuthProvider';

const CELLS = 6;
const RESEND_SECONDS = 30;

/**
 * OTP verification. Six single-digit cells backed by one hidden input —
 * the pattern from iOS and modern Android login flows: no per-cell focus
 * dance, no clipboard fights, fast paste-support.
 */
export default function Verify() {
  const theme = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const params = useLocalSearchParams<{ phone?: string; email?: string }>();
  const identifier = params.phone
    ? { phone: params.phone }
    : params.email
      ? { email: params.email }
      : null;

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const verify = async (raw: string) => {
    if (!identifier || raw.length !== CELLS) return;
    setBusy(true);
    try {
      await auth.verifyOtp({ ...identifier, code: raw });
      // AuthGate in _layout.tsx notices the sign-in and redirects into tabs.
    } catch (err) {
      const apiErr = err as { message?: string; status?: number };
      setCode('');
      inputRef.current?.focus();
      Alert.alert('Could not verify', apiErr?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!identifier || resendIn > 0) return;
    try {
      await auth.requestOtp(identifier);
      setResendIn(RESEND_SECONDS);
      Alert.alert('Sent', 'A new code is on the way.');
    } catch (err) {
      const apiErr = err as { message?: string };
      Alert.alert('Could not send code', apiErr?.message ?? 'Try again in a moment.');
    }
  };

  const cells = Array.from({ length: CELLS }, (_, i) => code[i] ?? '');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ paddingHorizontal: theme.screenPadding, paddingTop: theme.spacing.sm }}>
          <Button
            label="Back"
            variant="ghost"
            leftIcon={<ArrowLeft size={18} color={theme.colors.accent[700]} weight="bold" />}
            onPress={() => router.back()}
          />
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.screenPadding,
            paddingBottom: theme.spacing.xxxl,
            gap: theme.spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="display" weight="semibold">Enter the code</Text>
            <Text variant="body" tone="secondary">
              Six digits sent to {maskIdentifier(params.phone, params.email)}.
            </Text>
          </View>

          <Pressable onPress={() => inputRef.current?.focus()}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {cells.map((c, i) => (
                <Cell key={i} value={c} focused={i === code.length && !busy} />
              ))}
            </View>
          </Pressable>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(t) => {
              const next = t.replace(/\D/g, '').slice(0, CELLS);
              setCode(next);
              if (next.length === CELLS) verify(next);
            }}
            keyboardType="number-pad"
            autoFocus
            maxLength={CELLS}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
          />

          <Button
            label={busy ? 'Verifying' : 'Verify'}
            onPress={() => verify(code)}
            disabled={code.length !== CELLS || busy}
            loading={busy}
            fullWidth
          />

          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text variant="caption" tone="muted">
              Didn't get it?
            </Text>
            <Pressable disabled={resendIn > 0} onPress={resend}>
              <Text
                variant="body"
                weight="semibold"
                tone={resendIn > 0 ? 'muted' : 'accent'}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Cell({ value, focused }: { value: string; focused: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        aspectRatio: 0.85,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.bg.elevated,
        borderWidth: 1.5,
        borderColor: focused ? theme.colors.accent[700] : theme.colors.border.subtle,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="heading" weight="semibold" mono>
        {value || ' '}
      </Text>
    </View>
  );
}

function maskIdentifier(phone?: string, email?: string): string {
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    const tail = digits.slice(-4);
    return `+91 ••••• ${tail}`;
  }
  if (email) {
    const [name, domain] = email.split('@');
    const head = name.slice(0, 2);
    return `${head}•••@${domain}`;
  }
  return 'your account';
}

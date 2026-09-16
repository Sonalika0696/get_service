import React, { useState } from 'react';
import { View, ScrollView, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Phone, ArrowRight, ShieldCheck } from 'phosphor-react-native';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/auth/AuthProvider';

/**
 * Phone-first sign in. India-only country code hard-coded to +91 for the
 * v1 audience; internationalisation lands with F9's polish pass. The
 * "Continue" button starts the OTP flow: request + navigate to /verify.
 */
export default function SignIn() {
  const theme = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const [national, setNational] = useState('');
  const [busy, setBusy] = useState(false);

  const normalized = national.replace(/\D/g, '');
  const canContinue = normalized.length === 10;

  const submit = async () => {
    const phone = `+91${normalized}`;
    setBusy(true);
    try {
      await auth.requestOtp({ phone });
      router.push({ pathname: '/auth/verify', params: { phone } });
    } catch (err) {
      const apiErr = err as { status?: number; message?: string };
      // The backend returns 404 when no account exists for this phone. We
      // route to signup instead of showing an error — that's the intended
      // first-time flow.
      if (apiErr?.status === 404) {
        router.push({ pathname: '/auth/sign-up', params: { phone } });
      } else {
        Alert.alert('Could not send code', apiErr?.message ?? 'Try again in a moment.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.screenPadding,
            paddingBottom: theme.spacing.xxxl,
            paddingTop: theme.spacing.xl,
            gap: theme.spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.accent.tint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={28} color={theme.colors.accent[700]} weight="duotone" />
          </View>

          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="display" weight="semibold">Welcome</Text>
            <Text variant="body" tone="secondary">
              Sign in with your phone. We send a one-time code — no passwords.
            </Text>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="overline" weight="semibold" tone="muted">Phone</Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: theme.colors.bg.elevated,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.border.subtle,
                paddingHorizontal: 14,
              }}
            >
              <Phone size={20} color={theme.colors.ink[60]} weight="duotone" />
              <Text variant="body" weight="semibold" tone="secondary" mono>+91</Text>
              <TextInput
                value={national}
                onChangeText={(t) => setNational(t.replace(/\D/g, '').slice(0, 10))}
                placeholder="90000 00000"
                placeholderTextColor={theme.colors.ink[40]}
                keyboardType="number-pad"
                returnKeyType="done"
                autoFocus
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  fontFamily: theme.fontFamily.monoSemibold,
                  fontSize: theme.fontSize.body.size,
                  color: theme.colors.ink[100],
                }}
              />
            </View>
            <Text variant="caption" tone="muted">
              We never sell or share your number. It's the only thing we ever ask you to remember.
            </Text>
          </View>

          <Button
            label={busy ? 'Sending code' : 'Continue'}
            onPress={submit}
            disabled={!canContinue || busy}
            loading={busy}
            rightIcon={!busy ? <ArrowRight size={16} color="#fff" weight="bold" /> : undefined}
            fullWidth
          />

          {__DEV__ ? (
            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
              <View
                style={{
                  height: 1,
                  backgroundColor: theme.colors.border.subtle,
                  marginVertical: theme.spacing.xs,
                }}
              />
              <Text variant="caption" tone="muted" align="center">
                OTP delivery is stubbed in this build. Skip it for development.
              </Text>
              <Button
                label="Developer sign-in"
                variant="secondary"
                onPress={() => auth.devSignIn()}
                fullWidth
              />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

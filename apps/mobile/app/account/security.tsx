import React from 'react';
import { View, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, ShieldCheck, Phone, EnvelopeSimple, SignOut } from 'phosphor-react-native';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { SectionLabel } from '../../src/components/SectionLabel';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/auth/AuthProvider';

/**
 * Security screen. Residents authenticate with a phone OTP — there's no
 * password to change or reset, so this is informational plus the one real
 * action available: signing out of this device.
 */
export default function Security() {
  const theme = useTheme();
  const router = useRouter();
  const { me, signOut } = useAuth();

  const confirmSignOut = () => {
    Alert.alert(
      'Sign out?',
      'You will need your phone to sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
      ],
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
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
          gap: theme.spacing.lg,
        }}
      >
        <View>
          <Text variant="display" weight="semibold">Security</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            How your account is protected.
          </Text>
        </View>

        <Card style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accent.tint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={20} color={theme.colors.accent[700]} weight="duotone" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="body" weight="semibold">Passwordless sign-in</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              GateX doesn't use passwords. Every sign-in is verified with a one-time code sent to
              your phone, so there's nothing to remember or leak.
            </Text>
          </View>
        </Card>

        <View>
          <SectionLabel>Signed in as</SectionLabel>
          <Card padded={0}>
            <IdentityRow
              icon={<Phone size={18} color={theme.colors.accent[700]} weight="duotone" />}
              label="Phone"
              value={me?.phone ?? 'Not set'}
            />
            <IdentityRow
              icon={<EnvelopeSimple size={18} color={theme.colors.accent[700]} weight="duotone" />}
              label="Email"
              value={me?.email ?? 'Not set'}
              last
            />
          </Card>
        </View>

        <Button
          label="Sign out of this device"
          variant="danger"
          leftIcon={<SignOut size={18} color={theme.colors.ink.onAccent} weight="bold" />}
          onPress={confirmSignOut}
          fullWidth
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function IdentityRow({
  icon,
  label,
  value,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minHeight: 44,
        borderTopWidth: last ? 1 : 0,
        borderTopColor: theme.colors.border.subtle,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.accent.tint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <Text variant="body" tone="muted" style={{ flex: 1 }}>{label}</Text>
      <Text variant="body" weight="semibold">{value}</Text>
    </View>
  );
}

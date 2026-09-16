import React from 'react';
import { View, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { PaintBrushBroad, Gear, SignOut, User } from 'phosphor-react-native';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { SectionLabel } from '../../src/components/SectionLabel';
import { Button } from '../../src/components/Button';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/auth/AuthProvider';

const ROLE_LABELS: Record<string, string> = {
  OWNER_OCCUPIER: 'Owner, resident',
  OWNER_ABSENTEE: 'Owner, non-resident',
  TENANT: 'Tenant',
};

export default function ProfileScreen() {
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
    <Screen>
      <Text variant="display" weight="semibold">Profile</Text>

      <View
        style={{
          backgroundColor: theme.colors.bg.elevated,
          borderRadius: theme.radius.xl,
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
          borderWidth: 1,
          borderColor: theme.colors.border.subtle,
        }}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 999,
            backgroundColor: theme.colors.accent.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <User size={26} color={theme.colors.accent[700]} weight="duotone" />
        </View>
        <Text variant="heading" weight="semibold">{me?.name ?? 'You'}</Text>
        <View style={{ gap: 2 }}>
          {me?.phone ? (
            <Text variant="caption" tone="muted" mono>{me.phone}</Text>
          ) : null}
          {me?.email ? (
            <Text variant="caption" tone="muted">{me.email}</Text>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {me?.occupancyRole ? (
            <Chip label={ROLE_LABELS[me.occupancyRole] ?? me.occupancyRole} />
          ) : null}
          {me?.roleKinds?.map((r) => <Chip key={r} label={r} tone="accent" />)}
          {me?.kycTier ? <Chip label={`KYC · ${me.kycTier}`} /> : null}
        </View>
      </View>

      <View>
        <SectionLabel>Account</SectionLabel>
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label="Open design playground"
            variant="secondary"
            leftIcon={<PaintBrushBroad size={18} color={theme.colors.accent[700]} weight="duotone" />}
            onPress={() => router.push('/dev/ui')}
            fullWidth
          />
          <Button
            label="Settings"
            variant="ghost"
            leftIcon={<Gear size={18} color={theme.colors.accent[700]} weight="duotone" />}
            onPress={() => undefined}
            fullWidth
          />
          <Button
            label="Sign out"
            variant="ghost"
            leftIcon={<SignOut size={18} color={theme.colors.feedback.danger} weight="regular" />}
            onPress={confirmSignOut}
            fullWidth
          />
        </View>
      </View>
    </Screen>
  );
}

function Chip({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'accent' }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: tone === 'accent' ? theme.colors.accent.tint : theme.colors.bg.secondary,
        borderRadius: theme.radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <Text
        variant="caption"
        weight="semibold"
        tone={tone === 'accent' ? 'accent' : 'secondary'}
      >
        {label}
      </Text>
    </View>
  );
}

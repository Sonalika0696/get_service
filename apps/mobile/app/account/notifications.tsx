import React, { useState } from 'react';
import { View, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Bell, EnvelopeSimple, Receipt } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { useTheme } from '../../src/theme/ThemeProvider';
import { kv } from '../../src/lib/storage';

const KEYS = {
  push: 'gatex.notif.push',
  email: 'gatex.notif.email',
  billReminders: 'gatex.notif.billReminders',
} as const;

function readPref(key: string, fallback: boolean): boolean {
  try {
    const stored = kv.getString(key);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // Best-effort; fall back to the default below.
  }
  return fallback;
}

function writePref(key: string, value: boolean): void {
  try {
    kv.set(key, value ? '1' : '0');
  } catch {
    // Best-effort; the toggle still updates in-session state.
  }
}

/**
 * Local notification preferences. There's no push-token or email-digest
 * backend yet, so these persist to on-device storage only and take effect
 * the next time those features ship — but the toggles are fully functional
 * and remembered across app restarts.
 */
export default function Notifications() {
  const theme = useTheme();
  const router = useRouter();

  const [push, setPush] = useState(() => readPref(KEYS.push, true));
  const [email, setEmail] = useState(() => readPref(KEYS.email, true));
  const [billReminders, setBillReminders] = useState(() => readPref(KEYS.billReminders, true));

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
          <Text variant="display" weight="semibold">Notifications</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            Choose what GateX lets you know about.
          </Text>
        </View>

        <Card padded={0}>
          <ToggleRow
            icon={<Bell size={18} color={theme.colors.accent[700]} weight="duotone" />}
            title="Push notifications"
            subtitle="Approvals, request updates, notices"
            value={push}
            onValueChange={(v) => { setPush(v); writePref(KEYS.push, v); }}
          />
          <ToggleRow
            icon={<EnvelopeSimple size={18} color={theme.colors.accent[700]} weight="duotone" />}
            title="Email updates"
            subtitle="Monthly summaries and receipts"
            value={email}
            onValueChange={(v) => { setEmail(v); writePref(KEYS.email, v); }}
          />
          <ToggleRow
            icon={<Receipt size={18} color={theme.colors.accent[700]} weight="duotone" />}
            title="Bill reminders"
            subtitle="A nudge before your dues are due"
            value={billReminders}
            onValueChange={(v) => { setBillReminders(v); writePref(KEYS.billReminders, v); }}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function ToggleRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
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
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="semibold">{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted">{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.border.subtle, true: theme.colors.accent[700] }}
        thumbColor={theme.colors.bg.elevated}
        ios_backgroundColor={theme.colors.border.subtle}
      />
    </View>
  );
}

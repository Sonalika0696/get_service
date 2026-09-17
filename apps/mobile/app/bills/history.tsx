import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, ClockCounterClockwise } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { ListEmpty } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Statement history. Backed by the aggregate `GET /me/statement` — not yet
 * shipped (Phase 9 backend). Screen renders the empty state until the
 * endpoint lands; a full statement view drops in with no shell changes.
 */
export default function StatementHistory() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineBanner />

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
          <Text variant="display" weight="semibold">Statement</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            Every charge and every payment for your flat, exportable.
          </Text>
        </View>

        <ListEmpty
          Icon={ClockCounterClockwise}
          title="Statement lands with Phase 9 backend"
          body="Once GET /me/statement ships, this fills with a per-flat ledger and an export button."
        />
      </ScrollView>
    </SafeAreaView>
  );
}

import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, CalendarBlank } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { SectionLabel } from '../../src/components/SectionLabel';
import { EventRow } from '../../src/components/EventRow';
import { ListLoading, ListError, ListEmpty } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useEvents } from '../../src/hooks/useEvents';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Events browse. Reached from the home "Upcoming events" tile. Residents see
 * the per-flat charge and (on detail) the refund policy before opting in —
 * FRONTEND_PLAN §5.F8: "see the per-flat charge and refund policy before
 * opting in". Event creation is committee/web only, so there's no compose
 * affordance here.
 */
export default function EventsIndex() {
  const theme = useTheme();
  const router = useRouter();
  const query = useEvents();
  const events = query.data ?? [];

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
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text variant="display" weight="semibold">Events</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            Society events with a per-flat charge. See the refund policy before you commit.
          </Text>
        </View>

        <View>
          <SectionLabel>Upcoming</SectionLabel>

          {query.isLoading ? <ListLoading label="Loading events" /> : null}

          {query.isError ? (
            <ListError
              message={
                (query.error as { message?: string } | null)?.message ??
                'Events are unreachable right now.'
              }
              onRetry={() => query.refetch()}
            />
          ) : null}

          {query.isSuccess && events.length === 0 ? (
            <ListEmpty
              Icon={CalendarBlank}
              illustration="events"
              title="No events yet"
              body="When your committee schedules an event, it shows up here with the charge and refund policy."
            />
          ) : null}

          <View style={{ gap: theme.spacing.sm }}>
            {events.map((e) => (
              <EventRow key={e.id} event={e} onPress={() => router.push(`/events/${e.id}` as never)} />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

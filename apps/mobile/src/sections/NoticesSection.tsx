import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { PencilSimple, Megaphone, CalendarBlank } from '../icons/phosphor';
import { Text } from '../components/Text';
import { Fab } from '../components/Fab';
import { SectionLabel } from '../components/SectionLabel';
import { JobPostRow } from '../components/JobPostRow';
import { EventRow } from '../components/EventRow';
import { ListLoading, ListError, ListEmpty } from '../components/ListState';
import { OfflineBanner } from '../components/OfflineBanner';
import { useJobPosts } from '../hooks/useJobPosts';
import { useEvents } from '../hooks/useEvents';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The community feed tab. Two streams live here:
 *  A) admin-posted society events/activities (GET /events via useEvents) —
 *     residents show interest / participate on the event detail screen.
 *  B) resident hiring posts (GET /jobs via useJobPosts, filtered to
 *     kind === 'HIRING' — the old "seeking" concept is retired).
 */
export default function NoticesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const eventsQuery = useEvents();
  const events = eventsQuery.data ?? [];
  const postsQuery = useJobPosts();
  const posts = postsQuery.data ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingBottom: theme.spacing.hero + theme.spacing.md,
          paddingTop: theme.spacing.md,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text variant="display" weight="semibold">Community</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            Society events to join, and what your neighbours are hiring for.
          </Text>
        </View>

        <View>
          <SectionLabel>Happening in your society</SectionLabel>

          {eventsQuery.isLoading ? <ListLoading label="Loading events" /> : null}

          {eventsQuery.isError ? (
            <ListError
              message={
                (eventsQuery.error as { message?: string } | null)?.message ??
                'Events are unreachable. Check your connection and try again.'
              }
              onRetry={() => eventsQuery.refetch()}
            />
          ) : null}

          {eventsQuery.isSuccess && events.length === 0 ? (
            <ListEmpty
              Icon={CalendarBlank}
              title="Nothing scheduled"
              body="Your society's admin hasn't posted any events or activities yet."
            />
          ) : null}

          <View style={{ gap: theme.spacing.sm }}>
            {events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                onPress={() => router.push(`/events/${event.id}`)}
              />
            ))}
          </View>
        </View>

        <View>
          <SectionLabel>Neighbours are hiring</SectionLabel>

          {postsQuery.isLoading ? <ListLoading label="Loading posts" /> : null}

          {postsQuery.isError ? (
            <ListError
              message={
                (postsQuery.error as { message?: string } | null)?.message ??
                'The feed is unreachable. Check your connection and try again.'
              }
              onRetry={() => postsQuery.refetch()}
            />
          ) : null}

          {postsQuery.isSuccess && posts.length === 0 ? (
            <ListEmpty
              Icon={Megaphone}
              illustration="notices"
              title="Quiet in the community"
              body="Be the first — tap Post to share a job you're hiring for."
            />
          ) : null}

          <View style={{ gap: theme.spacing.sm }}>
            {posts.map((p) => (
              <JobPostRow key={p.id} post={p} onPress={() => router.push(`/notices/${p.id}`)} />
            ))}
          </View>
        </View>
      </ScrollView>
      <Fab
        label="Post"
        icon={<PencilSimple size={20} color={theme.colors.ink.onAccent} weight="bold" />}
        onPress={() => router.push('/notices/new')}
      />
    </SafeAreaView>
  );
}

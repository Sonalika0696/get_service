import React, { useMemo } from 'react';
import { View, SectionList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PencilSimple, Megaphone, CalendarBlank } from '../icons/phosphor';
import type { EventSummary, JobBlogPost } from '@sft/api-client';
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

/** One row in the merged SectionList. Real rows carry their data; a state
 * row stands in for that section's loading/error/empty presentation so each
 * feed keeps its own independent state exactly as before. */
type Row =
  | { kind: 'event'; event: EventSummary }
  | { kind: 'post'; post: JobBlogPost }
  | { kind: 'events-state' }
  | { kind: 'posts-state' };

/**
 * The community feed tab. Two streams live here:
 *  A) admin-posted society events/activities (GET /events via useEvents) —
 *     residents show interest / participate on the event detail screen.
 *  B) resident hiring posts (GET /jobs via useJobPosts, filtered to
 *     kind === 'HIRING' — the old "seeking" concept is retired).
 *
 * Virtualised via SectionList (two sections, one per feed) instead of a
 * ScrollView + two `.map()`s. Each section always carries at least one row —
 * either its real data or a single state-row standing in for loading/error/
 * empty — so per-section state renders exactly like the old inline ternary.
 * The second section's header carries an explicit marginTop (on top of
 * SectionLabel's own intrinsic marginTop) to recreate the old top-level
 * `gap` between the two feed blocks — deliberately not
 * SectionSeparatorComponent, whose "renders at top and bottom of each
 * section" semantics would also fire before the very first section and
 * double up against the header's own bottom margin. ItemSeparatorComponent
 * recreates the old rows-container gap within a feed. Sticky headers are
 * switched off — the original was a plain in-flow SectionLabel, not a
 * pinned one.
 */
export default function NoticesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const eventsQuery = useEvents();
  const events = eventsQuery.data ?? [];
  const postsQuery = useJobPosts();
  const posts = postsQuery.data ?? [];

  const sections = useMemo(
    () => [
      {
        key: 'events',
        title: t('notices.sectionLabel.events'),
        data:
          events.length > 0
            ? events.map((event): Row => ({ kind: 'event', event }))
            : [{ kind: 'events-state' } as const],
      },
      {
        key: 'posts',
        title: t('notices.sectionLabel.posts'),
        data:
          posts.length > 0
            ? posts.map((post): Row => ({ kind: 'post', post }))
            : [{ kind: 'posts-state' } as const],
      },
    ],
    [events, posts, t],
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <OfflineBanner />
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => {
          if (item.kind === 'event') return item.event.id;
          if (item.kind === 'post') return item.post.id;
          return `${item.kind}-${index}`;
        }}
        renderItem={({ item }) => {
          switch (item.kind) {
            case 'event':
              return (
                <EventRow event={item.event} onPress={() => router.push(`/events/${item.event.id}`)} />
              );
            case 'post':
              return (
                <JobPostRow post={item.post} onPress={() => router.push(`/notices/${item.post.id}`)} />
              );
            case 'events-state':
              return eventsQuery.isLoading ? (
                <ListLoading label={t('notices.loadingEvents')} />
              ) : eventsQuery.isError ? (
                <ListError
                  message={
                    (eventsQuery.error as { message?: string } | null)?.message ??
                    t('notices.errorFallbackEvents')
                  }
                  onRetry={() => eventsQuery.refetch()}
                />
              ) : eventsQuery.isSuccess && events.length === 0 ? (
                <ListEmpty
                  Icon={CalendarBlank}
                  title={t('notices.empty.eventsTitle')}
                  body={t('notices.empty.eventsBody')}
                />
              ) : null;
            case 'posts-state':
              return postsQuery.isLoading ? (
                <ListLoading label={t('notices.loadingPosts')} />
              ) : postsQuery.isError ? (
                <ListError
                  message={
                    (postsQuery.error as { message?: string } | null)?.message ??
                    t('notices.errorFallbackPosts')
                  }
                  onRetry={() => postsQuery.refetch()}
                />
              ) : postsQuery.isSuccess && posts.length === 0 ? (
                <ListEmpty
                  Icon={Megaphone}
                  illustration="notices"
                  title={t('notices.empty.postsTitle')}
                  body={t('notices.empty.postsBody')}
                />
              ) : null;
          }
        }}
        renderSectionHeader={({ section }) => {
          const isSample = section.key === 'events' ? eventsQuery.isSample : postsQuery.isSample;
          const trailing = isSample ? (
            <Text variant="caption" tone="muted">Sample data</Text>
          ) : undefined;
          return section.key === 'posts' ? (
            <View style={{ marginTop: theme.spacing.lg }}>
              <SectionLabel trailing={trailing}>{section.title}</SectionLabel>
            </View>
          ) : (
            <SectionLabel trailing={trailing}>{section.title}</SectionLabel>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ marginBottom: theme.spacing.lg }}>
            <Text variant="display" weight="semibold" accessibilityRole="header">{t('notices.title')}</Text>
            <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
              {t('notices.subtitle')}
            </Text>
          </View>
        }
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingBottom: theme.spacing.hero + theme.spacing.md,
          paddingTop: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        windowSize={11}
        removeClippedSubviews
      />
      <Fab
        label="Post"
        icon={<PencilSimple size={20} color={theme.colors.ink.onAccent} weight="bold" />}
        onPress={() => router.push('/notices/new')}
      />
    </SafeAreaView>
  );
}

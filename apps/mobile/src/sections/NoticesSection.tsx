import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { PencilSimple, Megaphone } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Fab } from '../components/Fab';
import { SectionLabel } from '../components/SectionLabel';
import { JobPostRow } from '../components/JobPostRow';
import { ListLoading, ListError, ListEmpty } from '../components/ListState';
import { OfflineBanner } from '../components/OfflineBanner';
import { useJobPosts } from '../hooks/useJobPosts';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The community feed tab. Wired to GET /jobs (the shipped job-blog module,
 * the closest surface to a notice board that has shipped). A dedicated
 * general-announcement endpoint doesn't exist yet on the backend; when it
 * does, this screen composes both streams under one section header.
 */
export default function NoticesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const query = useJobPosts();
  const posts = query.data ?? [];

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
            What your neighbours are hiring for, and what they're looking to do.
          </Text>
        </View>

        <View>
          <SectionLabel>Recent posts</SectionLabel>

          {query.isLoading ? <ListLoading label="Loading posts" /> : null}

          {query.isError ? (
            <ListError
              message={
                (query.error as { message?: string } | null)?.message ??
                'The feed is unreachable. Check your connection and try again.'
              }
              onRetry={() => query.refetch()}
            />
          ) : null}

          {query.isSuccess && posts.length === 0 ? (
            <ListEmpty
              Icon={Megaphone}
              illustration="notices"
              title="Quiet in the community"
              body="Be the first: post a job you're hiring for, or one you're looking to take on."
              action={
                <Button
                  label="Write a post"
                  variant="secondary"
                  onPress={() => router.push('/notices/new')}
                />
              }
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

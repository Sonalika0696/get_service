import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { PencilSimple, Megaphone } from 'phosphor-react-native';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { SectionLabel } from '../../src/components/SectionLabel';
import { JobPostRow } from '../../src/components/JobPostRow';
import { ListLoading, ListError, ListEmpty } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useJobPosts } from '../../src/hooks/useJobPosts';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * The community feed tab. Wired to GET /jobs (the shipped job-blog module,
 * the closest surface to a notice board that has shipped). A dedicated
 * general-announcement endpoint doesn't exist yet on the backend; when it
 * does, this screen composes both streams under one section header.
 */
export default function NoticesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const query = useJobPosts();
  const posts = query.data ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingBottom: insets.bottom + theme.spacing.xxl,
          paddingTop: theme.spacing.md,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text variant="display" weight="semibold">Community</Text>
            <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
              What your neighbours are hiring for, and what they're looking to do.
            </Text>
          </View>
          <Button
            label="Post"
            variant="primary"
            leftIcon={<PencilSimple size={16} color="#fff" weight="bold" />}
            onPress={() => router.push('/notices/new')}
          />
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
    </SafeAreaView>
  );
}

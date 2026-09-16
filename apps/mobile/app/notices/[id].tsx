import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Briefcase, MagnifyingGlass, SealCheck, CalendarBlank } from 'phosphor-react-native';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ListLoading, ListError } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useJobPost } from '../../src/hooks/useJobPosts';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function NoticeDetail() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useJobPost(id);
  const post = query.data;

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
        {query.isLoading ? <ListLoading label="Loading post" /> : null}
        {query.isError ? (
          <ListError
            message={(query.error as { message?: string } | null)?.message ?? 'Could not load this post.'}
            onRetry={() => query.refetch()}
          />
        ) : null}

        {post ? <PostBody post={post} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PostBody({ post }: { post: NonNullable<ReturnType<typeof useJobPost>['data']> }) {
  const theme = useTheme();
  const isHiring = post.kind === 'HIRING';
  const Icon = isHiring ? Briefcase : MagnifyingGlass;
  const expires = new Date(post.expiresAt);

  return (
    <>
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: theme.radius.lg,
            backgroundColor: isHiring ? theme.colors.feedback.infoTint : theme.colors.accent.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            size={28}
            color={isHiring ? theme.colors.feedback.info : theme.colors.accent[700]}
            weight="duotone"
          />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="overline" weight="semibold" tone="muted">
            {isHiring ? 'Hiring' : 'Seeking'}
          </Text>
          {isHiring && post.companyEmailVerifiedAt ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <SealCheck size={14} color={theme.colors.feedback.info} weight="fill" />
              <Text variant="caption" weight="semibold" tone="secondary">Company email verified</Text>
            </View>
          ) : null}
        </View>

        <Text variant="display" weight="semibold">{post.title}</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <CalendarBlank size={14} color={theme.colors.ink[60]} weight="duotone" />
          <Text variant="caption" tone="muted">
            Expires {expires.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      </View>

      <Card>
        <Text variant="body">{post.body}</Text>
      </Card>

      {isHiring && post.companyEmail ? (
        <View>
          <Text variant="caption" tone="muted" weight="semibold">Reply to</Text>
          <Text variant="body" tone="secondary" mono>{post.companyEmail}</Text>
        </View>
      ) : null}
    </>
  );
}

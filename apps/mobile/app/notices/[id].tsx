import React from 'react';
import { View, ScrollView, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Briefcase, SealCheck, CalendarBlank, ArrowSquareOut } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ListLoading, ListError } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useJobPost } from '../../src/hooks/useJobPosts';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Matches the trailing "Apply: <url>" line the compose screen appends to a
 * post's body when the poster attaches an apply link. Kept in sync with the
 * same pattern in app/notices/new.tsx and src/components/JobPostRow.tsx. */
const APPLY_LINK_PATTERN = /\n\nApply:\s*(\S+)\s*$/;
const URL_LIKE = /^https?:\/\/[^\s]+\.[^\s]+$/i;

function splitApplyLink(body: string): { text: string; url: string | null } {
  const match = body.match(APPLY_LINK_PATTERN);
  if (!match) return { text: body, url: null };
  const url = match[1];
  return { text: body.slice(0, match.index).trimEnd(), url: URL_LIKE.test(url) ? url : null };
}

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
  const expires = new Date(post.expiresAt);
  const { text: bodyText, url: applyUrl } = splitApplyLink(post.body);

  const openApplyLink = () => {
    if (!applyUrl) return;
    Linking.openURL(applyUrl).catch(() => {
      Alert.alert('Could not open link', 'That apply link looks invalid.');
    });
  };

  return (
    <>
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.feedback.infoTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Briefcase size={28} color={theme.colors.feedback.info} weight="duotone" />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="overline" weight="semibold" tone="muted">
            Hiring
          </Text>
          {post.companyEmailVerifiedAt ? (
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
        <Text variant="body">{bodyText}</Text>
      </Card>

      {applyUrl ? (
        <Button
          label="Apply"
          onPress={openApplyLink}
          rightIcon={<ArrowSquareOut size={18} color={theme.colors.ink.onAccent} weight="bold" />}
          fullWidth
        />
      ) : null}

      {post.companyEmail ? (
        <View>
          <Text variant="caption" tone="muted" weight="semibold">Reply to</Text>
          <Text variant="body" tone="secondary" mono>{post.companyEmail}</Text>
        </View>
      ) : null}
    </>
  );
}

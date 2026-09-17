import React from 'react';
import { View, Pressable } from 'react-native';
import { Briefcase, SealCheck, CaretRight, LinkSimple } from '../icons/phosphor';
import type { JobBlogPost } from '@sft/api-client';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/** Matches the trailing "Apply: <url>" line the compose screen appends to a
 * post's body when the poster attaches an apply link. Kept in sync with the
 * same pattern in app/notices/new.tsx and app/notices/[id].tsx. */
const APPLY_LINK_PATTERN = /\n\nApply:\s*(\S+)\s*$/;

function hasApplyLink(body: string): boolean {
  return APPLY_LINK_PATTERN.test(body);
}

function previewBody(body: string): string {
  return body.replace(APPLY_LINK_PATTERN, '').trim();
}

/**
 * A community feed row. The Community tab only carries HIRING posts (the
 * SEEKING kind is retired), so every row wears the briefcase and, once the
 * company-email round-trip lands, a "verified employer" mark.
 */
export function JobPostRow({
  post,
  onPress,
}: {
  post: JobBlogPost;
  onPress: () => void;
}) {
  const theme = useTheme();
  const applyLinkAttached = hasApplyLink(post.body);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.xl,
        padding: theme.spacing.md,
        opacity: pressed ? 0.94 : 1,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        flexDirection: 'row',
        gap: theme.spacing.sm,
        alignItems: 'flex-start',
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.feedback.infoTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Briefcase size={22} color={theme.colors.feedback.info} weight="duotone" />
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="overline" weight="semibold" tone="muted">
            Hiring
          </Text>
          {post.companyEmailVerifiedAt ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <SealCheck size={12} color={theme.colors.feedback.info} weight="fill" />
              <Text variant="caption" weight="semibold" tone="secondary">Verified</Text>
            </View>
          ) : null}
        </View>
        <Text variant="body" weight="semibold" numberOfLines={2}>
          {post.title}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={2}>
          {previewBody(post.body)}
        </Text>
        {applyLinkAttached ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <LinkSimple size={12} color={theme.colors.accent[700]} weight="bold" />
            <Text variant="caption" weight="semibold" tone="accent">Apply link attached</Text>
          </View>
        ) : null}
      </View>

      <CaretRight size={18} color={theme.colors.ink[40]} weight="bold" />
    </Pressable>
  );
}

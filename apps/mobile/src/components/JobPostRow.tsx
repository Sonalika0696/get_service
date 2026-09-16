import React from 'react';
import { View, Pressable } from 'react-native';
import { Briefcase, MagnifyingGlass, SealCheck, CaretRight } from 'phosphor-react-native';
import type { JobBlogPost } from '@sft/api-client';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A community feed row. HIRING posts wear a briefcase and a "verified employer"
 * mark once the company-email round-trip lands; SEEKING posts get a search
 * glass and skip the verification step (nobody to impersonate).
 */
export function JobPostRow({
  post,
  onPress,
}: {
  post: JobBlogPost;
  onPress: () => void;
}) {
  const theme = useTheme();
  const isHiring = post.kind === 'HIRING';
  const Icon = isHiring ? Briefcase : MagnifyingGlass;

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
          backgroundColor: isHiring ? theme.colors.feedback.infoTint : theme.colors.accent.tint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon
          size={22}
          color={isHiring ? theme.colors.feedback.info : theme.colors.accent[700]}
          weight="duotone"
        />
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="overline" weight="semibold" tone="muted">
            {isHiring ? 'Hiring' : 'Seeking'}
          </Text>
          {isHiring && post.companyEmailVerifiedAt ? (
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
          {post.body}
        </Text>
      </View>

      <CaretRight size={18} color={theme.colors.ink[40]} weight="bold" />
    </Pressable>
  );
}

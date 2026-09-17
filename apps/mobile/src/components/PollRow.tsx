import React from 'react';
import { View, Pressable } from 'react-native';
import { CaretRight, CheckCircle, Clock, PencilSimple } from '../icons/phosphor';
import type { ResidentPollDetail } from '@sft/api-client';
import { Text } from './Text';
import { StatusPill } from './StatusPill';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A resident-poll row. Two visual jobs to do: convey status at a glance
 * (chip), and convey momentum toward the threshold (progress bar). Progress
 * uses the vendor-confirmed minimum when it exists, otherwise the resident's
 * proposedMinimum — matching how the backend picks the fire trigger.
 */
export function PollRow({
  poll,
  onPress,
  onEdit,
}: {
  poll: ResidentPollDetail;
  onPress: () => void;
  /** When set, an inline "Edit" control appears (used in the "Mine" segment). */
  onEdit?: () => void;
}) {
  const theme = useTheme();
  const threshold = poll.vendorConfirmedMinimum ?? poll.minCommitments ?? 0;
  const progress = threshold > 0 ? Math.min(1, poll.commitmentCount / threshold) : 0;
  const reached = threshold > 0 && poll.commitmentCount >= threshold;
  const countLabel = reached
    ? 'Threshold met'
    : threshold > 0
      ? `of ${threshold} joined`
      : 'neighbours joined';

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
        gap: theme.spacing.sm,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 4, paddingRight: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {poll.category ? (
              <Text variant="overline" weight="semibold" tone="accent">
                {poll.category}
              </Text>
            ) : null}
            <StatusPill status={poll.status} />
          </View>
          <Text variant="body" weight="semibold" numberOfLines={2}>{poll.title}</Text>
        </View>

        <View style={{ alignItems: 'center', paddingHorizontal: theme.spacing.xs, minWidth: 56 }}>
          <Text
            variant="display"
            weight="semibold"
            mono
            tone="primary"
            style={reached ? { color: theme.colors.feedback.success } : undefined}
          >
            {poll.commitmentCount}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            {reached ? <CheckCircle size={11} color={theme.colors.feedback.success} weight="fill" /> : null}
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {countLabel}
            </Text>
          </View>
        </View>

        <CaretRight size={18} color={theme.colors.ink[40]} weight="bold" style={{ marginTop: 6 }} />
      </View>

      <View style={{ gap: 6 }}>
        <View
          style={{
            height: 6,
            backgroundColor: theme.colors.bg.secondary,
            borderRadius: 999,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              backgroundColor: reached ? theme.colors.feedback.success : theme.colors.accent[700],
            }}
          />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Clock size={12} color={theme.colors.ink[60]} weight="duotone" />
          <Text variant="caption" tone="muted">
            {formatCloses(poll.closesAt)}
          </Text>
          {onEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit this request"
              onPress={onEdit}
              hitSlop={8}
              style={({ pressed }) => ({
                marginLeft: 'auto',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.accent.tint,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <PencilSimple size={12} color={theme.colors.accent[700]} weight="bold" />
              <Text variant="caption" weight="semibold" tone="accent">Edit</Text>
            </Pressable>
          ) : null}
        </View>

        {poll.hasJoined ? (
          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: theme.colors.feedback.successTint,
              borderRadius: theme.radius.pill,
              paddingHorizontal: 10,
              paddingVertical: 3,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <CheckCircle size={12} color={theme.colors.feedback.success} weight="fill" />
            <Text variant="caption" weight="semibold" tone="secondary">You joined</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function formatCloses(iso: string): string {
  const closes = new Date(iso);
  const now = new Date();
  const diffMs = closes.getTime() - now.getTime();
  if (diffMs <= 0) return 'Closed';
  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  if (days >= 1) return `Closes in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(diffMs / (3600 * 1000));
  if (hours >= 1) return `Closes in ${hours}h`;
  const mins = Math.floor(diffMs / (60 * 1000));
  return `Closes in ${mins}m`;
}

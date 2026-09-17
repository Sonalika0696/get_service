import React from 'react';
import { View, Pressable } from 'react-native';
import { CalendarBlank, Users, CaretRight, CheckCircle, Hourglass } from '../icons/phosphor';
import type { EventSummary, EventOptIn } from '@sft/api-client';
import { Text } from './Text';
import { Money } from './Money';
import { useTheme } from '../theme/ThemeProvider';

export function EventRow({
  event,
  optIn,
  onPress,
}: {
  event: EventSummary;
  optIn?: EventOptIn;
  onPress: () => void;
}) {
  const theme = useTheme();
  const starts = new Date(event.startsAt);
  const full = event.status === 'FULL' || (event.capacity !== null && event.optedInCount >= event.capacity);

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
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accent.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CalendarBlank size={24} color={theme.colors.accent[700]} weight="duotone" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body" weight="semibold" numberOfLines={2}>{event.title}</Text>
          <Text variant="caption" tone="muted">
            {starts.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
            {' · '}
            {starts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Money minor={event.perFlatMinor} currency={event.currency} variant="body" weight="semibold" />
          <Text variant="caption" tone="muted">per flat</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
          <Users size={14} color={theme.colors.ink[60]} weight="duotone" />
          <Text variant="caption" tone="secondary" mono>
            {event.optedInCount}{event.capacity !== null ? ` / ${event.capacity}` : ''} in
          </Text>
          {full ? (
            <Text variant="caption" weight="semibold" tone="danger" style={{ marginLeft: 4 }}>Full</Text>
          ) : null}
        </View>
        <OptInTag optIn={optIn} />
        <CaretRight size={14} color={theme.colors.ink[40]} weight="bold" />
      </View>
    </Pressable>
  );
}

function OptInTag({ optIn }: { optIn?: EventOptIn }) {
  const theme = useTheme();
  if (!optIn || optIn.state === 'NONE') return null;
  if (optIn.state === 'WAITLISTED') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        <Hourglass size={12} color={theme.colors.feedback.warning} weight="fill" />
        <Text variant="caption" weight="semibold" tone="secondary">Waitlist #{optIn.position}</Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <CheckCircle size={12} color={theme.colors.feedback.success} weight="fill" />
      <Text variant="caption" weight="semibold" tone="secondary">
        {optIn.paid ? 'Going' : 'Opted in'}
      </Text>
    </View>
  );
}

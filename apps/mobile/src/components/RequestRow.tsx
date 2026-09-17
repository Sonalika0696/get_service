import React from 'react';
import { View, Pressable } from 'react-native';
import { Users, CaretRight } from '../icons/phosphor';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A joinable request row. Progress bar reflects participants / threshold —
 * the single most important visual on this screen because it's what
 * converts curiosity into a tap.
 */
export function RequestRow({
  category,
  title,
  participants,
  thresholdAt,
  onPress,
}: {
  category: string;
  title: string;
  participants: number;
  thresholdAt: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const progress = Math.min(1, participants / thresholdAt);
  const reached = participants >= thresholdAt;

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
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: theme.spacing.sm }}>
          <Text variant="overline" weight="semibold" tone="accent">
            {category}
          </Text>
          <Text variant="body" weight="semibold" style={{ marginTop: 4 }} numberOfLines={2}>
            {title}
          </Text>
        </View>
        <CaretRight size={18} color={theme.colors.ink[40]} weight="bold" />
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Users size={14} color={theme.colors.ink[60]} weight="duotone" />
          <Text variant="caption" tone="secondary">
            {participants} of {thresholdAt} joined
            {reached ? '. Threshold reached.' : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

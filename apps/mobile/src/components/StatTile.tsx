import React from 'react';
import { Pressable, View } from 'react-native';
import type { IconProps } from 'phosphor-react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

type Tone = 'accent' | 'ink' | 'success' | 'warning' | 'info';

/**
 * Compact tile with an icon, a big value, and a caption. This is the
 * "07 Members / 03 Pets" tile from the reference, retuned for the metrics
 * a resident actually cares about (open requests, upcoming events, etc.).
 */
export function StatTile({
  Icon,
  value,
  label,
  tone = 'accent',
  onPress,
}: {
  Icon: React.ComponentType<IconProps>;
  value: string;
  label: string;
  tone?: Tone;
  onPress?: () => void;
}) {
  const theme = useTheme();

  const toneToBg: Record<Tone, string> = {
    accent: theme.colors.accent.tint,
    ink: theme.colors.bg.secondary,
    success: theme.colors.feedback.successTint,
    warning: theme.colors.feedback.warningTint,
    info: theme.colors.feedback.infoTint,
  };
  const toneToIcon: Record<Tone, string> = {
    accent: theme.colors.accent[700],
    ink: theme.colors.ink[80],
    success: theme.colors.feedback.success,
    warning: theme.colors.feedback.warning,
    info: theme.colors.feedback.info,
  };

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.xl,
        padding: theme.spacing.md,
        gap: theme.spacing.sm,
        opacity: pressed ? 0.92 : 1,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: toneToBg[tone],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={22} color={toneToIcon[tone]} weight="duotone" />
      </View>
      <View>
        <Text variant="heading" weight="semibold" mono>
          {value}
        </Text>
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

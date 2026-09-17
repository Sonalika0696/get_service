import React from 'react';
import { Pressable } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Small selectable chip used for category filters. Active state uses the
 * accent primary (700) rather than a tinted background so the selection is
 * visible at a glance in a horizontal scroller.
 */
export function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: theme.radius.pill,
        backgroundColor: active ? theme.colors.accent[700] : theme.colors.bg.elevated,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent[700] : theme.colors.border.subtle,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Text variant="caption" weight="semibold" tone={active ? 'onAccent' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

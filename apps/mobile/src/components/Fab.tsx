import React from 'react';
import { Pressable } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Floating action button, pinned bottom-right. Sits inside a section's
 * SafeAreaView so it floats above the scroll content and just above the tab
 * bar. Extended (icon + label) by default for clarity.
 */
export function Fab({
  label,
  icon,
  onPress,
}: {
  label?: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        right: theme.screenPadding,
        bottom: theme.spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: theme.colors.accent[700],
        borderRadius: theme.radius.pill,
        paddingHorizontal: label ? 18 : 16,
        height: 52,
        justifyContent: 'center',
        ...theme.shadows.lg.native,
        opacity: pressed ? 0.92 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {icon}
      {label ? (
        <Text variant="body" weight="semibold" tone="onAccent">
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

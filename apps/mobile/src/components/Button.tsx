import React, { useCallback } from 'react';
import {
  Pressable,
  View,
  ActivityIndicator,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  style?: ViewStyle;
};

/**
 * The one button primitive. Tap target is always at least 44pt tall — the
 * mobile-app-ui-design skill's accessibility rule, and non-negotiable for
 * the resident population.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  style,
  disabled,
  ...rest
}: ButtonProps) {
  const theme = useTheme();

  const heights: Record<Size, number> = { sm: 40, md: 48, lg: 56 };
  const paddings: Record<Size, number> = { sm: 14, md: 18, lg: 22 };

  const getStyle = useCallback(
    (pressed: boolean): ViewStyle => {
      const base: ViewStyle = {
        minHeight: heights[size],
        paddingHorizontal: paddings[size],
        borderRadius: theme.radius.pill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: fullWidth ? 'stretch' : 'flex-start',
        opacity: disabled ? 0.5 : pressed ? 0.9 : 1,
        transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
      };
      switch (variant) {
        case 'primary':
          return {
            ...base,
            backgroundColor: theme.colors.accent[700],
            ...theme.shadows.sm.native,
          };
        case 'secondary':
          return {
            ...base,
            backgroundColor: theme.colors.accent.tint,
            borderWidth: 1,
            borderColor: 'rgba(15, 118, 110, 0.16)',
          };
        case 'ghost':
          return { ...base, backgroundColor: 'transparent' };
        case 'danger':
          return {
            ...base,
            backgroundColor: theme.colors.feedback.danger,
            ...theme.shadows.sm.native,
          };
      }
    },
    [variant, size, fullWidth, disabled, theme],
  );

  const textTone = variant === 'primary' || variant === 'danger' ? 'onAccent' : 'accent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled ?? loading, busy: loading }}
      hitSlop={8}
      disabled={disabled || loading}
      {...rest}
      style={({ pressed }) => [getStyle(pressed), style]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : theme.colors.accent[700]} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {leftIcon}
          <Text variant="body" weight="semibold" tone={textTone}>
            {label}
          </Text>
          {rightIcon}
        </View>
      )}
    </Pressable>
  );
}

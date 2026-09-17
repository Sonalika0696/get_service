import React, { useCallback, useEffect, useRef } from 'react';
import {
  Pressable,
  View,
  ActivityIndicator,
  Animated,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import { Check } from 'phosphor-react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Success state: the button turns green and a checkmark springs in. */
  success?: boolean;
  successLabel?: string;
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
  success = false,
  successLabel = 'Done',
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

  const checkScale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (success) {
      checkScale.setValue(0);
      Animated.spring(checkScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 5,
        tension: 160,
      }).start();
    } else {
      checkScale.setValue(0);
    }
  }, [success, checkScale]);

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
        opacity: disabled && !success ? 0.5 : pressed ? 0.9 : 1,
        transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
      };
      if (success) {
        return { ...base, backgroundColor: theme.colors.feedback.success, ...theme.shadows.sm.native };
      }
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
    [variant, size, fullWidth, disabled, success, theme],
  );

  const textTone = success || variant === 'primary' || variant === 'danger' ? 'onAccent' : 'accent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled ?? loading, busy: loading }}
      hitSlop={8}
      disabled={disabled || loading || success}
      {...rest}
      style={({ pressed }) => [getStyle(pressed), style]}
    >
      {success ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Animated.View style={{ transform: [{ scale: checkScale }] }}>
            <Check size={20} color={theme.colors.ink.onAccent} weight="bold" />
          </Animated.View>
          <Text variant="body" weight="semibold" tone="onAccent">
            {successLabel}
          </Text>
        </View>
      ) : loading ? (
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

import React from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Elevation = 'flat' | 'sm' | 'md' | 'lg';
type Surface = 'elevated' | 'secondary' | 'accent' | 'ink';

export type CardProps = ViewProps & {
  elevation?: Elevation;
  surface?: Surface;
  radius?: 'md' | 'lg' | 'xl' | 'xxl' | 'xxxl';
  padded?: boolean | number;
  style?: ViewStyle;
};

/**
 * Base card surface. Default: elevated white on the warm base, xl radius,
 * md shadow, 20px interior padding. Every other card in the app extends this
 * one — no bespoke `View` with a stray backgroundColor allowed.
 */
export function Card({
  elevation = 'md',
  surface = 'elevated',
  radius = 'xl',
  padded = true,
  style,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();

  const bg =
    surface === 'elevated' ? theme.colors.bg.elevated
    : surface === 'secondary' ? theme.colors.bg.secondary
    : surface === 'accent' ? theme.colors.accent[700]
    : theme.colors.bg.inverse;

  const shadow = elevation === 'flat' ? theme.shadows.none.native : theme.shadows[elevation].native;
  const paddingValue = padded === false ? 0 : typeof padded === 'number' ? padded : theme.spacing.lg;

  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: bg,
          borderRadius: theme.radius[radius],
          padding: paddingValue,
        },
        shadow,
        style,
      ]}
    >
      {children}
    </View>
  );
}

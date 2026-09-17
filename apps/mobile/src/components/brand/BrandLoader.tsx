import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Logo } from './Logo';
import { Text } from '../Text';
import { useTheme } from '../../theme/ThemeProvider';

export type BrandLoaderProps = {
  /** Overall lockup height in px; glyph and text scale to match. Defaults to 56 (loading-hero size). */
  height?: number;
};

/**
 * Loading lockup: the large "GateX" wordmark whose blue "X" flips upside-down
 * on a continuous loop to signal work in progress. Same visual language as the
 * static Wordmark, just animated — used on the boot/auth splash.
 */
export function BrandLoader({ height = 56 }: BrandLoaderProps): React.JSX.Element {
  const { colors, spacing } = useTheme();
  const flip = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(flip, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [flip]);

  // Flip about the horizontal axis (top-over-bottom), a full turn per cycle.
  const rotateX = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const textStyle = { fontSize: height * 0.62, lineHeight: height * 0.74 };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Logo size={height} />
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text variant="heading" weight="semibold" style={textStyle} tone="primary">
          Gate
        </Text>
        <Animated.Text
          style={{
            fontFamily: 'Sora-SemiBold',
            color: colors.accent[600],
            includeFontPadding: false,
            transform: [{ perspective: 400 }, { rotateX }],
            ...textStyle,
          }}
        >
          X
        </Animated.Text>
      </View>
    </View>
  );
}

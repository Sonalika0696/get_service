import React from 'react';
import { View } from 'react-native';
import { Logo } from './Logo';
import { Text } from '../Text';
import { useTheme } from '../../theme/ThemeProvider';

export type WordmarkProps = {
  /** Overall lockup height in px; the glyph and text scale to match. Defaults to 28. */
  height?: number;
  /**
   * 'default' renders "Gate" in ink primary and "X" in the accent colour.
   * 'onAccent' renders a flat white lockup for use on coloured headers.
   */
  tone?: 'default' | 'onAccent';
};

/**
 * "GateX" logo + text lockup. Self-contained — drop it into a header or
 * splash screen without any extra layout wrapper.
 */
export function Wordmark({ height = 28, tone = 'default' }: WordmarkProps): React.JSX.Element {
  const { spacing } = useTheme();
  const textStyle = { fontSize: height * 0.62, lineHeight: height * 0.74 };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Logo size={height} tone={tone} />
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text
          variant="heading"
          weight="semibold"
          style={textStyle}
          tone={tone === 'onAccent' ? 'onAccent' : 'primary'}
        >
          Gate
        </Text>
        <Text
          variant="heading"
          weight="semibold"
          style={textStyle}
          tone={tone === 'onAccent' ? 'onAccent' : 'accent'}
        >
          X
        </Text>
      </View>
    </View>
  );
}

import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Variant = 'display' | 'heading' | 'body' | 'caption' | 'overline';
type Tone = 'primary' | 'secondary' | 'muted' | 'accent' | 'onAccent' | 'danger';

export type TextProps = RNTextProps & {
  variant?: Variant;
  weight?: 'regular' | 'semibold';
  tone?: Tone;
  mono?: boolean;
  align?: TextStyle['textAlign'];
};

/**
 * The one text primitive. Screens never call RN's `Text` directly — this
 * one binds every allowed size, weight and colour and refuses anything else.
 */
export function Text({
  variant = 'body',
  weight = 'regular',
  tone = 'primary',
  mono = false,
  align,
  style,
  ...rest
}: TextProps) {
  const { fontSize, fontFamily, colors } = useTheme();
  const size = fontSize[variant];

  const family = mono
    ? weight === 'semibold' ? fontFamily.monoSemibold : fontFamily.mono
    : weight === 'semibold' ? fontFamily.sansSemibold : fontFamily.sans;

  const color = resolveTone(tone, colors);

  return (
    <RNText
      allowFontScaling
      {...rest}
      style={[
        {
          fontFamily: family,
          fontSize: size.size,
          lineHeight: size.lineHeight,
          letterSpacing: size.letterSpacing,
          color,
          textAlign: align,
          textTransform: variant === 'overline' ? 'uppercase' : undefined,
        },
        style,
      ]}
    />
  );
}

function resolveTone(
  tone: Tone,
  colors: ReturnType<typeof useTheme>['colors'],
): string {
  switch (tone) {
    case 'primary': return colors.ink[100];
    case 'secondary': return colors.ink[80];
    case 'muted': return colors.ink[60];
    case 'accent': return colors.accent[700];
    case 'onAccent': return colors.ink.onAccent;
    case 'danger': return colors.feedback.danger;
  }
}

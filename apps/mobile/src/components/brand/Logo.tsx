import React, { useId } from 'react';
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';

export type LogoProps = {
  /** Pixel size of the square glyph. Defaults to 32. */
  size?: number;
  /** Draw the glyph inside a rounded-square tile background. */
  rounded?: boolean;
  /**
   * 'default' paints the gate with the accent gradient; 'onAccent' paints a
   * flat white glyph for use on coloured headers/hero surfaces.
   */
  tone?: 'default' | 'onAccent';
};

/**
 * Abstract "gate" mark — two rounded uprights joined by an arch, reading as
 * both a portal/gateway and a stylised "G". Pure vector, themeable, crisp
 * from icon sizes (24px) up to hero sizes (96px+).
 */
export function Logo({ size = 32, rounded = false, tone = 'default' }: LogoProps): React.JSX.Element {
  const { colors, radius } = useTheme();
  // Unique per-instance id so multiple Logos on one screen never collide on
  // a shared <LinearGradient> id (react-native-svg ids are effectively
  // global on some platforms).
  const gradientId = `gatexLogoGradient-${useId()}`;

  // Optional theme keys (violet accent2 / hero) may not exist yet — guard
  // with a safe cast + fallback so this compiles whether or not they do.
  const ext = colors as unknown as {
    accent2?: { 600?: string; 800?: string };
  };
  const gradientTop = colors.accent[600];
  const gradientBottom = ext.accent2?.[600] ?? ext.accent2?.[800] ?? colors.accent[800];

  const glyphFill = tone === 'onAccent' ? '#FFFFFF' : `url(#${gradientId})`;
  const tileFill = colors.accent.tint;
  const tileRadius = rounded ? Math.max(4, size * (radius.lg / 32)) : 0;

  // Glyph is authored in a 24x24 box; scale it into the requested size (and
  // inset it a little when drawn on a tile background).
  const inset = rounded ? size * 0.14 : 0;
  const glyphBox = size - inset * 2;
  const scale = glyphBox / 24;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={gradientTop} />
          <Stop offset="1" stopColor={gradientBottom} />
        </LinearGradient>
      </Defs>

      {rounded ? <Rect x={0} y={0} width={size} height={size} rx={tileRadius} fill={tileFill} /> : null}

      <G translateX={inset} translateY={inset} scale={scale}>
        {/* Left upright */}
        <Rect x={5} y={8} width={3.4} height={13} rx={1.7} fill={glyphFill} />
        {/* Right upright */}
        <Rect x={15.6} y={8} width={3.4} height={13} rx={1.7} fill={glyphFill} />
        {/* Arch joining the uprights, echoing a gateway / stylised "G" */}
        <Path
          d="M5 9 C5 3.4 19 3.4 19 9"
          stroke={glyphFill}
          strokeWidth={3.4}
          strokeLinecap="round"
          fill="none"
        />
        {/* Threshold */}
        <Rect x={4} y={19.4} width={16} height={2.2} rx={1.1} fill={glyphFill} opacity={0.55} />
      </G>
    </Svg>
  );
}

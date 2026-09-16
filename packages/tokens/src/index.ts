export { colors } from './colors';
export type { ColorTokens } from './colors';

export { spacing, screenPadding } from './spacing';
export type { SpacingTokens } from './spacing';

export { fontFamily, fontWeight, fontSize } from './typography';
export type { FontFamilyTokens, FontSizeTokens } from './typography';

export { radius } from './radius';
export type { RadiusTokens } from './radius';

export { shadows } from './shadows';
export type { ShadowTokens } from './shadows';

export { duration, easing } from './motion';
export type { DurationTokens, EasingTokens } from './motion';

import { colors } from './colors';
import { spacing, screenPadding } from './spacing';
import { fontFamily, fontWeight, fontSize } from './typography';
import { radius } from './radius';
import { shadows } from './shadows';
import { duration, easing } from './motion';

/**
 * The full token bundle. Consumers should destructure what they need
 * rather than passing this object around, but it exists for theme
 * providers that want a single source.
 */
export const tokens = {
  colors,
  spacing,
  screenPadding,
  fontFamily,
  fontWeight,
  fontSize,
  radius,
  shadows,
  duration,
  easing,
} as const;

export type Tokens = typeof tokens;

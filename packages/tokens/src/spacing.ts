/**
 * Spacing tokens on an 8-point grid (with a 4pt half-step for tight interior
 * padding). Every layout value in the app must resolve to one of these.
 */

export const spacing = {
  none: 0,
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
  hero: 80,
  section: 96,
} as const;

/**
 * Screen-edge inset. Locked to 20px: 16 reads cramped on a 6.7" display,
 * 24 loses too much content width at 375px baseline.
 */
export const screenPadding = 20;

export type SpacingTokens = typeof spacing;

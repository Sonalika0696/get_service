/**
 * Corner radius tokens. The app leans on rounded-2xl (20) as the default
 * card shape — matches the reference IA and reads warm without feeling toy.
 */

export const radius = {
  none: 0,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 28,
  pill: 999,
} as const;

export type RadiusTokens = typeof radius;

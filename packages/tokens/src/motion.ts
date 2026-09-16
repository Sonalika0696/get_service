/**
 * Motion tokens. Durations and easings for the app's interaction feel.
 * Peak-end rule: entrance and success transitions get the softest ease,
 * everything else stays snappy so the app feels responsive.
 */

export const duration = {
  instant: 80,
  fast: 160,
  base: 240,
  slow: 360,
  hero: 520,
} as const;

export const easing = {
  standard: [0.2, 0.0, 0.0, 1.0] as const,
  entrance: [0.16, 1.0, 0.3, 1.0] as const,
  exit: [0.4, 0.0, 1.0, 1.0] as const,
} as const;

export type DurationTokens = typeof duration;
export type EasingTokens = typeof easing;

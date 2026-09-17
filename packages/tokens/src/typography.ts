/**
 * Typography tokens. One family (Sora, a geometric grotesk), a monospace
 * variant (JetBrains Mono) for numeric columns and hashes. Four sizes, two
 * weights — the ceiling described in the mobile-app-ui-design skill.
 */

export const fontFamily = {
  sans: 'Sora',
  sansSemibold: 'Sora-SemiBold',
  mono: 'JetBrainsMono',
  monoSemibold: 'JetBrainsMono-SemiBold',
} as const;

export const fontWeight = {
  regular: '400',
  semibold: '600',
} as const;

/**
 * Size scale. `lineHeight` is absolute pixels, not a multiplier, to keep
 * rhythm predictable across native and web.
 */
export const fontSize = {
  display: { size: 32, lineHeight: 38, letterSpacing: -0.4 },
  heading: { size: 22, lineHeight: 28, letterSpacing: -0.2 },
  body: { size: 16, lineHeight: 24, letterSpacing: 0 },
  caption: { size: 13, lineHeight: 18, letterSpacing: 0.1 },
  // Overline sits on top of caption metrics; used for uppercase section labels.
  overline: { size: 12, lineHeight: 16, letterSpacing: 1.2 },
} as const;

export type FontFamilyTokens = typeof fontFamily;
export type FontSizeTokens = typeof fontSize;

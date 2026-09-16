/**
 * Colour tokens.
 * Warm-trust palette: off-white base, deep charcoal ink, deep teal accent.
 * Referenced by both clients. The mobile theme provider and the web
 * Tailwind config are the only permitted readers.
 */

export const colors = {
  bg: {
    primary: '#FBF8F4',
    secondary: '#F5F1EA',
    elevated: '#FFFFFF',
    inverse: '#14181A',
  },

  ink: {
    100: '#14181A',
    80: '#2C3235',
    60: '#5C6469',
    40: '#8B9198',
    20: '#C7CBCE',
    onAccent: '#FFFFFF',
  },

  accent: {
    50: '#F0FDFA',
    100: '#CCFBF1',
    200: '#99F6E4',
    300: '#5EEAD4',
    400: '#2DD4BF',
    500: '#14B8A6',
    600: '#0D9488',
    700: '#0F766E',
    800: '#115E59',
    900: '#134E4A',
    tint: 'rgba(15, 118, 110, 0.06)',
  },

  feedback: {
    success: '#16A34A',
    successTint: 'rgba(22, 163, 74, 0.08)',
    warning: '#B45309',
    warningTint: 'rgba(180, 83, 9, 0.08)',
    danger: '#B91C1C',
    dangerTint: 'rgba(185, 28, 28, 0.08)',
    info: '#0369A1',
    infoTint: 'rgba(3, 105, 161, 0.08)',
  },

  border: {
    subtle: 'rgba(20, 24, 26, 0.06)',
    divider: 'rgba(20, 24, 26, 0.10)',
    focus: '#0F766E',
  },

  overlay: {
    scrim: 'rgba(20, 24, 26, 0.32)',
    glassLight: 'rgba(255, 255, 255, 0.72)',
  },
} as const;

export type ColorTokens = typeof colors;

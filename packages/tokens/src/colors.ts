/**
 * Colour tokens.
 * MyGate/ADDA-inspired palette: vibrant indigo-blue primary, a violet
 * secondary, and a crimson/maroon "amount due" hero, on a warm-cool
 * off-white base (light) or a deep slate base (dark).
 *
 * Referenced by both clients. The mobile theme provider and the web
 * Tailwind config are the only permitted readers.
 *
 * `lightColors` and `darkColors` share an identical key shape — every
 * screen reads through `useTheme().colors.*`, so neither variant may add
 * or drop a key the other doesn't also have. `colors` (default) stays
 * equal to `lightColors` so any existing direct importer keeps compiling.
 *
 * Deliberately typed against the `ColorTokens` interface below rather than
 * inferred with `as const`: two `as const` palettes with different hex
 * literals produce two structurally-unrelated literal types, which breaks
 * the single `Theme` type both `lightTheme` and `darkTheme` need to share.
 */

export interface ColorTokens {
  bg: {
    primary: string;
    secondary: string;
    elevated: string;
    inverse: string;
  };
  ink: {
    100: string;
    80: string;
    60: string;
    40: string;
    20: string;
    onAccent: string;
  };
  accent: {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
    tint: string;
  };
  accent2: {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
    tint: string;
  };
  hero: {
    dueBg: string;
    dueBgTo: string;
    dueOn: string;
  };
  feedback: {
    success: string;
    successTint: string;
    warning: string;
    warningTint: string;
    danger: string;
    dangerTint: string;
    info: string;
    infoTint: string;
  };
  border: {
    subtle: string;
    divider: string;
    focus: string;
  };
  overlay: {
    scrim: string;
    glassLight: string;
  };
}

export const lightColors: ColorTokens = {
  bg: {
    primary: '#F7F7FB',
    secondary: '#EFEFF6',
    elevated: '#FFFFFF',
    inverse: '#14161C',
  },

  ink: {
    100: '#14161C',
    80: '#2C2F3A',
    60: '#5B5F6E',
    40: '#8A8EA0',
    20: '#C9CBD6',
    onAccent: '#FFFFFF',
  },

  accent: {
    50: '#F0F2FF',
    100: '#DBE1FF',
    200: '#BDC7FF',
    300: '#99A8FF',
    400: '#7A8EFF',
    500: '#6179FF',
    600: '#4763FF',
    700: '#3352FF',
    800: '#1334EC',
    900: '#1D31A5',
    tint: 'rgba(51, 82, 255, 0.06)',
  },

  accent2: {
    50: '#F5F2FF',
    100: '#EAE1FF',
    200: '#D1BFFF',
    300: '#B393FF',
    400: '#9A72FF',
    500: '#8B60FF',
    600: '#8258FF',
    700: '#7C5CFF',
    800: '#6A47E0',
    900: '#54339E',
    tint: 'rgba(124, 92, 255, 0.06)',
  },

  hero: {
    dueBg: '#B0264A',
    dueBgTo: '#8E1E3C',
    dueOn: '#FFFFFF',
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
    subtle: 'rgba(20, 22, 28, 0.06)',
    divider: 'rgba(20, 22, 28, 0.10)',
    focus: '#3352FF',
  },

  overlay: {
    scrim: 'rgba(20, 22, 28, 0.32)',
    glassLight: 'rgba(255, 255, 255, 0.72)',
  },
};

/**
 * Dark theme: a black / red / white scheme (reference-driven). True-black,
 * neutral (non-blue) surfaces; white → neutral-grey ink with no blue cast; a
 * vivid red lead accent with a warm-orange complement for gradients. The
 * light theme is intentionally left as-is.
 */
export const darkColors: ColorTokens = {
  bg: {
    primary: '#0A0A0B',    // near-true black
    secondary: '#141416',  // subtle lift, neutral
    elevated: '#1B1B1E',   // card surface, no blue cast
    inverse: '#F7F7FB',
  },

  ink: {
    100: '#FAFAFA',
    80: '#D4D4D8',   // neutral greys (were blue-tinted)
    60: '#9B9BA3',
    40: '#6C6C74',
    20: '#3A3A3F',
    onAccent: '#FFFFFF',
  },

  accent: {
    // Red scale. Low indices are deep red-blacks for tinted fills; 700 is the
    // lead action colour (buttons, active tab), 600 the brighter highlight
    // (e.g. the boot loader "X").
    50: '#2A0D0A',
    100: '#3E1611',
    200: '#5E211A',
    300: '#8A2E23',
    400: '#B83A2B',
    500: '#DC4030',
    600: '#FF5A47',
    700: '#F5402C',
    800: '#E23A28',
    900: '#B32C1F',
    tint: 'rgba(245, 64, 44, 0.14)',
  },

  accent2: {
    // Warm-orange complement — pairs with the red for the logo/hero gradients
    // so the whole scheme stays in the black/red/white/amber family.
    50: '#2A1608',
    100: '#3E210E',
    200: '#5E3316',
    300: '#8A4A1F',
    400: '#B85F27',
    500: '#DC722E',
    600: '#FF8A4D',
    700: '#FF9E68',
    800: '#E27B44',
    900: '#B35F33',
    tint: 'rgba(255, 138, 77, 0.12)',
  },

  hero: {
    // "Amount due" hero — a deep red that stays distinct from the brighter
    // action-red so the card still reads as its own thing.
    dueBg: '#8E2118',
    dueBgTo: '#5E140E',
    dueOn: '#FFFFFF',
  },

  feedback: {
    success: '#22C55E',
    successTint: 'rgba(34, 197, 94, 0.16)',
    warning: '#F59E0B',
    warningTint: 'rgba(245, 158, 11, 0.16)',
    danger: '#EF4444',
    dangerTint: 'rgba(239, 68, 68, 0.16)',
    info: '#C4C4CC',
    infoTint: 'rgba(196, 196, 204, 0.14)',
  },

  border: {
    subtle: 'rgba(255, 255, 255, 0.08)',
    divider: 'rgba(255, 255, 255, 0.14)',
    focus: '#F5402C',
  },

  overlay: {
    scrim: 'rgba(0, 0, 0, 0.60)',
    glassLight: 'rgba(20, 20, 22, 0.72)',
  },
};

/** Back-compat default export; equals the light palette. */
export const colors: ColorTokens = lightColors;

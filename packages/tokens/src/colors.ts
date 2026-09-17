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

export const darkColors: ColorTokens = {
  bg: {
    primary: '#0E1016',
    secondary: '#171A22',
    elevated: '#1E222C',
    inverse: '#F7F7FB',
  },

  ink: {
    100: '#F5F6FA',
    80: '#C9CCDA',
    60: '#9498AC',
    40: '#686C82',
    20: '#3A3D4D',
    onAccent: '#FFFFFF',
  },

  accent: {
    50: '#141B3D',
    100: '#1B2555',
    200: '#253274',
    300: '#2E419E',
    400: '#002AFF',
    500: '#294CFF',
    600: '#526EFF',
    700: '#7088FF',
    800: '#4262FF',
    900: '#1F44F9',
    tint: 'rgba(112, 136, 255, 0.12)',
  },

  accent2: {
    50: '#1C1640',
    100: '#271C5C',
    200: '#372A86',
    300: '#4B3BB8',
    400: '#6249E8',
    500: '#7D63FF',
    600: '#8B72FF',
    700: '#9880FF',
    800: '#7259E0',
    900: '#5B44B0',
    tint: 'rgba(152, 128, 255, 0.12)',
  },

  hero: {
    dueBg: '#B0264A',
    dueBgTo: '#8E1E3C',
    dueOn: '#FFFFFF',
  },

  feedback: {
    success: '#22C55E',
    successTint: 'rgba(34, 197, 94, 0.16)',
    warning: '#F59E0B',
    warningTint: 'rgba(245, 158, 11, 0.16)',
    danger: '#EF4444',
    dangerTint: 'rgba(239, 68, 68, 0.16)',
    info: '#38BDF8',
    infoTint: 'rgba(56, 189, 248, 0.16)',
  },

  border: {
    subtle: 'rgba(255, 255, 255, 0.08)',
    divider: 'rgba(255, 255, 255, 0.14)',
    focus: '#7088FF',
  },

  overlay: {
    scrim: 'rgba(0, 0, 0, 0.55)',
    glassLight: 'rgba(30, 34, 44, 0.72)',
  },
};

/** Back-compat default export; equals the light palette. */
export const colors: ColorTokens = lightColors;

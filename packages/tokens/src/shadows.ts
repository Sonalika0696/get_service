/**
 * Shadow tokens. `shadows` is warm-tinted (matches the ink family, not pure
 * black) so elevated surfaces feel like paper on a warm base, not like
 * plastic on a fluorescent one — used by the light theme.
 *
 * `darkShadows` uses deeper, blacker shadows at higher opacity so elevated
 * surfaces still read as "lifted" against a dark base, where a faint warm
 * shadow would simply disappear.
 *
 * Each shadow is expressed as native RN style props; `web` supplies the
 * matching CSS box-shadow string for the Next.js client.
 *
 * Typed against the `ShadowSpec`/`ShadowTokens` interfaces below rather
 * than inferred with `as const`: two `as const` groups with different
 * numeric/string literals produce structurally-unrelated types, which
 * breaks the single `Theme` type both `lightTheme` and `darkTheme` need
 * to share.
 */

interface ShadowSpec {
  native: {
    shadowColor: string;
    shadowOpacity: number;
    shadowRadius: number;
    shadowOffset: { width: number; height: number };
    elevation: number;
  };
  web: string;
}

export interface ShadowTokens {
  none: ShadowSpec;
  sm: ShadowSpec;
  md: ShadowSpec;
  lg: ShadowSpec;
}

export const shadows: ShadowTokens = {
  none: {
    native: {
      shadowColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    web: 'none',
  },
  sm: {
    native: {
      shadowColor: '#14181A',
      shadowOpacity: 0.05,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    web: '0 1px 2px rgba(20, 24, 26, 0.05)',
  },
  md: {
    native: {
      shadowColor: '#14181A',
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    web: '0 4px 12px rgba(20, 24, 26, 0.06)',
  },
  lg: {
    native: {
      shadowColor: '#14181A',
      shadowOpacity: 0.08,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 6,
    },
    web: '0 12px 24px rgba(20, 24, 26, 0.08)',
  },
};

export const darkShadows: ShadowTokens = {
  none: {
    native: {
      shadowColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    web: 'none',
  },
  sm: {
    native: {
      shadowColor: '#000000',
      shadowOpacity: 0.4,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    web: '0 2px 4px rgba(0, 0, 0, 0.40)',
  },
  md: {
    native: {
      shadowColor: '#000000',
      shadowOpacity: 0.45,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 5,
    },
    web: '0 6px 16px rgba(0, 0, 0, 0.45)',
  },
  lg: {
    native: {
      shadowColor: '#000000',
      shadowOpacity: 0.55,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 14 },
      elevation: 9,
    },
    web: '0 14px 28px rgba(0, 0, 0, 0.55)',
  },
};

/**
 * Shadow tokens. Warm-tinted (matches the ink family, not pure black) so
 * elevated surfaces feel like paper on a warm base, not like plastic on
 * a fluorescent one.
 *
 * Each shadow is expressed as native RN style props; `web` supplies the
 * matching CSS box-shadow string for the Next.js client.
 */

export const shadows = {
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
} as const;

export type ShadowTokens = typeof shadows;

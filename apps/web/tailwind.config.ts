import type { Config } from 'tailwindcss';
import { radius, fontSize, spacing, shadows } from '@sft/tokens';

/**
 * Colour tokens are wired through CSS variables (see app/globals.css),
 * mirroring @sft/tokens' lightColors/darkColors so web and mobile share one
 * source of truth for colour, radius, type scale and spacing. The variables
 * flip between light and dark values off the `dark` class on <html>.
 *
 * Solid tokens use the `rgb(var(--x) / <alpha-value>)` form so Tailwind's
 * alpha modifiers (`bg-accent-700/[0.08]`, `bg-accent-700/40`, ...) keep
 * working; tokens that are already rgba in the source palette are passed
 * through as plain `var(--x)` values instead.
 *
 * Nothing in this app should hardcode a hex value that also lives in a
 * token.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'rgb(var(--bg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--bg-secondary) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
          inverse: 'rgb(var(--bg-inverse) / <alpha-value>)',
        },
        ink: {
          100: 'rgb(var(--ink-100) / <alpha-value>)',
          80: 'rgb(var(--ink-80) / <alpha-value>)',
          60: 'rgb(var(--ink-60) / <alpha-value>)',
          40: 'rgb(var(--ink-40) / <alpha-value>)',
          20: 'rgb(var(--ink-20) / <alpha-value>)',
          onAccent: 'rgb(var(--ink-on-accent) / <alpha-value>)',
        },
        accent: {
          50: 'rgb(var(--accent-50) / <alpha-value>)',
          100: 'rgb(var(--accent-100) / <alpha-value>)',
          200: 'rgb(var(--accent-200) / <alpha-value>)',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
          700: 'rgb(var(--accent-700) / <alpha-value>)',
          800: 'rgb(var(--accent-800) / <alpha-value>)',
          900: 'rgb(var(--accent-900) / <alpha-value>)',
          tint: 'var(--accent-tint)',
        },
        feedback: {
          success: 'rgb(var(--feedback-success) / <alpha-value>)',
          successTint: 'var(--feedback-success-tint)',
          warning: 'rgb(var(--feedback-warning) / <alpha-value>)',
          warningTint: 'var(--feedback-warning-tint)',
          danger: 'rgb(var(--feedback-danger) / <alpha-value>)',
          dangerTint: 'var(--feedback-danger-tint)',
          info: 'rgb(var(--feedback-info) / <alpha-value>)',
          infoTint: 'var(--feedback-info-tint)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          divider: 'var(--border-divider)',
          focus: 'rgb(var(--border-focus) / <alpha-value>)',
        },
        overlay: {
          scrim: 'var(--overlay-scrim)',
          glassLight: 'var(--overlay-glass-light)',
        },
      },
      borderRadius: {
        xs: `${radius.xs}px`,
        sm: `${radius.sm}px`,
        md: `${radius.md}px`,
        lg: `${radius.lg}px`,
        xl: `${radius.xl}px`,
        '2xl': `${radius.xxl}px`,
        '3xl': `${radius.xxxl}px`,
        pill: `${radius.pill}px`,
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: [`${fontSize.display.size}px`, { lineHeight: `${fontSize.display.lineHeight}px`, letterSpacing: `${fontSize.display.letterSpacing}px` }],
        heading: [`${fontSize.heading.size}px`, { lineHeight: `${fontSize.heading.lineHeight}px`, letterSpacing: `${fontSize.heading.letterSpacing}px` }],
        body: [`${fontSize.body.size}px`, { lineHeight: `${fontSize.body.lineHeight}px` }],
        caption: [`${fontSize.caption.size}px`, { lineHeight: `${fontSize.caption.lineHeight}px`, letterSpacing: `${fontSize.caption.letterSpacing}px` }],
        overline: [`${fontSize.overline.size}px`, { lineHeight: `${fontSize.overline.lineHeight}px`, letterSpacing: `${fontSize.overline.letterSpacing}px` }],
      },
      spacing: {
        xxs: `${spacing.xxs}px`,
        xs: `${spacing.xs}px`,
        sm: `${spacing.sm}px`,
        md: `${spacing.md}px`,
        lg: `${spacing.lg}px`,
        xl: `${spacing.xl}px`,
        '2xl': `${spacing.xxl}px`,
        '3xl': `${spacing.xxxl}px`,
      },
      boxShadow: {
        sm: shadows.sm.web,
        md: shadows.md.web,
        lg: shadows.lg.web,
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 240ms ease-out',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
};

export default config;

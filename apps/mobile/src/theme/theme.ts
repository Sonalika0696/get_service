import { tokens } from '@sft/tokens';
// `@sft/tokens`'s package.json only maps the bare specifier to `src/index.ts`
// (no subpath `exports`), so pull the light/dark-only exports straight from
// their source files by relative path rather than adding a new export to
// the shared index (out of scope for this change).
import { darkColors } from '../../../../packages/tokens/src/colors';
import { darkShadows } from '../../../../packages/tokens/src/shadows';

/**
 * Concrete theme objects handed to the ThemeProvider. `lightTheme` keeps the
 * token bundle's own (light) colours/shadows; `darkTheme` overrides just
 * those two fields with the dark variants so spacing, radius, typography
 * and motion stay identical across themes.
 */
export const lightTheme = {
  ...tokens,
  colors: tokens.colors,
  shadows: tokens.shadows,
  name: 'light' as const,
};

export const darkTheme = {
  ...tokens,
  colors: darkColors,
  shadows: darkShadows,
  name: 'dark' as const,
};

// `Omit<..., 'name'> & { name: 'light' | 'dark' }` rather than a plain
// `typeof lightTheme`: the latter pins `name` to the literal `'light'`,
// which `darkTheme` (whose `name` is `'dark'`) could never satisfy.
export type Theme = Omit<typeof lightTheme, 'name'> & { name: 'light' | 'dark' };

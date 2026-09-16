import { tokens } from '@sft/tokens';

/**
 * Concrete theme object handed to the ThemeProvider. Right now there is one
 * theme (light); a dark variant is a future addition and would live here.
 */
export const lightTheme = {
  ...tokens,
  name: 'light' as const,
};

export type Theme = typeof lightTheme;

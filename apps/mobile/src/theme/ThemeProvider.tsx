import React, { createContext, useContext, useMemo } from 'react';
import { lightTheme, type Theme } from './theme';

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => lightTheme, []);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { kv } from '../lib/storage';
import { lightTheme, darkTheme, type Theme } from './theme';

export type ColorSchemePref = 'light' | 'dark' | 'system';

const THEME_PREF_KEY = 'gatex.theme.pref';

type ThemeControls = {
  scheme: ColorSchemePref;
  resolved: 'light' | 'dark';
  setScheme(s: ColorSchemePref): void;
  toggle(): void;
};

function readStoredPref(): ColorSchemePref {
  try {
    const stored = kv.getString(THEME_PREF_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Best-effort; fall back to the default below.
  }
  return 'system';
}

function writeStoredPref(pref: ColorSchemePref): void {
  try {
    kv.set(THEME_PREF_KEY, pref);
  } catch {
    // Best-effort; keep the preference in React state only.
  }
}

const ThemeContext = createContext<Theme>(lightTheme);
const ThemeControlsContext = createContext<ThemeControls>({
  scheme: 'system',
  resolved: 'light',
  setScheme: () => undefined,
  toggle: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [scheme, setSchemeState] = useState<ColorSchemePref>(() => readStoredPref());

  const resolved: 'light' | 'dark' = useMemo(() => {
    if (scheme === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
    return scheme;
  }, [scheme, systemScheme]);

  const setScheme = useCallback((next: ColorSchemePref) => {
    setSchemeState(next);
    writeStoredPref(next);
  }, []);

  const toggle = useCallback(() => {
    setScheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setScheme]);

  const theme = useMemo(() => (resolved === 'dark' ? darkTheme : lightTheme), [resolved]);
  const controls = useMemo<ThemeControls>(
    () => ({ scheme, resolved, setScheme, toggle }),
    [scheme, resolved, setScheme, toggle],
  );

  return (
    <ThemeContext.Provider value={theme}>
      <ThemeControlsContext.Provider value={controls}>{children}</ThemeControlsContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function useThemeControls(): ThemeControls {
  return useContext(ThemeControlsContext);
}

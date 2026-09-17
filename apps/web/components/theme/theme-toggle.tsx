'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getCurrentTheme, toggleTheme, type Theme } from '@/lib/theme';

/** Icon-only light/dark toggle. Reflects the theme applied by the no-flash
 * script in app/layout.tsx and updates live without a reload. */
export function ThemeToggle({ className }: { className?: string }) {
  // Real theme is only knowable client-side (it depends on localStorage /
  // matchMedia); render the light icon on the server and sync on mount to
  // avoid a hydration mismatch flicker.
  const [theme, setThemeState] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setThemeState(getCurrentTheme());
    setMounted(true);
  }, []);

  function onClick() {
    setThemeState(toggleTheme());
  }

  const isDark = mounted && theme === 'dark';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-border-divider bg-bg-elevated text-ink-60 transition-colors hover:bg-bg-secondary hover:text-ink-80',
        className,
      )}
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

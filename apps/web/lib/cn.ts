import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's built-in font-size scale (text-sm,
 * text-lg, ...). Our type scale is custom-named (text-display, text-heading,
 * text-body, text-caption, text-overline — see tailwind.config.ts). Without
 * this extension, twMerge can't tell those apart from a text-COLOR utility
 * (text-ink-100, text-accent-700, ...), classifies them into the same
 * conflict group, and silently DROPS the size class whenever both appear in
 * one cn() call (e.g. `cn('text-display ...', 'text-ink-100')` rendered as
 * plain body text with no font-size class at all). Registering the scale
 * here fixes every call site at once instead of patching them one by one.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': ['text-display', 'text-heading', 'text-body', 'text-caption', 'text-overline'],
    },
  },
});

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

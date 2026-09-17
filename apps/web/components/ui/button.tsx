'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

// Soft, low-contrast fills: the primary action reads as a calm accent tint
// with accent-coloured text (not a punchy solid), matching the muted theme.
// A hairline border and a whisper of shadow keep it feeling clickable.
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent-700/[0.12] text-accent-800 border border-accent-700/20 shadow-[0_1px_2px_rgb(var(--accent-700)/0.10)] hover:bg-accent-700/[0.18] hover:-translate-y-px hover:shadow-[0_4px_12px_rgb(var(--accent-700)/0.16)] active:translate-y-0 active:bg-accent-700/[0.22] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none ' +
    'dark:bg-accent-700/[0.16] dark:text-accent-700 dark:border-accent-700/25 dark:hover:bg-accent-700/[0.24]',
  secondary:
    'bg-bg-elevated text-ink-80 border border-border-divider hover:bg-bg-secondary hover:-translate-y-px active:translate-y-0 disabled:text-ink-40 disabled:hover:translate-y-0',
  ghost: 'bg-transparent text-ink-60 hover:bg-bg-secondary hover:text-ink-80 disabled:text-ink-40',
  danger:
    'bg-feedback-danger/[0.12] text-feedback-danger border border-feedback-danger/20 hover:bg-feedback-danger/[0.18] hover:-translate-y-px active:translate-y-0 active:bg-feedback-danger/[0.22] disabled:opacity-50 disabled:hover:translate-y-0',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-sm text-caption gap-xxs',
  md: 'h-11 px-md text-body gap-xs',
  lg: 'h-12 px-lg text-body gap-xs',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium',
        'transition-[background-color,transform,box-shadow,border-color,color] duration-200 ease-out active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

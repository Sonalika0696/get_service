'use client';

import { cn } from '@/lib/cn';

/** A simple on/off toggle switch. Uncontrolled callers pass `checked` + `onChange`. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill transition-colors',
        checked ? 'bg-accent-700' : 'bg-bg-secondary border border-border-divider',
        disabled && 'opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block h-[18px] w-[18px] transform rounded-pill bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

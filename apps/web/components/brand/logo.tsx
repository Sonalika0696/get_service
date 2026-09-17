import { cn } from '@/lib/cn';

/** GateX wordmark: a hashed-chain glyph nodding to the audit-chain core. */
export function Logo({
  compact = false,
  onDark = false,
  className,
}: {
  compact?: boolean;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-sm', className)}>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
        <rect width="32" height="32" rx="9" fill={onDark ? '#0D9488' : '#0F766E'} />
        <path d="M16 6.5 24 11v10l-8 4.5L8 21V11l8-4.5Z" stroke="#5EEAD4" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="16" cy="16" r="3.1" fill="#5EEAD4" />
      </svg>
      {!compact && (
        <span className={cn('text-heading font-semibold tracking-tight', onDark ? 'text-white' : 'text-ink-100')}>
          Gate<span className={onDark ? 'text-accent-300' : 'text-accent-700'}>X</span>
        </span>
      )}
    </div>
  );
}

import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-bg-secondary text-ink-60',
  accent: 'bg-accent-700/[0.08] text-accent-800',
  success: 'bg-feedback-successTint text-feedback-success',
  warning: 'bg-feedback-warningTint text-feedback-warning',
  danger: 'bg-feedback-dangerTint text-feedback-danger',
  info: 'bg-feedback-infoTint text-feedback-info',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-xxs rounded-pill px-sm py-[3px] text-caption font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

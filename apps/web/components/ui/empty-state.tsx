import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-lg py-2xl text-center', className)}>
      <div className="mb-md flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-700/[0.08]">
        <Icon className="h-7 w-7 text-accent-700" strokeWidth={1.75} />
      </div>
      <h3 className="text-body font-semibold text-ink-100">{title}</h3>
      {description && <p className="mt-xxs max-w-sm text-caption text-ink-60">{description}</p>}
      {action && <div className="mt-md">{action}</div>}
    </div>
  );
}

import { cn } from '@/lib/cn';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border border-border-subtle bg-bg-elevated shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  action,
  className,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-md px-md pt-md', className)}>
      <div className="flex items-center gap-sm">
        <span className="h-5 w-1 rounded-pill bg-accent-700" aria-hidden />
        <h2 className="text-heading font-semibold text-ink-100">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-md', className)} {...props} />;
}

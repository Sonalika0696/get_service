export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-lg flex flex-wrap items-end justify-between gap-md">
      <div>
        <h2 className="text-display font-semibold tracking-tight text-ink-100">{title}</h2>
        {subtitle && <p className="mt-xxs text-body text-ink-60">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

import type { LucideIcon } from 'lucide-react';
import { Card } from './card';
import { Badge } from './badge';

export function ComingSoon({
  icon: Icon,
  title,
  sprint,
  points,
}: {
  icon: LucideIcon;
  title: string;
  sprint: string;
  points: string[];
}) {
  return (
    <Card className="mx-auto max-w-2xl">
      <div className="flex flex-col items-start gap-md p-2xl">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-700/[0.08]">
          <Icon className="h-7 w-7 text-accent-700" strokeWidth={1.75} />
        </div>
        <div className="flex items-center gap-sm">
          <h3 className="text-heading font-semibold text-ink-100">{title}</h3>
          <Badge tone="accent">{sprint}</Badge>
        </div>
        <p className="text-body text-ink-60">
          This surface is on the roadmap. The design system, navigation and data layer are already in
          place, so building it out is incremental. Planned scope:
        </p>
        <ul className="flex flex-col gap-xs">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-sm text-body text-ink-80">
              <span className="mt-[9px] h-[6px] w-[6px] shrink-0 rounded-pill bg-accent-500" />
              {p}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

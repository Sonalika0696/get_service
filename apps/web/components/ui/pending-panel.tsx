import type { LucideIcon } from 'lucide-react';
import { Card } from './card';
import { Badge } from './badge';

/** A surface whose backend endpoint does not exist yet, named precisely. */
export function PendingPanel({
  icon: Icon,
  title,
  need,
  points,
}: {
  icon: LucideIcon;
  title: string;
  need: string;
  points: string[];
}) {
  return (
    <Card>
      <div className="flex flex-col gap-md p-lg">
        <div className="flex items-center gap-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-700/[0.08]">
            <Icon className="h-5 w-5 text-accent-700" strokeWidth={1.75} />
          </div>
          <div>
            <h3 className="text-body font-semibold text-ink-100">{title}</h3>
            <p className="font-mono text-caption text-ink-40">{need}</p>
          </div>
        </div>
        <Badge tone="warning">Waiting on backend endpoint</Badge>
        <ul className="flex flex-col gap-xs">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-sm text-caption text-ink-60">
              <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-pill bg-accent-500" />
              {p}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

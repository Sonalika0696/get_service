'use client';

import { formatRupees, humanizeAccountKind } from '@/lib/format';
import type { AccountBalance } from '@/lib/types';

const PALETTE = ['#0F766E', '#0EA5E9', '#F59E0B', '#8B5CF6', '#F43F5E', '#16A34A', '#B45309', '#0369A1'];

/**
 * Fund balances as a responsive CSS bar list rather than a Recharts chart:
 * long fund names truncate with a tooltip, the value column never overflows,
 * and it scales cleanly from mobile to wide without clipping or overlap.
 * Bar length is scaled by the largest ABSOLUTE balance so a single negative
 * boundary account (EXTERNAL) doesn't flatten every other bar.
 *
 * `maxHeight` caps and scrolls the list once rows overflow it (only 6 real
 * AccountKinds exist today, but this list usually sits beside a
 * fixed-purpose sibling card, so it's capped defensively rather than
 * assuming the kind count never grows). Pass the same value the paired
 * DataTable uses so the two cards stay visually matched.
 */
export function PocketBars({ balances, maxHeight }: { balances: AccountBalance[]; maxHeight?: string }) {
  const rows = balances.map((b, i) => ({
    name: humanizeAccountKind(b.kind),
    value: parseFloat(b.balance) || 0,
    fill: PALETTE[i % PALETTE.length],
  }));

  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0) || 1;

  if (rows.length === 0) return null;

  return (
    <ul className={maxHeight ? 'space-y-md overflow-y-auto pr-xxs' : 'space-y-md'} style={maxHeight ? { maxHeight } : undefined}>
      {rows.map((r) => {
        const pct = Math.max(0, Math.min(100, (Math.abs(r.value) / maxAbs) * 100));
        const negative = r.value < 0;
        return (
          <li
            key={r.name}
            className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-sm sm:grid-cols-[minmax(0,9rem)_1fr_auto] sm:gap-md"
          >
            <span className="truncate text-caption text-ink-60" title={r.name}>
              {r.name}
            </span>
            <span className="relative block h-2 min-w-[24px] overflow-hidden rounded-pill bg-bg-secondary">
              <span
                className="absolute inset-y-0 left-0 rounded-pill transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%`, backgroundColor: negative ? 'rgb(var(--feedback-danger))' : r.fill }}
              />
            </span>
            <span
              className={
                'tabular whitespace-nowrap text-right text-caption font-medium ' +
                (negative ? 'text-feedback-danger' : 'text-ink-100')
              }
            >
              {formatRupees(r.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

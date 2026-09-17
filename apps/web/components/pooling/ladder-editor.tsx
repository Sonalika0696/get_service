'use client';

import { Plus, Trash2, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DiscountRung } from '@/lib/types';

/**
 * Editor for a volume discount ladder. Each rung is "at N participants, save
 * P percent". The lowest rung's minN also becomes the pool's fire threshold
 * (the backend derives minCommitments from it).
 */
export function LadderEditor({
  value,
  onChange,
  optional,
}: {
  value: DiscountRung[];
  onChange: (next: DiscountRung[]) => void;
  optional?: boolean;
}) {
  function update(i: number, patch: Partial<DiscountRung>) {
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function add() {
    const lastN = value.length ? value[value.length - 1].minN + 5 : 5;
    onChange([...value, { minN: lastN, pct: 10 }]);
  }

  return (
    <div className="flex flex-col gap-xs">
      <div className="flex items-center gap-xs">
        <TrendingDown className="h-4 w-4 text-accent-700" />
        <span className="text-caption font-medium text-ink-80">
          Discount ladder{optional ? '' : <span className="ml-1 text-feedback-danger">*</span>}
        </span>
      </div>

      {value.length === 0 && (
        <p className="rounded-md bg-bg-secondary px-sm py-xs text-caption text-ink-40">
          No rungs yet. The lowest rung sets the participant threshold that fires the pool.
        </p>
      )}

      <div className="flex flex-col gap-xs">
        {value.map((rung, i) => (
          <div key={i} className="flex items-center gap-xs rounded-md border border-border-divider bg-bg-elevated p-xs">
            <span className="pl-xs text-caption text-ink-40">At</span>
            <input
              type="number"
              min={1}
              value={rung.minN}
              onChange={(e) => update(i, { minN: Number(e.target.value) })}
              className={numCls}
            />
            <span className="text-caption text-ink-40">participants, save</span>
            <input
              type="number"
              min={0}
              max={100}
              value={rung.pct}
              onChange={(e) => update(i, { pct: Number(e.target.value) })}
              className={numCls}
            />
            <span className="flex-1 text-caption text-ink-40">%</span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="Remove rung"
              className="rounded-sm p-xxs text-ink-40 transition-colors hover:text-feedback-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="flex w-fit items-center gap-xxs rounded-md border border-border-divider px-sm py-xs text-caption text-ink-60 transition-colors hover:bg-bg-secondary"
      >
        <Plus className="h-4 w-4" />
        Add rung
      </button>
    </div>
  );
}

const numCls = cn(
  'h-8 w-16 rounded-sm border border-border-divider bg-bg-elevated px-xs text-caption tabular text-ink-100',
  'focus:border-accent-700 focus:outline-none focus:ring-2 focus:ring-accent-700/30',
);

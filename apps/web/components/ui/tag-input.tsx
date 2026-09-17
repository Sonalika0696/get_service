'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Category picker: preset chips toggle on/off, and free entries can be
 * added. Vendor categories are free strings on the backend, so presets are
 * a convenience, not a constraint.
 */
export function TagInput({
  label,
  value,
  onChange,
  presets = [],
  required,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  presets?: string[];
  required?: boolean;
}) {
  const [draft, setDraft] = useState('');

  function toggle(tag: string) {
    onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag]);
  }

  function addDraft() {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  }

  const extras = value.filter((v) => !presets.includes(v));

  return (
    <div className="flex flex-col gap-xs">
      <label className="text-caption font-medium text-ink-80">
        {label}
        {required && <span className="ml-1 text-feedback-danger">*</span>}
      </label>

      <div className="flex flex-wrap gap-xs">
        {presets.map((tag) => {
          const active = value.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              className={cn(
                'rounded-pill border px-sm py-[6px] text-caption font-medium transition-colors',
                active
                  ? 'border-accent-700 bg-accent-700/[0.08] text-accent-800'
                  : 'border-border-divider bg-bg-elevated text-ink-60 hover:bg-bg-secondary',
              )}
            >
              {tag}
            </button>
          );
        })}
        {extras.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-xxs rounded-pill border border-accent-700 bg-accent-700/[0.08] py-[6px] pl-sm pr-xs text-caption font-medium text-accent-800"
          >
            {tag}
            <button type="button" onClick={() => toggle(tag)} aria-label={`Remove ${tag}`}>
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-xs">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
          placeholder="Add another category"
          className="h-9 flex-1 rounded-md border border-border-divider bg-bg-elevated px-sm text-caption text-ink-100 placeholder:text-ink-40 focus:border-accent-700 focus:outline-none focus:ring-2 focus:ring-accent-700/30"
        />
        <button
          type="button"
          onClick={addDraft}
          className="flex h-9 items-center gap-xxs rounded-md border border-border-divider px-sm text-caption text-ink-60 transition-colors hover:bg-bg-secondary"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
    </div>
  );
}

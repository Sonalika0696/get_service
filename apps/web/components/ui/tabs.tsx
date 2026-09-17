'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export interface TabDef {
  key: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
  layoutId = 'tabs-underline',
}: {
  tabs: TabDef[];
  value: string;
  onChange: (key: string) => void;
  layoutId?: string;
}) {
  return (
    <div className="flex gap-lg border-b border-border-subtle" role="tablist">
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              'relative -mb-px flex items-center gap-xs pb-sm text-body font-medium transition-colors',
              active ? 'text-ink-100' : 'text-ink-40 hover:text-ink-60',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'tabular rounded-pill px-xs text-[11px]',
                  active ? 'bg-accent-700/[0.1] text-accent-800' : 'bg-bg-secondary text-ink-40',
                )}
              >
                {tab.count}
              </span>
            )}
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-x-0 bottom-0 h-[2px] rounded-pill bg-accent-700"
                transition={{ type: 'spring', stiffness: 480, damping: 38 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

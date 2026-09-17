'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { riseItem } from '@/lib/motion';
import { cn } from '@/lib/cn';
import { Skeleton } from './skeleton';

type Accent = 'teal' | 'sky' | 'amber' | 'rose' | 'violet';

// The big numbers stay neutral (ink-100) so they read on both light and the
// near-black dark surface; the accent lives in the coloured icon chip only.
const ACCENTS: Record<Accent, { chip: string; icon: string }> = {
  teal: { chip: 'bg-accent-700', icon: 'text-white' },
  sky: { chip: 'bg-[#0EA5E9]', icon: 'text-white' },
  amber: { chip: 'bg-[#F59E0B]', icon: 'text-white' },
  rose: { chip: 'bg-[#F43F5E]', icon: 'text-white' },
  violet: { chip: 'bg-[#8B5CF6]', icon: 'text-white' },
};

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = 'teal',
  caption,
  loading,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: Accent;
  caption?: string;
  loading?: boolean;
}) {
  const a = ACCENTS[accent];
  return (
    <motion.div
      variants={riseItem}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="group flex flex-col gap-sm rounded-2xl border border-border-subtle bg-bg-elevated p-md shadow-sm transition-shadow hover:shadow-md"
    >
      <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', a.chip)}>
        <Icon className={cn('h-[18px] w-[18px]', a.icon)} strokeWidth={2} />
      </div>
      <div>
        <p className="text-overline uppercase text-ink-40">{label}</p>
        {loading ? (
          <Skeleton className="mt-xs h-8 w-20" />
        ) : (
          <p className="tabular mt-xxs text-display font-semibold leading-none text-ink-100">{value}</p>
        )}
        {caption && <p className="mt-xs text-caption text-ink-60">{caption}</p>}
      </div>
    </motion.div>
  );
}

'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { riseItem } from '@/lib/motion';
import { cn } from '@/lib/cn';
import { Skeleton } from './skeleton';

type Accent = 'teal' | 'sky' | 'amber' | 'rose' | 'violet';

const ACCENTS: Record<Accent, { chip: string; icon: string; value: string }> = {
  teal: { chip: 'bg-accent-700', icon: 'text-white', value: 'text-accent-800' },
  sky: { chip: 'bg-[#0EA5E9]', icon: 'text-white', value: 'text-[#0369A1]' },
  amber: { chip: 'bg-[#F59E0B]', icon: 'text-white', value: 'text-[#B45309]' },
  rose: { chip: 'bg-[#F43F5E]', icon: 'text-white', value: 'text-[#BE123C]' },
  violet: { chip: 'bg-[#8B5CF6]', icon: 'text-white', value: 'text-[#6D28D9]' },
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
      className="group flex flex-col gap-md rounded-2xl border border-border-subtle bg-bg-elevated p-lg shadow-sm transition-shadow hover:shadow-md"
    >
      <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl', a.chip)}>
        <Icon className={cn('h-6 w-6', a.icon)} strokeWidth={2} />
      </div>
      <div>
        <p className="text-overline uppercase text-ink-40">{label}</p>
        {loading ? (
          <Skeleton className="mt-xs h-8 w-20" />
        ) : (
          <p className={cn('tabular mt-xxs text-display font-semibold leading-none', a.value)}>{value}</p>
        )}
        {caption && <p className="mt-xs text-caption text-ink-60">{caption}</p>}
      </div>
    </motion.div>
  );
}

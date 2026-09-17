'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

/**
 * Threshold progress for a pool: current commitments against the minimum
 * needed to fire. Turns from accent to success once the threshold is met.
 */
export function ThresholdBar({
  current,
  target,
  fired,
}: {
  current: number;
  target: number | null;
  fired?: boolean;
}) {
  const met = fired || (target !== null && current >= target);
  const pct = target && target > 0 ? Math.min(100, Math.round((current / target) * 100)) : fired ? 100 : 0;

  return (
    <div className="flex flex-col gap-xxs">
      <div className="flex items-baseline justify-between text-caption">
        <span className="tabular font-semibold text-ink-100">
          {current}
          {target !== null && <span className="font-normal text-ink-40"> / {target}</span>}
        </span>
        <span className={cn('font-medium', met ? 'text-feedback-success' : 'text-ink-40')}>
          {fired ? 'Fired' : met ? 'Threshold met' : `${pct}%`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-bg-secondary">
        <motion.div
          className={cn('h-full rounded-pill', met ? 'bg-feedback-success' : 'bg-accent-600')}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
        />
      </div>
    </div>
  );
}

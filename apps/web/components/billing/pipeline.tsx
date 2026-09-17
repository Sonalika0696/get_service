'use client';

import { motion } from 'framer-motion';
import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { staggerContainer, riseItem } from '@/lib/motion';

export type StageState = 'done' | 'active' | 'blocked' | 'todo';

export interface PipelineStage {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  state?: StageState;
  /** Endpoint that drives this stage, shown while the backend is pending. */
  endpoint?: string;
}

const DOT: Record<StageState, string> = {
  done: 'bg-feedback-success text-white',
  active: 'bg-accent-700 text-white',
  blocked: 'bg-feedback-warning text-white',
  todo: 'bg-bg-secondary text-ink-40',
};

/**
 * Vertical stepper for the billing cycle pipeline. Reused by the real cycle
 * wizard once the backend lands; here it renders the stage contract.
 */
export function BillingPipeline({ stages }: { stages: PipelineStage[] }) {
  return (
    <motion.ol variants={staggerContainer} initial="hidden" animate="show" className="relative flex flex-col">
      {stages.map((stage, i) => {
        const state = stage.state ?? 'todo';
        const Icon = stage.icon;
        const last = i === stages.length - 1;
        return (
          <motion.li key={stage.key} variants={riseItem} className="relative flex gap-md pb-lg last:pb-0">
            {!last && <span className="absolute left-[19px] top-10 h-[calc(100%-16px)] w-px bg-border-divider" aria-hidden />}
            <span className={cn('z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', DOT[state])}>
              {state === 'done' ? <Check className="h-5 w-5" strokeWidth={2.5} /> : <Icon className="h-5 w-5" strokeWidth={2} />}
            </span>
            <div className="pt-[2px]">
              <div className="flex flex-wrap items-center gap-xs">
                <h4 className="text-body font-semibold text-ink-100">{stage.title}</h4>
                {stage.endpoint && (
                  <code className="rounded-sm bg-bg-secondary px-xs py-[1px] font-mono text-[11px] text-ink-40">{stage.endpoint}</code>
                )}
              </div>
              <p className="mt-xxs text-caption text-ink-60">{stage.description}</p>
            </div>
          </motion.li>
        );
      })}
    </motion.ol>
  );
}

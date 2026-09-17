'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { User, Users, Landmark, ArrowRight } from 'lucide-react';
import { Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { formatRupees } from '@/lib/format';
import { ladderRungs, requiredApprovers, rungForAmount } from '@/lib/approval';
import { staggerContainer, riseItem } from '@/lib/motion';
import type { ApprovalConfig } from '@/lib/types';

const RUNG_ICON = { 1: User, 2: Users, 3: Landmark } as const;

/** Three-rung ladder derived from the saved config and current roster. */
export function LadderVisual({
  config,
  rosterSize,
  activeRung,
}: {
  config: ApprovalConfig;
  rosterSize: number;
  activeRung?: 1 | 2 | 3;
}) {
  const rungs = ladderRungs(config, rosterSize);
  const bands = [
    `Up to ${formatRupees(config.lowerThreshold)}`,
    `${formatRupees(config.lowerThreshold)} to ${formatRupees(config.upperThreshold)}`,
    `Above ${formatRupees(config.upperThreshold)}`,
  ];

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-md md:grid-cols-3">
      {rungs.map((r, i) => {
        const Icon = RUNG_ICON[r.rung];
        const active = activeRung === r.rung;
        return (
          <motion.div
            key={r.rung}
            variants={riseItem}
            className={cn(
              'relative flex flex-col gap-sm rounded-2xl border p-lg transition-colors',
              active ? 'border-accent-700 bg-accent-700/[0.06] shadow-md' : 'border-border-subtle bg-bg-elevated shadow-sm',
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', active ? 'bg-accent-700' : 'bg-bg-secondary')}>
                <Icon className={cn('h-5 w-5', active ? 'text-white' : 'text-ink-60')} strokeWidth={2} />
              </span>
              <span className="text-overline uppercase text-ink-40">Rung {r.rung}</span>
            </div>
            <div>
              <p className="text-body font-semibold text-ink-100">{r.title}</p>
              <p className="tabular text-caption text-ink-40">{bands[i]}</p>
            </div>
            <Badge tone={active ? 'accent' : 'neutral'}>{r.approvers}</Badge>
            <p className="text-caption text-ink-60">{r.detail}</p>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

/** Enter an amount and roster size, see which rung fires and how many officers it needs. */
export function AmountSimulator({ config, rosterSize }: { config: ApprovalConfig; rosterSize: number }) {
  const [amount, setAmount] = useState('12000');
  const [roster, setRoster] = useState(String(rosterSize));

  const parsedAmount = Number(amount) || 0;
  const parsedRoster = Math.max(1, Number(roster) || 1);

  const { rung, approvers } = useMemo(
    () => ({
      rung: rungForAmount(parsedAmount, config),
      approvers: requiredApprovers(parsedAmount, config, parsedRoster),
    }),
    [parsedAmount, parsedRoster, config],
  );

  return (
    <div className="flex flex-col gap-md">
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
        <Field
          label="Disbursement amount (₹)"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
        />
        <Field
          label="Number of admins"
          inputMode="numeric"
          value={roster}
          onChange={(e) => setRoster(e.target.value.replace(/[^\d]/g, ''))}
          hint="Admins who can approve payments."
        />
      </div>

      <div className="flex items-center gap-md rounded-xl border border-accent-700/40 bg-accent-700/[0.06] p-md">
        <div className="flex items-center gap-sm text-body text-ink-80">
          <span className="tabular font-semibold text-ink-100">{formatRupees(parsedAmount)}</span>
          <ArrowRight className="h-4 w-4 text-ink-40" />
          <Badge tone="accent">Rung {rung}</Badge>
        </div>
        <div className="ml-auto text-right">
          <p className="text-overline uppercase text-ink-40">Requires</p>
          <p className="tabular text-heading font-semibold text-accent-800">
            {approvers} {approvers === 1 ? 'admin' : 'admins'}
          </p>
        </div>
      </div>

      <LadderVisual config={config} rosterSize={parsedRoster} activeRung={rung} />
    </div>
  );
}

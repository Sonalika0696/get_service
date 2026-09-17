'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Wallet, Scale, Hourglass, Inbox, Lock, Clock, ArrowLeftRight, FileClock } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Tabs } from '@/components/ui/tabs';
import { Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PendingPanel } from '@/components/ui/pending-panel';
import { collections } from '@/lib/endpoints';
import { getIdentity } from '@/lib/session';
import { formatRupees, formatDate } from '@/lib/format';
import { staggerContainer } from '@/lib/motion';
import { ApiError } from '@/lib/api';

type Tab = 'reconciliation' | 'arrears';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CollectionsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => setAllowed(getIdentity()?.principalKind === 'RESIDENT'), []);

  const [tab, setTab] = useState<Tab>('reconciliation');
  const [date, setDate] = useState(todayISO());

  const recon = useQuery({
    queryKey: ['reconciliation', date],
    queryFn: () => collections.reconciliation(date),
    enabled: allowed === true,
    retry: false,
  });

  if (allowed === false) {
    return (
      <>
        <PageHeader title="Payments & dues" subtitle="Bank matching, overdue dues and unmatched payments." />
        <Card>
          <EmptyState icon={Lock} title="Admin access only" description="Payments and dues are admin functions." />
        </Card>
      </>
    );
  }

  const forbidden = recon.error instanceof ApiError && recon.error.status === 403;

  return (
    <>
      <PageHeader title="Payments & dues" subtitle="Match the bank, chase overdue dues, and review payments that couldn't be auto-matched." />

      <div className="mb-lg">
        <Tabs
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          tabs={[
            { key: 'reconciliation', label: 'Bank matching' },
            { key: 'arrears', label: 'Dues & status' },
          ]}
        />
      </div>

      {tab === 'reconciliation' ? (
        forbidden ? (
          <Card>
            <EmptyState
              icon={Lock}
              title="Admin access required"
              description="Bank matching is limited to administrators."
            />
          </Card>
        ) : (
          <div className="space-y-lg">
            <div className="flex items-end justify-between gap-md">
              <div className="w-full max-w-[220px]">
                <Field label="Reconciliation date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              {recon.data && <Badge tone="info"><Clock className="h-3.5 w-3.5" />{formatDate(recon.data.date)}</Badge>}
            </div>

            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-3"
            >
              <StatCard
                label="Net across bank boundary"
                value={recon.data ? formatRupees(recon.data.ledgerNetExternal) : '—'}
                icon={ArrowLeftRight}
                accent="teal"
                loading={recon.isLoading}
                caption="EXTERNAL account, this day"
              />
              <StatCard
                label="Ledger entries"
                value={recon.data?.ledgerEntryCount ?? 0}
                icon={FileClock}
                accent="sky"
                loading={recon.isLoading}
                caption="Posted on this date"
              />
              <StatCard
                label="Unmatched credits"
                value={recon.data?.unmatched.length ?? 0}
                icon={Inbox}
                accent="amber"
                loading={recon.isLoading}
                caption="Awaiting allocation"
              />
            </motion.div>

            <Card>
              <CardHeader title="Unmatched credits" action={<Badge tone="neutral">Review queue</Badge>} />
              <CardBody>
                {recon.data && recon.data.unmatched.length > 0 ? (
                  <ul className="divide-y divide-border-subtle">
                    {recon.data.unmatched.map((c, i) => (
                      <li key={c.id ?? i} className="flex items-center justify-between py-sm">
                        <span className="text-body text-ink-80">{c.reference ?? 'Credit'}</span>
                        <span className="tabular font-medium text-ink-100">{c.amount != null ? formatRupees(c.amount) : '—'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon={Inbox}
                    title="No unmatched credits"
                    description="Credits that cannot be matched to a flat by virtual account will queue here for treasurer review. The PSP settlement feed that populates this is not wired yet."
                  />
                )}
              </CardBody>
            </Card>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
          <PendingPanel
            icon={Hourglass}
            title="Overdue dues"
            need="GET /collections/arrears"
            points={[
              'Per-flat outstanding by ageing bucket (0-30, 31-60, 61-90, 90+ days)',
              'Configurable late fees and instalment forbearance',
              'Sortable, exportable, drill-down to the flat ledger',
            ]}
          />
          <PendingPanel
            icon={Scale}
            title="Who's paid, by flat"
            need="GET /collections/status"
            points={[
              'Collected vs due per flat, split by maintenance / electricity / water / events',
              'Collection-rate rollups across the society',
              'Filter by category and settlement state',
            ]}
          />
        </div>
      )}
    </>
  );
}

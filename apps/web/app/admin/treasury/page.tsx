'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PiggyBank, ArrowLeftRight, Lock, Layers, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PendingPanel } from '@/components/ui/pending-panel';
import { AuditChainVerifier } from '@/components/treasury/audit-chain';
import { PocketBars } from '@/components/charts/pocket-bars';
import { treasury } from '@/lib/endpoints';
import { getIdentity } from '@/lib/session';
import { formatRupees, humanizeAccountKind } from '@/lib/format';
import type { AccountBalance } from '@/lib/types';

type Tab = 'audit' | 'balances' | 'corpus';

export default function TreasuryPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => setAllowed(getIdentity()?.principalKind === 'RESIDENT'), []);

  const [tab, setTab] = useState<Tab>('balances');

  const ledger = useQuery({ queryKey: ['ledger'], queryFn: treasury.ledger, enabled: allowed === true && tab === 'balances' });

  const balances = ledger.data?.balances ?? [];
  // "Held" excludes EXTERNAL (the bank boundary), which nets negative as money comes in.
  const total = useMemo(
    () => balances.filter((b) => b.kind !== 'EXTERNAL').reduce((s, b) => s + (parseFloat(b.balance) || 0), 0),
    [balances],
  );

  if (allowed === false) {
    return (
      <>
        <PageHeader title="Finances" subtitle="Fund balances, deposits and record integrity." />
        <Card>
          <EmptyState icon={Lock} title="Admin access only" description="Finances are managed by administrators." />
        </Card>
      </>
    );
  }

  const columns: Column<AccountBalance>[] = [
    {
      key: 'kind',
      header: 'Fund',
      cell: (r) => <span className="font-medium text-ink-100">{humanizeAccountKind(r.kind)}</span>,
      sortValue: (r) => r.kind,
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (r) => <span className="tabular font-medium text-ink-100">{formatRupees(r.balance)}</span>,
      sortValue: (r) => parseFloat(r.balance) || 0,
    },
  ];

  return (
    <>
      <PageHeader title="Finances" subtitle="Fund balances, deposits, and proof that records haven't been tampered with." />

      <div className="mb-lg">
        <Tabs
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          tabs={[
            { key: 'balances', label: 'Fund balances' },
            { key: 'audit', label: 'Records & integrity' },
            { key: 'corpus', label: 'Deposits & transfers' },
          ]}
        />
      </div>

      {tab === 'audit' && <AuditChainVerifier />}

      {tab === 'balances' && (
        <div className="space-y-lg">
          <Card>
            <CardHeader
              title="Fund balances"
              action={
                ledger.data ? (
                  <Badge tone={ledger.data.balancesIntact ? 'success' : 'danger'}>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {ledger.data.balancesIntact ? 'Balanced' : 'Check'}
                  </Badge>
                ) : undefined
              }
            />
            <CardBody className="pt-md">
              {balances.length > 0 && (
                <div className="mb-md flex items-baseline gap-sm">
                  <span className="text-overline uppercase text-ink-40">Total held</span>
                  <span className="tabular text-heading font-semibold text-ink-100">{formatRupees(total)}</span>
                </div>
              )}
              <DataTable
                columns={columns}
                rows={balances}
                rowKey={(r) => r.kind}
                loading={ledger.isLoading}
                empty={<EmptyState icon={Layers} title="No sub-ledger balances yet" description="Balances appear once the society posts its first journal entries." />}
              />
            </CardBody>
          </Card>

          {balances.length > 0 && (
            <Card>
              <CardHeader title="Balance by pocket" />
              <CardBody>
                <PocketBars balances={balances} />
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {tab === 'corpus' && (
        <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
          <PendingPanel
            icon={PiggyBank}
            title="Fixed deposits"
            need="GET/POST /treasury/corpus/deposits"
            points={[
              'Park surplus corpus into fixed deposits automatically',
              'A maturity ladder so deposits come due through the year',
              'Two admins must approve each placement',
            ]}
          />
          <PendingPanel
            icon={ArrowLeftRight}
            title="Move money between funds"
            need="POST /ledger/journal (two approvals)"
            points={[
              'Transfer between funds (e.g. operating to sinking)',
              'Requires two different admins to approve before it goes through',
              'The single-admin adjustment tool exists; the two-approval transfer is not built yet',
            ]}
          />
        </div>
      )}
    </>
  );
}

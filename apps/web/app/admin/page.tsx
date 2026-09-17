'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Store, UserCheck, Home, Users, Building2, Layers } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PocketBars } from '@/components/charts/pocket-bars';
import { StatusDonut } from '@/components/charts/status-donut';
import { CashflowCard } from '@/components/charts/cashflow-card';
import { dashboard, operator } from '@/lib/endpoints';
import { getIdentity, type IdentityHint } from '@/lib/session';
import { formatRupees, humanizeAccountKind, formatDate } from '@/lib/format';
import { staggerContainer } from '@/lib/motion';
import type { AccountBalance, Society } from '@/lib/types';

export default function AdminDashboard() {
  const [identity, setIdentity] = useState<IdentityHint | null>(null);
  useEffect(() => setIdentity(getIdentity()), []);

  if (!identity) return null;
  return identity.principalKind === 'OPERATOR' ? <OperatorDashboard /> : <CommitteeDashboard identity={identity} />;
}

/* --------------------------------------------------------- committee --- */

function CommitteeDashboard({ identity }: { identity: IdentityHint }) {
  const sid = identity.societyId!;

  // One aggregate call replaces the previous vendors + ratifications + ledger fan-out.
  const kpis = useQuery({
    queryKey: ['dashboard', 'society', sid],
    queryFn: () => dashboard.society(sid),
    enabled: !!sid,
  });

  const balances = kpis.data?.accountBalances ?? [];

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
    <div className="space-y-lg">
      <PageHeader title="Dashboard" subtitle="Your society at a glance." />
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard label="Flats" value={kpis.data?.flats ?? 0} icon={Home} accent="teal" loading={kpis.isLoading} />
        <StatCard label="Residents" value={kpis.data?.residents ?? 0} icon={Users} accent="sky" loading={kpis.isLoading} />
        <StatCard label="Vendors" value={kpis.data?.vendors ?? 0} icon={Store} accent="violet" loading={kpis.isLoading} />
        <StatCard
          label="Pending ratifications"
          value={kpis.data?.pendingRatifications ?? 0}
          icon={UserCheck}
          accent="amber"
          loading={kpis.isLoading}
          caption={kpis.data?.pendingRatifications ? 'Awaiting your review' : 'Queue is clear'}
        />
      </motion.div>

      <div className="grid grid-cols-1 gap-lg xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Fund balances" action={<Badge tone="neutral"><Layers className="h-3.5 w-3.5" />{balances.length} funds</Badge>} />
          <CardBody className="pt-md">
            <DataTable
              columns={columns}
              rows={balances}
              rowKey={(r) => r.kind}
              loading={kpis.isLoading}
              maxHeight="320px"
              empty={<EmptyState icon={Layers} title="No fund balances yet" description="Balances appear once money starts moving through the society's funds." />}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="By fund" />
          <CardBody>
            {balances.length ? (
              <PocketBars balances={balances} maxHeight="320px" />
            ) : (
              <EmptyState icon={Layers} title="Nothing to chart" description="Sub-ledger balances will render here." />
            )}
          </CardBody>
        </Card>
      </div>

      <CashflowCard />
    </div>
  );
}

/* ---------------------------------------------------------- operator --- */

function OperatorDashboard() {
  // KPI counts come from the one-call aggregate; the societies list still
  // backs the recent-societies table and the status donut (per-status split).
  const kpis = useQuery({ queryKey: ['dashboard', 'operator'], queryFn: dashboard.operator });
  const societies = useQuery({ queryKey: ['societies'], queryFn: () => operator.listSocieties() });
  const rows = societies.data ?? [];

  const counts = rows.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  const columns: Column<Society>[] = [
    {
      key: 'name',
      header: 'Society',
      cell: (r) => (
        <div>
          <p className="font-medium text-ink-100">{r.name}</p>
          <p className="text-caption text-ink-40">{r.address}</p>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.status} />,
      sortValue: (r) => r.status,
    },
    {
      key: 'createdAt',
      header: 'Onboarded',
      align: 'right',
      cell: (r) => <span className="tabular text-ink-60">{formatDate(r.createdAt)}</span>,
      sortValue: (r) => r.createdAt,
    },
  ];

  return (
    <div className="space-y-lg">
      <PageHeader title="Platform overview" subtitle="Societies, residents and vendors across the platform." />
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard label="Societies" value={kpis.data?.societies.total ?? 0} icon={Building2} accent="teal" loading={kpis.isLoading} caption={`${kpis.data?.societies.active ?? 0} active`} />
        <StatCard label="Residents" value={kpis.data?.residents ?? 0} icon={Users} accent="sky" loading={kpis.isLoading} />
        <StatCard label="Vendors" value={kpis.data?.vendors ?? 0} icon={Store} accent="violet" loading={kpis.isLoading} />
        <StatCard label="Pending ratifications" value={kpis.data?.pendingRatifications ?? 0} icon={UserCheck} accent="amber" loading={kpis.isLoading} />
      </motion.div>

      <div className="grid grid-cols-1 gap-lg xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recent societies" />
          <CardBody className="pt-md">
            <DataTable
              columns={columns}
              rows={rows.slice(0, 8)}
              rowKey={(r) => r.id}
              loading={societies.isLoading}
              empty={<EmptyState icon={Building2} title="No societies yet" description="Create the first society from the Societies page." />}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="By status" />
          <CardBody>
            {rows.length ? (
              <StatusDonut counts={counts} />
            ) : (
              <EmptyState icon={Building2} title="No data" description="Society status split renders here." />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'ACTIVE' ? 'success' : status === 'ONBOARDING' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

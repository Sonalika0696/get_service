'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Inbox, Hourglass, Lock, Users, Check, X, Save } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { PolicyEditor } from '@/components/governance/policy-editor';
import { AmountSimulator } from '@/components/governance/ladder';
import { governance } from '@/lib/endpoints';
import { getIdentity, type IdentityHint } from '@/lib/session';
import { DEFAULT_APPROVAL_CONFIG } from '@/lib/approval';
import { formatRupees } from '@/lib/format';

export default function ApprovalsPage() {
  const [identity, setIdentity] = useState<IdentityHint | null | undefined>(undefined);
  useEffect(() => setIdentity(getIdentity()), []);

  const isResident = identity?.principalKind === 'RESIDENT';
  const sid = isResident ? identity?.societyId : undefined;
  const canEdit = identity?.roleLabel === 'Committee officer' || identity?.roleLabel === 'Treasurer';

  const configQ = useQuery({
    queryKey: ['approvalConfig'],
    queryFn: governance.getApprovalConfig,
    enabled: isResident,
  });

  const rolesQ = useQuery({
    queryKey: ['roles', sid],
    queryFn: () => governance.listRoles(sid!),
    enabled: !!sid,
    retry: false,
  });

  const rosterSize = useMemo(() => {
    if (!rolesQ.data) return null;
    return new Set(rolesQ.data.map((r) => r.userId)).size || 1;
  }, [rolesQ.data]);

  if (identity !== undefined && !isResident) {
    return (
      <>
        <PageHeader title="Spending rules" subtitle="Who must sign off on a payment, by amount." />
        <Card>
          <EmptyState icon={Lock} title="Admin access only" description="Spending rules are managed by administrators." />
        </Card>
      </>
    );
  }

  const config = configQ.data ?? DEFAULT_APPROVAL_CONFIG;
  const effectiveRoster = rosterSize ?? 5;

  return (
    <>
      <PageHeader
        title="Spending rules"
        subtitle="Set how many admins must approve a payment, based on how large it is."
      />

      <div className="space-y-lg">
        <Card>
          <CardHeader
            title="Spending policy"
            action={
              rosterSize !== null ? (
                <Badge tone="neutral"><Users className="h-3.5 w-3.5" />{rosterSize} admin{rosterSize === 1 ? '' : 's'}</Badge>
              ) : undefined
            }
          />
          <CardBody>
            {configQ.isLoading ? (
              <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <PolicyEditor config={config} canEdit={canEdit} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Try an amount" action={<Badge tone="accent">Live preview</Badge>} />
          <CardBody>
            <p className="mb-md text-caption text-ink-60">
              Enter a payment amount to see how many admins would need to approve it.
            </p>
            <AmountSimulator config={config} rosterSize={effectiveRoster} />
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
          <PendingApprovalsInbox />
          <LateFeesConfig />
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------- approvals inbox --- */

interface PendingApproval {
  id: string;
  title: string;
  counterparty: string;
  amount: number;
  rung: 'Small payments' | 'Medium payments' | 'Large payments';
  approvals: number;
  required: number;
}

const INITIAL_APPROVALS: PendingApproval[] = [
  { id: 'a1', title: 'AC servicing drive payout', counterparty: 'CoolBreeze AC Services', amount: 14400, rung: 'Medium payments', approvals: 1, required: 2 },
  { id: 'a2', title: 'Sinking fund transfer', counterparty: 'Internal — Maintenance to Sinking', amount: 20000, rung: 'Medium payments', approvals: 0, required: 2 },
  { id: 'a3', title: 'Deep-clean milestone release', counterparty: 'GreenLeaf Deep Cleaning', amount: 8500, rung: 'Small payments', approvals: 0, required: 1 },
];

function PendingApprovalsInbox() {
  const toast = useToast();
  const [items, setItems] = useState(INITIAL_APPROVALS);

  function decide(id: string, action: 'authorise' | 'decline') {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (action === 'decline') {
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.show(`Declined "${item.title}".`, 'info');
      return;
    }
    const nextApprovals = item.approvals + 1;
    if (nextApprovals >= item.required) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success(`"${item.title}" fully authorised and released.`);
    } else {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, approvals: nextApprovals } : i)));
      toast.show(`Signed. ${nextApprovals}/${item.required} admins so far.`, 'info');
    }
  }

  return (
    <Card>
      <CardHeader title="Pending approvals inbox" action={<Badge tone="neutral">{items.length} waiting</Badge>} />
      <CardBody className="pt-md">
        {items.length === 0 ? (
          <EmptyState icon={Inbox} title="Queue is clear" description="Nothing is waiting on your signature." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-sm py-sm first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink-100">{i.title}</p>
                  <p className="text-caption text-ink-40">{i.counterparty} · {i.rung} · {i.approvals}/{i.required} signed</p>
                </div>
                <div className="flex shrink-0 items-center gap-sm">
                  <span className="tabular font-semibold text-ink-100">{formatRupees(i.amount)}</span>
                  <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => decide(i.id, 'authorise')}>Sign</Button>
                  <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => decide(i.id, 'decline')} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------ late fees --- */

function LateFeesConfig() {
  const toast = useToast();
  const [lateFeePct, setLateFeePct] = useState('2');
  const [graceDays, setGraceDays] = useState('7');
  const [instalments, setInstalments] = useState('3');

  function save(e: React.FormEvent) {
    e.preventDefault();
    toast.success('Late-fee and forbearance policy saved.');
  }

  return (
    <Card>
      <CardHeader title="Late fees & instalment forbearance" />
      <CardBody className="pt-md">
        <form onSubmit={save} className="flex flex-col gap-md">
          <div className="grid grid-cols-2 gap-md">
            <Field label="Late fee (% per month)" type="number" inputMode="decimal" min={0} value={lateFeePct} onChange={(e) => setLateFeePct(e.target.value)} />
            <Field label="Grace period (days)" type="number" inputMode="numeric" min={0} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
          </div>
          <Field label="Max instalments offered" type="number" inputMode="numeric" min={1} value={instalments} onChange={(e) => setInstalments(e.target.value)} hint="How many months a resident in forbearance can spread overdue dues across." />
          <div className="flex items-center gap-xs text-caption text-ink-40">
            <Hourglass className="h-3.5 w-3.5" />
            Separate from the approval-ladder config above — this governs overdue receivables only.
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" icon={<Save className="h-4 w-4" />}>Save policy</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

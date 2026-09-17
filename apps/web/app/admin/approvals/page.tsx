'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Inbox, Hourglass, Lock, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PendingPanel } from '@/components/ui/pending-panel';
import { PolicyEditor } from '@/components/governance/policy-editor';
import { AmountSimulator } from '@/components/governance/ladder';
import { governance } from '@/lib/endpoints';
import { getIdentity, type IdentityHint } from '@/lib/session';
import { DEFAULT_APPROVAL_CONFIG } from '@/lib/approval';

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
          <PendingPanel
            icon={Inbox}
            title="Pending approvals inbox"
            need="GET /me/approvals (or /bookings?status=pending)"
            points={[
              'List payouts and corpus movements awaiting authorisation',
              'Show amount, counterparty, rung and approvals collected so far',
              'Authorise or decline; same-identity approval rejected and shown as rejected',
              'Backend has POST /bookings/:id/payout/authorise, but no list endpoint to populate the queue',
            ]}
          />
          <PendingPanel
            icon={Hourglass}
            title="Late fees & instalment forbearance"
            need="GET/PUT /society/:sid/policy/receivables"
            points={[
              'Configurable late-fee schedule on overdue receivables',
              'Instalment forbearance terms',
              'Separate from the approval-ladder config, which is already live here',
            ]}
          />
        </div>
      </div>
    </>
  );
}

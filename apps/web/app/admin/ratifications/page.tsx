'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCheck, Check, X, Lock } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { committee } from '@/lib/endpoints';
import { getIdentity } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { ApiError } from '@/lib/api';
import type { Occupancy } from '@/lib/types';

export default function RatificationsPage() {
  const [sid, setSid] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const id = getIdentity();
    setSid(id?.principalKind === 'RESIDENT' ? id.societyId ?? null : null);
  }, []);

  const qc = useQueryClient();
  const toast = useToast();

  const q = useQuery({
    queryKey: ['ratifications', sid],
    queryFn: () => committee.pendingRatifications(sid!),
    enabled: !!sid,
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'ratify' | 'reject' }) =>
      action === 'ratify' ? committee.ratify(sid!, id) : committee.reject(sid!, id),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'ratify' ? 'Resident ratified.' : 'Claim rejected.');
      qc.invalidateQueries({ queryKey: ['ratifications', sid] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Action failed.'),
  });

  if (sid === null) {
    return (
      <>
        <PageHeader title="Resident approvals" subtitle="Approve new residents' claims to their flats." />
        <Card>
          <EmptyState icon={Lock} title="Admin access only" description="Only an administrator can approve new residents." />
        </Card>
      </>
    );
  }

  const columns: Column<Occupancy>[] = [
    {
      key: 'userId',
      header: 'Resident',
      cell: (r) => <span className="font-mono text-caption text-ink-80">{r.userId.slice(0, 10)}…</span>,
      sortValue: (r) => r.userId,
    },
    {
      key: 'flatId',
      header: 'Flat',
      cell: (r) => <span className="font-medium text-ink-100">{r.flatId}</span>,
      sortValue: (r) => r.flatId,
    },
    {
      key: 'occupancyRole',
      header: 'Role',
      cell: (r) => <Badge tone="accent">{humanRole(r.occupancyRole)}</Badge>,
      sortValue: (r) => r.occupancyRole,
    },
    {
      key: 'createdAt',
      header: 'Requested',
      cell: (r) => <span className="tabular text-ink-60">{formatDate(r.createdAt)}</span>,
      sortValue: (r) => r.createdAt,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-xs">
          <Button variant="secondary" size="sm" icon={<Check className="h-4 w-4 text-feedback-success" />} loading={decide.isPending && decide.variables?.id === r.id} onClick={() => decide.mutate({ id: r.id, action: 'ratify' })}>
            Ratify
          </Button>
          <Button variant="ghost" size="sm" icon={<X className="h-4 w-4 text-feedback-danger" />} onClick={() => decide.mutate({ id: r.id, action: 'reject' })}>
            Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Resident approvals"
        subtitle="New residents who claimed a flat, waiting for you to approve them before they're activated."
        action={q.data ? <Badge tone={q.data.length ? 'warning' : 'success'}>{q.data.length} pending</Badge> : undefined}
      />
      <Card>
        <CardBody className="pt-md">
          <DataTable
            columns={columns}
            rows={q.data ?? []}
            rowKey={(r) => r.id}
            loading={q.isLoading}
            empty={<EmptyState icon={UserCheck} title="Queue is clear" description="No resident claims are waiting for review." />}
          />
        </CardBody>
      </Card>
    </>
  );
}

function humanRole(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

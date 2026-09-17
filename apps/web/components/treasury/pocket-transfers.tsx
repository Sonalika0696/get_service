'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowLeftRight, Check, X, Plus } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { pocketTransfers } from '@/lib/endpoints';
import { formatRupees, formatDate, humanizeAccountKind } from '@/lib/format';
import { POCKET_OPTIONS, TRANSFER_STATUS_META } from '@/lib/pocket';
import { ApiError } from '@/lib/api';
import type { PocketKind, PocketTransferDetail } from '@/lib/types';

/** Dual-authorised cross-pocket journal: request -> N distinct officers authorise -> the backend executes it. */
export function PocketTransfersPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const [requestOpen, setRequestOpen] = useState(false);

  const list = useQuery({ queryKey: ['pocket-transfers'], queryFn: () => pocketTransfers.list({ limit: '50' }) });
  const items = list.data?.items ?? [];

  const authorise = useMutation({
    mutationFn: (id: string) => pocketTransfers.authorise(id),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['pocket-transfers'] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      toast.show(
        t.status === 'EXECUTED' ? `Transfer executed — ${t.authorisedCount}/${t.requiredApprovers} admins signed.` : `Authorised — ${t.authorisedCount}/${t.requiredApprovers} admins signed so far.`,
        t.status === 'EXECUTED' ? 'success' : 'info',
      );
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not authorise the transfer.'),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => pocketTransfers.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pocket-transfers'] });
      toast.show('Transfer cancelled.', 'info');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not cancel the transfer.'),
  });

  const columns: Column<PocketTransferDetail>[] = [
    {
      key: 'route',
      header: 'Transfer',
      cell: (r) => (
        <div className="flex items-center gap-xs text-ink-100">
          <span>{humanizeAccountKind(r.fromKind)}</span>
          <ArrowRight className="h-3.5 w-3.5 text-ink-40" />
          <span>{humanizeAccountKind(r.toKind)}</span>
        </div>
      ),
      sortValue: (r) => r.fromKind,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (r) => <span className="tabular font-medium text-ink-100">{formatRupees(r.amount)}</span>,
      sortValue: (r) => parseFloat(r.amount) || 0,
    },
    { key: 'reasonCode', header: 'Reason', cell: (r) => <span className="text-ink-80">{r.reasonCode}</span>, sortValue: (r) => r.reasonCode },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => {
        const meta = TRANSFER_STATUS_META[r.status];
        return (
          <div className="flex items-center gap-xs">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {r.status === 'PENDING' && <span className="tabular text-caption text-ink-40">{r.authorisedCount}/{r.requiredApprovers} signed</span>}
          </div>
        );
      },
      sortValue: (r) => r.status,
    },
    { key: 'createdAt', header: 'Requested', align: 'right', cell: (r) => <span className="tabular text-ink-60">{formatDate(r.createdAt)}</span>, sortValue: (r) => r.createdAt },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        r.status === 'PENDING' ? (
          <div className="flex justify-end gap-xs">
            <Button variant="secondary" size="sm" icon={<Check className="h-4 w-4" />} loading={authorise.isPending && authorise.variables === r.id} onClick={() => authorise.mutate(r.id)}>
              Authorise
            </Button>
            <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} loading={cancel.isPending && cancel.variables === r.id} onClick={() => cancel.mutate(r.id)}>
              Cancel
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Move money between funds"
        action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setRequestOpen(true)}>New transfer</Button>}
      />
      <CardBody className="pt-md">
        <p className="mb-md text-caption text-ink-60">
          A transfer between funds needs two different admins to sign off before it moves. Whoever requests it can also authorise it as their one signature.
        </p>
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          maxHeight="360px"
          empty={<EmptyState icon={ArrowLeftRight} title="No transfers yet" description="Move surplus between funds — for example, operating to sinking — with a dual-admin sign-off." />}
        />
      </CardBody>

      <RequestTransferModal open={requestOpen} onClose={() => setRequestOpen(false)} />
    </Card>
  );
}

function RequestTransferModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [fromKind, setFromKind] = useState<PocketKind>('MAINTENANCE');
  const [toKind, setToKind] = useState<PocketKind>('SINKING');
  const [amount, setAmount] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string>();

  const request = useMutation({
    mutationFn: () =>
      pocketTransfers.request({
        fromKind,
        toKind,
        amount: Number(amount),
        reasonCode: reasonCode.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pocket-transfers'] });
      toast.success('Transfer requested. It needs another admin to authorise before it moves.');
      setAmount('');
      setReasonCode('');
      setNote('');
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not request the transfer.'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    if (fromKind === toKind) return setErr('Pick two different funds.');
    if (!amount.trim() || Number.isNaN(Number(amount)) || Number(amount) <= 0) return setErr('Enter a positive amount.');
    if (!reasonCode.trim()) return setErr('Give the transfer a reason.');
    request.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a transfer"
      description="This opens the request; it does not move money until a second admin authorises it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="transfer-form" loading={request.isPending}>Request transfer</Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={submit} className="flex flex-col gap-md">
        <div className="grid grid-cols-2 gap-md">
          <Select label="From" required options={POCKET_OPTIONS} value={fromKind} onChange={(e) => setFromKind(e.target.value as PocketKind)} />
          <Select label="To" required options={POCKET_OPTIONS} value={toKind} onChange={(e) => setToKind(e.target.value as PocketKind)} />
        </div>
        <Field label="Amount (₹)" type="number" inputMode="decimal" min={0} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Field label="Reason" required placeholder="e.g. Surplus sweep to sinking fund" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} />
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} hint="Optional context for the other admin." rows={3} />
        {err && <p role="alert" className="text-caption text-feedback-danger">{err}</p>}
      </form>
    </Modal>
  );
}

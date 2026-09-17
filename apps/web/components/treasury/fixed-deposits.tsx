'use client';

import { useState } from 'react';
import { PiggyBank, Plus, Landmark } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Select } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { formatRupees, formatDate } from '@/lib/format';
import { POCKET_OPTIONS } from '@/lib/pocket';
import type { PocketKind } from '@/lib/types';

type FdStatus = 'Active' | 'Maturing soon' | 'Matured';

interface FixedDeposit {
  id: string;
  bank: string;
  principal: number;
  rate: number;
  source: PocketKind;
  placedOn: string;
  maturesOn: string;
  status: FdStatus;
}

const INITIAL_DEPOSITS: FixedDeposit[] = [
  { id: 'fd1', bank: 'HDFC Bank', principal: 500000, rate: 7.1, source: 'CORPUS', placedOn: '2026-04-01', maturesOn: '2027-04-01', status: 'Active' },
  { id: 'fd2', bank: 'ICICI Bank', principal: 250000, rate: 6.9, source: 'SINKING', placedOn: '2025-10-15', maturesOn: '2026-10-15', status: 'Maturing soon' },
  { id: 'fd3', bank: 'SBI', principal: 150000, rate: 6.75, source: 'CORPUS', placedOn: '2025-03-20', maturesOn: '2026-03-20', status: 'Matured' },
];

const STATUS_TONE: Record<FdStatus, 'success' | 'warning' | 'neutral'> = {
  Active: 'success',
  'Maturing soon': 'warning',
  Matured: 'neutral',
};

/** Corpus fixed-deposit placements and their maturity ladder. */
export function FixedDepositsPanel() {
  const [deposits, setDeposits] = useState(INITIAL_DEPOSITS);
  const [open, setOpen] = useState(false);
  const totalPrincipal = deposits.reduce((s, d) => s + d.principal, 0);

  return (
    <Card>
      <CardHeader
        title="Fixed deposits"
        action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New deposit</Button>}
      />
      <CardBody className="pt-md">
        {deposits.length > 0 && (
          <div className="mb-md flex items-baseline gap-sm">
            <span className="text-overline uppercase text-ink-40">Total placed</span>
            <span className="tabular text-heading font-semibold text-ink-100">{formatRupees(totalPrincipal)}</span>
          </div>
        )}
        {deposits.length === 0 ? (
          <EmptyState icon={PiggyBank} title="No deposits yet" description="Park surplus corpus into a fixed deposit to start the maturity ladder." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {deposits.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-sm py-sm first:pt-0 last:pb-0">
                <div className="flex items-start gap-sm">
                  <span className="mt-[2px] flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-700/[0.08]">
                    <Landmark className="h-4 w-4 text-accent-700" />
                  </span>
                  <div>
                    <p className="font-medium text-ink-100">{d.bank}</p>
                    <p className="text-caption text-ink-40">{d.rate}% p.a. · matures {formatDate(d.maturesOn)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-sm">
                  <span className="tabular font-semibold text-ink-100">{formatRupees(d.principal)}</span>
                  <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <NewDepositModal open={open} onClose={() => setOpen(false)} onCreate={(fd) => setDeposits((prev) => [fd, ...prev])} />
    </Card>
  );
}

function NewDepositModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (fd: FixedDeposit) => void }) {
  const toast = useToast();
  const [bank, setBank] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('7.0');
  const [source, setSource] = useState<PocketKind>('CORPUS');
  const [err, setErr] = useState<string>();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    if (!bank.trim()) return setErr('Name the bank.');
    if (!principal.trim() || Number(principal) <= 0) return setErr('Enter a positive principal.');

    const placedOn = new Date();
    const maturesOn = new Date(placedOn);
    maturesOn.setFullYear(maturesOn.getFullYear() + 1);

    onCreate({
      id: `fd-${Date.now()}`,
      bank: bank.trim(),
      principal: Number(principal),
      rate: Number(rate) || 0,
      source,
      placedOn: placedOn.toISOString(),
      maturesOn: maturesOn.toISOString(),
      status: 'Active',
    });
    toast.success(`Placed ${formatRupees(Number(principal))} with ${bank.trim()}. Needs a second admin to countersign.`);
    setBank('');
    setPrincipal('');
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Place a fixed deposit"
      description="Two admins must approve each placement before funds move."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="fd-form">Place deposit</Button>
        </>
      }
    >
      <form id="fd-form" onSubmit={submit} className="flex flex-col gap-md">
        <Field label="Bank" required placeholder="e.g. HDFC Bank" value={bank} onChange={(e) => setBank(e.target.value)} />
        <div className="grid grid-cols-2 gap-md">
          <Field label="Principal (₹)" type="number" inputMode="decimal" min={0} required value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          <Field label="Rate (% p.a.)" type="number" inputMode="decimal" min={0} value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <Select label="Source fund" required options={POCKET_OPTIONS} value={source} onChange={(e) => setSource(e.target.value as PocketKind)} />
        {err && <p role="alert" className="text-caption text-feedback-danger">{err}</p>}
      </form>
    </Modal>
  );
}

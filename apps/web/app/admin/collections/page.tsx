'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Wallet,
  Hourglass,
  Inbox,
  Lock,
  Clock,
  ArrowLeftRight,
  FileClock,
  Upload,
  Download,
  Check,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Tabs } from '@/components/ui/tabs';
import { Field, Select, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { DataTable, type Column } from '@/components/ui/data-table';
import { useToast } from '@/components/ui/toast';
import { collections, bankStatements } from '@/lib/endpoints';
import { BASE } from '@/lib/api';
import { getIdentity } from '@/lib/session';
import { formatRupees, formatDate } from '@/lib/format';
import { POCKET_OPTIONS, BANK_LINE_STATUS_META } from '@/lib/pocket';
import { staggerContainer } from '@/lib/motion';
import { ApiError } from '@/lib/api';
import type { BankStatementLineDetail, BankStatementLineStatus, PocketKind } from '@/lib/types';

type Tab = 'reconciliation' | 'arrears';
type LineTab = 'UNMATCHED' | 'MATCHED' | 'ALLOCATED' | 'IGNORED';

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
        <div className="space-y-lg">
          {/* Daily reconciliation snapshot is TREASURER-only; the statement queue below is COMMITTEE too, so it isn't gated on the same 403. */}
          {forbidden ? (
            <Card>
              <EmptyState
                icon={Lock}
                title="Treasurer access required"
                description="The daily reconciliation snapshot is limited to the treasurer. Bank matching below is open to any administrator."
              />
            </Card>
          ) : (
            <>
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
                className="grid grid-cols-1 gap-md sm:grid-cols-2"
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
              </motion.div>
            </>
          )}

          <BankStatementQueue />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
          <OverdueDuesCard />
          <PaymentStatusCard />
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------- overdue dues --- */

interface ArrearsRow {
  flat: string;
  resident: string;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90plus: number;
}

const ARREARS: ArrearsRow[] = [
  { flat: 'A-101', resident: 'Rahul Nair', b0_30: 5000, b31_60: 0, b61_90: 0, b90plus: 0 },
  { flat: 'A-204', resident: 'Priya Menon', b0_30: 5000, b31_60: 5000, b61_90: 0, b90plus: 0 },
  { flat: 'B-112', resident: 'Vikram Shah', b0_30: 0, b31_60: 0, b61_90: 5000, b90plus: 5000 },
  { flat: 'B-305', resident: 'Meera Iyer', b0_30: 5000, b31_60: 0, b61_90: 0, b90plus: 0 },
];

function OverdueDuesCard() {
  const total = (r: ArrearsRow) => r.b0_30 + r.b31_60 + r.b61_90 + r.b90plus;
  const grandTotal = ARREARS.reduce((s, r) => s + total(r), 0);

  return (
    <Card>
      <CardHeader title="Overdue dues" action={<Badge tone="warning"><Hourglass className="h-3.5 w-3.5" />{formatRupees(grandTotal)} outstanding</Badge>} />
      <CardBody className="pt-md">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border-divider text-overline uppercase text-ink-40">
                <th className="px-sm py-xs">Flat</th>
                <th className="px-sm py-xs text-right">0-30d</th>
                <th className="px-sm py-xs text-right">31-60d</th>
                <th className="px-sm py-xs text-right">61-90d</th>
                <th className="px-sm py-xs text-right">90+d</th>
              </tr>
            </thead>
            <tbody>
              {ARREARS.map((r) => (
                <tr key={r.flat} className="border-b border-border-subtle last:border-0">
                  <td className="px-sm py-sm">
                    <p className="font-medium text-ink-100">{r.flat}</p>
                    <p className="text-caption text-ink-40">{r.resident}</p>
                  </td>
                  <td className="tabular px-sm py-sm text-right text-ink-80">{r.b0_30 ? formatRupees(r.b0_30) : '—'}</td>
                  <td className="tabular px-sm py-sm text-right text-ink-80">{r.b31_60 ? formatRupees(r.b31_60) : '—'}</td>
                  <td className={`tabular px-sm py-sm text-right ${r.b61_90 ? 'font-medium text-feedback-warning' : 'text-ink-80'}`}>{r.b61_90 ? formatRupees(r.b61_90) : '—'}</td>
                  <td className={`tabular px-sm py-sm text-right ${r.b90plus ? 'font-semibold text-feedback-danger' : 'text-ink-80'}`}>{r.b90plus ? formatRupees(r.b90plus) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------- payment status --- */

interface StatusRow {
  flat: string;
  category: string;
  due: number;
  collected: number;
}

const STATUS_ROWS: StatusRow[] = [
  { flat: 'A-101', category: 'Maintenance', due: 5000, collected: 5000 },
  { flat: 'A-204', category: 'Maintenance', due: 5000, collected: 0 },
  { flat: 'B-112', category: 'Electricity', due: 2100, collected: 2100 },
  { flat: 'B-305', category: 'Water', due: 800, collected: 800 },
];

function PaymentStatusCard() {
  const totalDue = STATUS_ROWS.reduce((s, r) => s + r.due, 0);
  const totalCollected = STATUS_ROWS.reduce((s, r) => s + r.collected, 0);
  const rate = totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 0;

  return (
    <Card>
      <CardHeader title="Who's paid, by flat" action={<Badge tone={rate >= 90 ? 'success' : 'warning'}>{rate}% collected</Badge>} />
      <CardBody className="pt-md">
        <ul className="divide-y divide-border-subtle">
          {STATUS_ROWS.map((r, i) => {
            const paid = r.collected >= r.due;
            return (
              <li key={i} className="flex items-center justify-between gap-sm py-sm first:pt-0 last:pb-0">
                <div>
                  <p className="font-medium text-ink-100">{r.flat}</p>
                  <p className="text-caption text-ink-40">{r.category}</p>
                </div>
                <div className="flex items-center gap-sm">
                  <span className="tabular text-caption text-ink-60">{formatRupees(r.collected)} / {formatRupees(r.due)}</span>
                  <Badge tone={paid ? 'success' : 'warning'}>{paid ? 'Paid' : 'Due'}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------ bank-statement import queue --- */

function BankStatementQueue() {
  const toast = useToast();
  const qc = useQueryClient();
  const [lineTab, setLineTab] = useState<LineTab>('UNMATCHED');
  const [ingestOpen, setIngestOpen] = useState(false);
  const [allocateLine, setAllocateLine] = useState<BankStatementLineDetail | null>(null);

  const lines = useQuery({
    queryKey: ['bank-statement-lines', lineTab],
    queryFn: () => bankStatements.lines({ status: lineTab, limit: '50' }),
  });

  const ignore = useMutation({
    mutationFn: (id: string) => bankStatements.ignore(id),
    onSuccess: () => {
      toast.show('Line ignored.', 'info');
      qc.invalidateQueries({ queryKey: ['bank-statement-lines'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not ignore the line.'),
  });

  const items = lines.data?.items ?? [];

  const columns: Column<BankStatementLineDetail>[] = [
    { key: 'valueDate', header: 'Date', cell: (r) => <span className="tabular text-ink-80">{formatDate(r.valueDate)}</span>, sortValue: (r) => r.valueDate },
    {
      key: 'narration',
      header: 'Narration',
      cell: (r) => (
        <div>
          <p className="text-ink-100">{r.narration}</p>
          {r.reference && <p className="font-mono text-caption text-ink-40">{r.reference}</p>}
        </div>
      ),
      sortValue: (r) => r.narration,
    },
    { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular font-medium text-ink-100">{formatRupees(r.amount)}</span>, sortValue: (r) => parseFloat(r.amount) || 0 },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => {
        const meta = BANK_LINE_STATUS_META[r.status];
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
      sortValue: (r) => r.status,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        r.status === 'UNMATCHED' || r.status === 'MATCHED' ? (
          <div className="flex justify-end gap-xs">
            <Button variant="secondary" size="sm" icon={<Check className="h-4 w-4" />} onClick={() => setAllocateLine(r)}>
              Allocate
            </Button>
            <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} loading={ignore.isPending && ignore.variables === r.id} onClick={() => ignore.mutate(r.id)}>
              Ignore
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Bank statement import"
        action={
          <div className="flex gap-xs">
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="h-4 w-4" />}
              onClick={() => window.open(`${BASE}/bank-statements/export`, '_blank')}
            >
              Export
            </Button>
            <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setIngestOpen(true)}>
              Import statement
            </Button>
          </div>
        }
      />
      <CardBody className="pt-md">
        <div className="mb-md">
          <Tabs
            value={lineTab}
            onChange={(k) => setLineTab(k as LineTab)}
            tabs={[
              { key: 'UNMATCHED', label: 'Unmatched' },
              { key: 'MATCHED', label: 'Matched' },
              { key: 'ALLOCATED', label: 'Allocated' },
              { key: 'IGNORED', label: 'Ignored' },
            ]}
          />
        </div>
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          loading={lines.isLoading}
          maxHeight="420px"
          empty={
            <EmptyState
              icon={Inbox}
              title={lineTab === 'UNMATCHED' ? 'No unmatched credits' : `No ${BANK_LINE_STATUS_META[lineTab].label.toLowerCase()} lines`}
              description={lineTab === 'UNMATCHED' ? 'Import a bank statement to populate the review queue.' : undefined}
            />
          }
        />
      </CardBody>

      <IngestModal open={ingestOpen} onClose={() => setIngestOpen(false)} />
      {allocateLine && <AllocateModal line={allocateLine} onClose={() => setAllocateLine(null)} />}
    </Card>
  );
}

const CSV_PLACEHOLDER = `valuedate,amount,narration,reference
2026-09-01,18000.00,NEFT FROM A-101 RAHUL NAIR,UTR2609011234
2026-09-01,2500.00,UPI/owner2/maintenance,UPI/998877`;

function IngestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [err, setErr] = useState<string>();

  const ingest = useMutation({
    mutationFn: () => bankStatements.ingest(csv),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['bank-statement-lines'] });
      toast.success(`Imported ${r.ingested} lines (${r.matched} matched, ${r.unmatched} unmatched).`);
      setCsv('');
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Import failed.'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import bank statement"
      description="Paste the statement as CSV. Rows are matched to a flat by narration where possible; unmatched credits queue for manual allocation."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={ingest.isPending} disabled={!csv.trim()} onClick={() => { setErr(undefined); ingest.mutate(); }}>
            Import
          </Button>
        </>
      }
    >
      <Textarea
        label="CSV"
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={CSV_PLACEHOLDER}
        error={err}
        hint="Columns: valuedate, amount, narration, reference. Rows that fail validation are skipped, not the whole file."
        rows={8}
      />
    </Modal>
  );
}

function AllocateModal({ line, onClose }: { line: BankStatementLineDetail; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [pocketKind, setPocketKind] = useState<PocketKind>('MAINTENANCE');
  const [flatId, setFlatId] = useState(line.matchedFlatId ?? '');
  const [err, setErr] = useState<string>();

  const allocate = useMutation({
    mutationFn: () => bankStatements.allocate(line.id, { pocketKind, flatId: flatId.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-statement-lines'] });
      toast.success(`Allocated ${formatRupees(line.amount)} to ${pocketKind}.`);
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not allocate.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Allocate credit"
      description={`${formatRupees(line.amount)} · ${line.narration}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={allocate.isPending} onClick={() => { setErr(undefined); allocate.mutate(); }}>Allocate</Button>
        </>
      }
    >
      <div className="flex flex-col gap-md">
        <Select label="Fund" required options={POCKET_OPTIONS} value={pocketKind} onChange={(e) => setPocketKind(e.target.value as PocketKind)} />
        <Field
          label="Flat ID"
          value={flatId}
          onChange={(e) => setFlatId(e.target.value)}
          hint={line.matchedFlatId ? 'Pre-filled from the statement match. Clear it to allocate at the society level instead.' : 'Optional — leave blank for a society-level credit (e.g. interest, a refund) with no single flat.'}
          error={err}
        />
      </div>
    </Modal>
  );
}

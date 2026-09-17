'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Receipt, Plus, Pencil, Trash2, Send, RefreshCw, Lock, CalendarClock, History } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { pricing } from '@/lib/endpoints';
import { ApiError } from '@/lib/api';
import { VENDOR_CATEGORY_PRESETS } from '@/lib/vendor';
import { BASIS_OPTIONS, STATUS_META, formatRate } from '@/lib/pricing';
import { formatRupees, formatDate } from '@/lib/format';
import { staggerContainer, riseItem } from '@/lib/motion';
import type { PricingBasis, PricingCardDetail, PricingLine } from '@/lib/types';

/** ISO date-time from a <input type="date"> value (midnight, local). */
function dateToIso(d: string): string {
  return new Date(`${d}T00:00:00`).toISOString();
}
function isoToDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export default function PricingPage() {
  const toast = useToast();
  const cards = useQuery({ queryKey: ['pricingMine'], queryFn: pricing.mine });
  const [createOpen, setCreateOpen] = useState(false);

  // Group cards by category, newest version first within each.
  const groups = useMemo(() => {
    const byCat = new Map<string, PricingCardDetail[]>();
    for (const c of cards.data ?? []) {
      const list = byCat.get(c.category) ?? [];
      list.push(c);
      byCat.set(c.category, list);
    }
    return [...byCat.entries()]
      .map(([category, list]) => ({
        category,
        list: [...list].sort((a, b) => b.version - a.version),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [cards.data]);

  return (
    <>
      <PageHeader
        title="Pricing cards"
        subtitle="Publish a versioned price sheet per category. Published cards are locked; a revision opens the next version."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            New pricing card
          </Button>
        }
      />

      {cards.isLoading ? (
        <div className="space-y-lg">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="p-lg">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-md h-24 w-full" />
            </Card>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title="No pricing cards yet"
            description="Publish your first price sheet so societies can see your rates before they engage you."
            action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>New pricing card</Button>}
          />
        </Card>
      ) : (
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-lg">
          {groups.map((g) => (
            <CategoryBlock key={g.category} category={g.category} cards={g.list} />
          ))}
        </motion.div>
      )}

      <CreateCardModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        existingCategories={groups.map((g) => g.category)}
        onCreated={() => {
          toast.success('Draft card created. Add your lines, then publish.');
          setCreateOpen(false);
        }}
      />
    </>
  );
}

/* ---------------------------------------------------- one category --- */

function CategoryBlock({ category, cards }: { category: string; cards: PricingCardDetail[] }) {
  const current = cards.find((c) => c.status === 'PUBLISHED' && !c.supersededAt);
  const draft = cards.find((c) => c.status === 'DRAFT');
  const history = cards.filter((c) => c.status === 'PUBLISHED' && c.supersededAt);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <motion.div variants={riseItem}>
      <div className="mb-sm flex items-center gap-sm">
        <h3 className="text-heading font-semibold text-ink-100">{category}</h3>
        {current && <Badge tone="success">v{current.version} live</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-md xl:grid-cols-2">
        {draft && <PricingCardView card={draft} editable />}
        {current && <PricingCardView card={current} />}
        {!draft && !current && cards[0] && <PricingCardView card={cards[0]} />}
      </div>

      {history.length > 0 && (
        <div className="mt-sm">
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="inline-flex items-center gap-xs text-caption text-ink-60 transition-colors hover:text-ink-80"
          >
            <History className="h-4 w-4" />
            {showHistory ? 'Hide' : 'Show'} {history.length} superseded {history.length === 1 ? 'version' : 'versions'}
          </button>
          {showHistory && (
            <div className="mt-sm grid grid-cols-1 gap-md xl:grid-cols-2">
              {history
                .sort((a, b) => b.version - a.version)
                .map((c) => (
                  <PricingCardView key={c.id} card={c} />
                ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------ one card --- */

function PricingCardView({ card, editable = false }: { card: PricingCardDetail; editable?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const status = STATUS_META[card.status];
  const superseded = card.status === 'PUBLISHED' && !!card.supersededAt;

  const [lineModal, setLineModal] = useState<{ mode: 'add' } | { mode: 'edit'; line: PricingLine } | null>(null);
  const [reviseOpen, setReviseOpen] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['pricingMine'] });

  const publish = useMutation({
    mutationFn: () => pricing.publish(card.id),
    onSuccess: () => {
      toast.success(`Card published as v${card.version}. It is now live for residents.`);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Publish failed.'),
  });

  const deleteLine = useMutation({
    mutationFn: (lineId: string) => pricing.deleteLine(card.id, lineId),
    onSuccess: () => {
      toast.show('Line removed.', 'info');
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not remove the line.'),
  });

  const tone = superseded ? 'neutral' : status.tone;
  const label = superseded ? `v${card.version} superseded` : `${status.label} v${card.version}`;

  return (
    <Card className={superseded ? 'opacity-70' : undefined}>
      <div className="flex items-start justify-between gap-sm border-b border-border-subtle px-lg py-md">
        <div className="min-w-0">
          <div className="flex items-center gap-xs">
            <Badge tone={tone}>{label}</Badge>
            <span className="tabular text-caption text-ink-60">GST {String(card.gstRatePct)}%</span>
          </div>
          <p className="mt-xxs flex items-center gap-xs text-caption text-ink-40">
            <CalendarClock className="h-3.5 w-3.5" />
            Effective {formatDate(card.effectiveFrom)}
            {card.publishedAt && ` · published ${formatDate(card.publishedAt)}`}
          </p>
        </div>
        {editable ? (
          <Button size="sm" icon={<Send className="h-4 w-4" />} loading={publish.isPending} disabled={card.lines.length === 0} onClick={() => publish.mutate()}>
            Publish
          </Button>
        ) : !superseded && card.status === 'PUBLISHED' ? (
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setReviseOpen(true)}>
            Revise
          </Button>
        ) : null}
      </div>

      <CardBody className="pt-md">
        {card.lines.length === 0 ? (
          <EmptyState icon={Receipt} title="No lines yet" description={editable ? 'Add at least one line before publishing.' : 'This card has no priced lines.'} />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {card.lines.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-sm py-sm first:pt-0">
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink-100">{line.label}</p>
                  <p className="tabular text-caption text-ink-60">
                    {formatRate(line.rate, line.basis)}
                    {line.minimum != null && ` · min ${formatRupees(line.minimum)}`}
                  </p>
                  {line.conditions && <p className="mt-xxs text-caption text-ink-40">{line.conditions}</p>}
                </div>
                {editable && (
                  <div className="flex shrink-0 items-center gap-xxs">
                    <IconButton label="Edit line" onClick={() => setLineModal({ mode: 'edit', line })}>
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Remove line" onClick={() => deleteLine.mutate(line.id)} disabled={deleteLine.isPending}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {editable && (
          <Button variant="ghost" size="sm" className="mt-md" icon={<Plus className="h-4 w-4" />} onClick={() => setLineModal({ mode: 'add' })}>
            Add line
          </Button>
        )}

        {!editable && card.status === 'PUBLISHED' && !superseded && (
          <p className="mt-md flex items-center gap-xs text-caption text-ink-40">
            <Lock className="h-3.5 w-3.5" /> Published cards are locked. Use Revise to change rates.
          </p>
        )}
      </CardBody>

      {lineModal && (
        <LineModal
          cardId={card.id}
          initial={lineModal.mode === 'edit' ? lineModal.line : undefined}
          onClose={() => setLineModal(null)}
          onSaved={() => setLineModal(null)}
        />
      )}
      {reviseOpen && <ReviseModal card={card} onClose={() => setReviseOpen(false)} />}
    </Card>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-40 transition-colors hover:bg-bg-secondary hover:text-ink-80 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------- modals --- */

function CreateCardModal({
  open,
  onClose,
  existingCategories,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  existingCategories: string[];
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [category, setCategory] = useState('');
  const [gst, setGst] = useState('18');
  const [effective, setEffective] = useState(() => new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string>();

  const create = useMutation({
    mutationFn: () => pricing.create({ category: category.trim(), gstRatePct: Number(gst), effectiveFrom: dateToIso(effective) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricingMine'] });
      setCategory('');
      onCreated();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not create the card.'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    if (!category.trim()) {
      setErr('Choose a category.');
      return;
    }
    if (existingCategories.some((c) => c.toLowerCase() === category.trim().toLowerCase())) {
      setErr('A card already exists for this category. Revise it instead of creating a new one.');
      return;
    }
    create.mutate();
  }

  const presetOptions = [
    { value: '', label: 'Select a category' },
    ...VENDOR_CATEGORY_PRESETS.filter((c) => !existingCategories.some((e) => e.toLowerCase() === c.toLowerCase())).map((c) => ({ value: c, label: c })),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New pricing card"
      description="This starts a draft at version 1. Add your lines next, then publish."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="create-card-form" loading={create.isPending}>Create draft</Button>
        </>
      }
    >
      <form id="create-card-form" onSubmit={submit} className="flex flex-col gap-md">
        <Select
          label="Category"
          required
          options={presetOptions}
          value={presetOptions.some((o) => o.value === category) ? category : ''}
          onChange={(e) => setCategory(e.target.value)}
        />
        <Field
          label="Or type a category"
          placeholder="e.g. Solar maintenance"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          hint="Pick from the list above or type your own."
        />
        <div className="grid grid-cols-2 gap-md">
          <Field label="GST rate (%)" type="number" inputMode="decimal" min={0} max={100} required value={gst} onChange={(e) => setGst(e.target.value)} />
          <Field label="Effective from" type="date" required value={effective} onChange={(e) => setEffective(e.target.value)} />
        </div>
        {err && <p role="alert" className="text-caption text-feedback-danger">{err}</p>}
      </form>
    </Modal>
  );
}

function LineModal({
  cardId,
  initial,
  onClose,
  onSaved,
}: {
  cardId: string;
  initial?: PricingLine;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [label, setLabel] = useState(initial?.label ?? '');
  const [basis, setBasis] = useState<PricingBasis>(initial?.basis ?? 'PER_VISIT');
  const [rate, setRate] = useState(initial ? String(initial.rate) : '');
  const [minimum, setMinimum] = useState(initial?.minimum != null ? String(initial.minimum) : '');
  const [conditions, setConditions] = useState(initial?.conditions ?? '');
  const [err, setErr] = useState<string>();

  const save = useMutation({
    mutationFn: () => {
      const minVal = minimum.trim() === '' ? undefined : Number(minimum);
      if (initial) {
        return pricing.updateLine(cardId, initial.id, {
          label: label.trim(),
          basis,
          rate: Number(rate),
          minimum: minVal ?? null,
          conditions: conditions.trim() || null,
        });
      }
      return pricing.addLine(cardId, {
        label: label.trim(),
        basis,
        rate: Number(rate),
        ...(minVal !== undefined ? { minimum: minVal } : {}),
        ...(conditions.trim() ? { conditions: conditions.trim() } : {}),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricingMine'] });
      toast.success(initial ? 'Line updated.' : 'Line added.');
      onSaved();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not save the line.'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    if (!label.trim()) return setErr('Give the line a label.');
    if (rate.trim() === '' || Number.isNaN(Number(rate))) return setErr('Enter a numeric rate.');
    save.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit line' : 'Add line'}
      description="Lines can only be changed while the card is a draft."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="line-form" loading={save.isPending}>{initial ? 'Save line' : 'Add line'}</Button>
        </>
      }
    >
      <form id="line-form" onSubmit={submit} className="flex flex-col gap-md">
        <Field label="Label" required placeholder="e.g. Visit charge" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="grid grid-cols-2 gap-md">
          <Select label="Basis" required options={BASIS_OPTIONS} value={basis} onChange={(e) => setBasis(e.target.value as PricingBasis)} />
          <Field
            label={basis === 'PERCENTAGE' ? 'Rate (%)' : 'Rate (₹)'}
            type="number"
            inputMode="decimal"
            min={0}
            required
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
        <Field
          label="Minimum charge (₹)"
          type="number"
          inputMode="decimal"
          min={0}
          value={minimum}
          onChange={(e) => setMinimum(e.target.value)}
          hint="Optional. A floor applied regardless of the rate."
        />
        <Textarea label="Conditions" placeholder="Optional notes shown with this line" value={conditions} onChange={(e) => setConditions(e.target.value)} />
        {err && <p role="alert" className="text-caption text-feedback-danger">{err}</p>}
      </form>
    </Modal>
  );
}

function ReviseModal({ card, onClose }: { card: PricingCardDetail; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [gst, setGst] = useState(String(card.gstRatePct));
  const [effective, setEffective] = useState(() => isoToDateInput(card.effectiveFrom));
  const [err, setErr] = useState<string>();

  const revise = useMutation({
    mutationFn: () => pricing.revise(card.id, { gstRatePct: Number(gst), effectiveFrom: dateToIso(effective) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricingMine'] });
      toast.success(`Draft v${card.version + 1} opened. Adjust lines, then publish.`);
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not open a revision.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Revise ${card.category}`}
      description={`This opens draft v${card.version + 1}, copied from the current lines. The live card stays untouched until you publish.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="revise-form" loading={revise.isPending}>Open revision</Button>
        </>
      }
    >
      <form id="revise-form" onSubmit={(e) => { e.preventDefault(); setErr(undefined); revise.mutate(); }} className="flex flex-col gap-md">
        <div className="grid grid-cols-2 gap-md">
          <Field label="GST rate (%)" type="number" inputMode="decimal" min={0} max={100} required value={gst} onChange={(e) => setGst(e.target.value)} />
          <Field label="Effective from" type="date" required value={effective} onChange={(e) => setEffective(e.target.value)} />
        </div>
        {err && <p role="alert" className="text-caption text-feedback-danger">{err}</p>}
      </form>
    </Modal>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Repeat } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Field, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { LadderEditor } from './ladder-editor';
import { committee, pooling } from '@/lib/endpoints';
import { VENDOR_CATEGORY_PRESETS } from '@/lib/vendor';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { DiscountRung } from '@/lib/types';

/** Default the deadline to 7 days out, at local midday, as an ISO string. */
function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

export function CreateOfferModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => committee.listVendors(), enabled: open });

  const [vendorId, setVendorId] = useState('');
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [ladder, setLadder] = useState<DiscountRung[]>([{ minN: 5, pct: 10 }]);
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [weekly, setWeekly] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const categoryOptions = useMemo(() => {
    const fromVendor = vendors.data?.find((v) => v.id === vendorId)?.categories ?? [];
    return Array.from(new Set([...fromVendor, ...VENDOR_CATEGORY_PRESETS]));
  }, [vendors.data, vendorId]);

  function reset() {
    setVendorId('');
    setCategory('');
    setTitle('');
    setDescription('');
    setUnitPrice('');
    setLadder([{ minN: 5, pct: 10 }]);
    setDeadline(defaultDeadline());
    setWeekly(false);
    setErrors({});
  }

  const mutation = useMutation({
    mutationFn: () =>
      pooling.createOffer({
        vendorId,
        category: category.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        unitPrice: Number(unitPrice),
        discountLadder: ladder,
        deadline: new Date(deadline).toISOString(),
        recurring: weekly ? 'WEEKLY' : 'NONE',
      }),
    onSuccess: (o) => {
      toast.success(`Offer "${o.title}" posted.`);
      qc.invalidateQueries({ queryKey: ['offers'] });
      reset();
      onClose();
    },
    onError: (e) => setErrors({ form: e instanceof ApiError ? e.message : 'Could not post the offer.' }),
  });

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!vendorId) next.vendorId = 'Choose the vendor this offer sources from.';
    if (!category.trim()) next.category = 'A category is required.';
    if (title.trim().length < 3) next.title = 'Give the offer a clear title.';
    if (!unitPrice || Number(unitPrice) <= 0) next.unitPrice = 'Enter a unit price in rupees.';
    if (ladder.length === 0) next.ladder = 'Add at least one discount rung.';
    if (ladder.some((r) => r.minN < 1)) next.ladder = 'Each rung needs a participant count of 1 or more.';
    if (new Date(deadline).getTime() <= Date.now()) next.deadline = 'The deadline must be in the future.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Post a committee offer"
      description="A top-down group offer against a vendor. Residents commit until the threshold fires."
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button icon={<Megaphone className="h-4 w-4" />} loading={mutation.isPending} onClick={() => validate() && mutation.mutate()}>
            Post offer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-md">
        {errors.form && (
          <p role="alert" className="rounded-md bg-feedback-dangerTint px-sm py-xs text-caption text-feedback-danger">{errors.form}</p>
        )}

        <div className="flex flex-col gap-xxs">
          <label className="text-caption font-medium text-ink-80">Vendor<span className="ml-1 text-feedback-danger">*</span></label>
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className={cn(
              'h-11 w-full rounded-md border bg-bg-elevated px-sm text-body text-ink-100',
              'focus:outline-none focus:ring-2 focus:ring-accent-700/30',
              errors.vendorId ? 'border-feedback-danger' : 'border-border-divider focus:border-accent-700',
            )}
          >
            <option value="">{vendors.isLoading ? 'Loading vendors…' : 'Select a vendor'}</option>
            {vendors.data?.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          {errors.vendorId && <p className="text-caption text-feedback-danger">{errors.vendorId}</p>}
        </div>

        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <div className="flex flex-col gap-xxs">
            <label className="text-caption font-medium text-ink-80">Category<span className="ml-1 text-feedback-danger">*</span></label>
            <input
              list="offer-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="AC service"
              className={cn(
                'h-11 w-full rounded-md border bg-bg-elevated px-sm text-body text-ink-100 placeholder:text-ink-40',
                'focus:outline-none focus:ring-2 focus:ring-accent-700/30',
                errors.category ? 'border-feedback-danger' : 'border-border-divider focus:border-accent-700',
              )}
            />
            <datalist id="offer-categories">
              {categoryOptions.map((c) => <option key={c} value={c} />)}
            </datalist>
            {errors.category && <p className="text-caption text-feedback-danger">{errors.category}</p>}
          </div>
          <Field
            label="Unit price (₹)"
            required
            inputMode="decimal"
            placeholder="1500"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value.replace(/[^\d.]/g, ''))}
            error={errors.unitPrice}
          />
        </div>

        <Field label="Title" required placeholder="Annual lift AMC" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} hint="Optional. What the offer covers." />

        <LadderEditor value={ladder} onChange={setLadder} />
        {errors.ladder && <p className="-mt-xs text-caption text-feedback-danger">{errors.ladder}</p>}

        <Field label="Deadline" type="datetime-local" required value={deadline} onChange={(e) => setDeadline(e.target.value)} error={errors.deadline} />

        <button
          type="button"
          onClick={() => setWeekly((v) => !v)}
          className={cn(
            'flex items-center justify-between rounded-md border p-sm text-left transition-colors',
            weekly ? 'border-accent-700 bg-accent-700/[0.06]' : 'border-border-divider hover:bg-bg-secondary',
          )}
        >
          <span className="flex items-center gap-sm">
            <Repeat className={cn('h-4 w-4', weekly ? 'text-accent-700' : 'text-ink-40')} />
            <span>
              <span className="block text-body text-ink-100">Weekly recurring</span>
              <span className="block text-caption text-ink-40">Can be rolled into a fresh offer after the deadline.</span>
            </span>
          </span>
          <span className={cn('h-5 w-9 rounded-pill p-[2px] transition-colors', weekly ? 'bg-accent-700' : 'bg-ink-20')}>
            <span className={cn('block h-4 w-4 rounded-pill bg-white transition-transform', weekly && 'translate-x-4')} />
          </span>
        </button>
      </div>
    </Modal>
  );
}

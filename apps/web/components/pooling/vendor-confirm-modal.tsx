'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Snowflake } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Field } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { LadderEditor } from './ladder-editor';
import { pooling } from '@/lib/endpoints';
import { ApiError } from '@/lib/api';
import type { DiscountRung, ResidentPollDetail } from '@/lib/types';

/**
 * Committee confirms the terms a resident-initiated poll fires under, acting
 * for the tagged vendor (no vendor login in v1). Confirmation freezes the
 * card against the pool.
 */
export function VendorConfirmModal({ poll, onClose }: { poll: ResidentPollDetail | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [confirmedMinimum, setConfirmedMinimum] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [ladder, setLadder] = useState<DiscountRung[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Seed the minimum from the resident's proposal when a poll is opened.
  useEffect(() => {
    if (poll) {
      const seed = poll.minCommitments ?? poll.vendorConfirmedMinimum ?? null;
      setConfirmedMinimum(seed ? String(seed) : '');
    }
  }, [poll]);

  function reset() {
    setConfirmedMinimum('');
    setUnitPrice('');
    setLadder([]);
    setErrors({});
  }

  const confirm = useMutation({
    mutationFn: () =>
      pooling.vendorConfirm(poll!.id, {
        confirmedMinimum: Number(confirmedMinimum),
        unitPrice: Number(unitPrice),
        discountLadder: ladder.length ? ladder : undefined,
      }),
    onSuccess: (p) => {
      toast.success(p.status === 'FIRED' ? 'Confirmed. Threshold already met — pool fired.' : 'Terms confirmed and card frozen.');
      qc.invalidateQueries({ queryKey: ['polls'] });
      qc.invalidateQueries({ queryKey: ['poll', poll?.id] });
      reset();
      onClose();
    },
    onError: (e) => setErrors({ form: e instanceof ApiError ? e.message : 'Could not confirm.' }),
  });

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!confirmedMinimum || Number(confirmedMinimum) < 1) next.confirmedMinimum = 'Confirm the minimum participant count.';
    if (!unitPrice || Number(unitPrice) <= 0) next.unitPrice = 'Enter the unit price in rupees.';
    if (ladder.some((r) => r.minN < 1)) next.ladder = 'Each rung needs a participant count of 1 or more.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  return (
    <Modal
      open={!!poll}
      onClose={() => { reset(); onClose(); }}
      title="Confirm vendor terms"
      description={poll ? `Sourcing "${poll.title}". Confirmation freezes the card against the pool.` : ''}
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button icon={<Snowflake className="h-4 w-4" />} loading={confirm.isPending} onClick={() => validate() && confirm.mutate()}>
            Confirm and freeze
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-md">
        {errors.form && (
          <p role="alert" className="rounded-md bg-feedback-dangerTint px-sm py-xs text-caption text-feedback-danger">{errors.form}</p>
        )}
        {poll && (
          <div className="rounded-lg border border-border-subtle bg-bg-secondary p-md text-caption text-ink-60">
            Resident proposed a minimum of{' '}
            <span className="font-semibold text-ink-100">{poll.minCommitments ?? '—'}</span>. Current commitments:{' '}
            <span className="font-semibold text-ink-100">{poll.commitmentCount}</span>.
          </div>
        )}
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field
            label="Confirmed minimum"
            required
            inputMode="numeric"
            placeholder="8"
            value={confirmedMinimum}
            onChange={(e) => setConfirmedMinimum(e.target.value.replace(/\D/g, ''))}
            error={errors.confirmedMinimum}
          />
          <Field
            label="Unit price (₹)"
            required
            inputMode="decimal"
            placeholder="1200"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value.replace(/[^\d.]/g, ''))}
            error={errors.unitPrice}
          />
        </div>
        <LadderEditor value={ladder} onChange={setLadder} optional />
        {errors.ladder && <p className="-mt-xs text-caption text-feedback-danger">{errors.ladder}</p>}
      </div>
    </Modal>
  );
}

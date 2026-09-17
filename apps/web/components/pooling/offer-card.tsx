'use client';

import { motion } from 'framer-motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Repeat, RotateCw, Tag, Clock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ThresholdBar } from '@/components/ui/progress';
import { useToast } from '@/components/ui/toast';
import { pooling } from '@/lib/endpoints';
import { OFFER_STATUS_META, describeLadder } from '@/lib/pooling';
import { formatRupees, relativeDeadline } from '@/lib/format';
import { riseItem } from '@/lib/motion';
import { ApiError } from '@/lib/api';
import type { OfferDetail } from '@/lib/types';

export function OfferCard({ offer, vendorName }: { offer: OfferDetail; vendorName?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const meta = OFFER_STATUS_META[offer.status];
  const canRoll = offer.recurring === 'WEEKLY' && offer.status === 'EXPIRED';

  const roll = useMutation({
    mutationFn: () => pooling.rollOffer(offer.id),
    onSuccess: () => {
      toast.success('Offer rolled into a fresh week.');
      qc.invalidateQueries({ queryKey: ['offers'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not roll the offer.'),
  });

  return (
    <motion.div variants={riseItem}>
      <Card className="flex h-full flex-col gap-md p-lg">
        <div className="flex items-start justify-between gap-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-xs">
              <Badge tone="accent"><Tag className="h-3.5 w-3.5" />{offer.category}</Badge>
              {offer.recurring === 'WEEKLY' && (
                <span className="inline-flex items-center gap-xxs text-caption text-ink-40"><Repeat className="h-3.5 w-3.5" />Weekly</span>
              )}
            </div>
            <h3 className="mt-xs truncate text-body font-semibold text-ink-100">{offer.title}</h3>
            <p className="text-caption text-ink-40">{vendorName ?? 'Vendor'}</p>
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>

        <ThresholdBar current={offer.commitmentCount} target={offer.minCommitments} fired={offer.status === 'FIRED'} />

        <div className="flex flex-wrap items-center gap-x-md gap-y-xs text-caption text-ink-60">
          <span className="tabular font-semibold text-ink-100">{formatRupees(offer.unitPrice)}</span>
          <span className="text-ink-40">/ unit</span>
          {offer.currentTierPct ? <Badge tone="success">{offer.currentTierPct}% off</Badge> : null}
          {offer.nextTierAt ? <span className="text-ink-40">next tier at {offer.nextTierAt}</span> : null}
        </div>

        <p className="text-caption text-ink-40">{describeLadder(offer.discountLadder)}</p>

        <div className="mt-auto flex items-center justify-between border-t border-border-subtle pt-sm">
          <span className="inline-flex items-center gap-xxs text-caption text-ink-40">
            <Clock className="h-3.5 w-3.5" />
            {relativeDeadline(offer.deadline)}
          </span>
          {canRoll && (
            <Button variant="secondary" size="sm" icon={<RotateCw className="h-4 w-4" />} loading={roll.isPending} onClick={() => roll.mutate()}>
              Roll
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

'use client';

import { motion } from 'framer-motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Clock, Snowflake, X, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ThresholdBar } from '@/components/ui/progress';
import { useToast } from '@/components/ui/toast';
import { pooling } from '@/lib/endpoints';
import { POLL_STATUS_META } from '@/lib/pooling';
import { formatRupees, relativeDeadline } from '@/lib/format';
import { riseItem } from '@/lib/motion';
import { ApiError } from '@/lib/api';
import type { ResidentPollDetail } from '@/lib/types';

export function PollCard({
  poll,
  vendorName,
  onConfirm,
}: {
  poll: ResidentPollDetail;
  vendorName?: string;
  onConfirm: (poll: ResidentPollDetail) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const meta = POLL_STATUS_META[poll.status];
  const confirmed = !!poll.vendorConfirmedAt;
  const canAct = poll.status === 'OPEN' && !confirmed && !poll.vendorDeclinedAt;

  const decline = useMutation({
    mutationFn: () => pooling.vendorDecline(poll.id),
    onSuccess: () => {
      toast.show('Request declined on the vendor’s behalf.', 'info');
      qc.invalidateQueries({ queryKey: ['polls'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not decline.'),
  });

  return (
    <motion.div variants={riseItem}>
      <Card className="flex h-full flex-col gap-md p-md">
        <div className="flex items-start justify-between gap-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-xs">
              {poll.category && <Badge tone="accent"><Tag className="h-3.5 w-3.5" />{poll.category}</Badge>}
              {confirmed && (
                <span className="inline-flex items-center gap-xxs text-caption text-feedback-info"><Snowflake className="h-3.5 w-3.5" />Card frozen</span>
              )}
            </div>
            <h3 className="mt-xs truncate text-body font-semibold text-ink-100">{poll.title}</h3>
            <p className="text-caption text-ink-40">{vendorName ?? 'Tagged vendor'}</p>
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>

        <ThresholdBar
          current={poll.commitmentCount}
          target={poll.vendorConfirmedMinimum ?? poll.minCommitments}
          fired={poll.status === 'FIRED'}
        />

        {confirmed && poll.vendorUnitPrice != null && (
          <div className="flex items-center gap-x-md text-caption text-ink-60">
            <span className="tabular font-semibold text-ink-100">{formatRupees(poll.vendorUnitPrice)}</span>
            <span className="text-ink-40">/ unit confirmed</span>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-border-subtle pt-sm">
          <span className="inline-flex items-center gap-xxs text-caption text-ink-40">
            <Clock className="h-3.5 w-3.5" />
            {relativeDeadline(poll.closesAt)}
          </span>
          {canAct ? (
            <div className="flex gap-xs">
              <Button variant="ghost" size="sm" icon={<X className="h-4 w-4 text-feedback-danger" />} loading={decline.isPending} onClick={() => decline.mutate()}>
                Decline
              </Button>
              <Button variant="secondary" size="sm" icon={<Snowflake className="h-4 w-4" />} onClick={() => onConfirm(poll)}>
                Confirm terms
              </Button>
            </div>
          ) : confirmed ? (
            <span className="inline-flex items-center gap-xxs text-caption text-feedback-success"><CheckCircle2 className="h-3.5 w-3.5" />Sourced</span>
          ) : null}
        </div>
      </Card>
    </motion.div>
  );
}

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ShieldCheck, Star, MapPin, Mail, Phone, Info } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { committee } from '@/lib/endpoints';
import { TIER_META, ratingNumber } from '@/lib/vendor';
import { formatDate } from '@/lib/format';
import { ApiError } from '@/lib/api';
import type { VendorDetail } from '@/lib/types';

export function VendorSheet({ vendorId, onClose }: { vendorId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const q = useQuery({
    queryKey: ['vendor', vendorId],
    queryFn: () => committee.getVendor(vendorId!),
    enabled: !!vendorId,
  });

  const approve = useMutation({
    mutationFn: () => committee.approveVendor(vendorId!),
    onSuccess: (res) => {
      const promoted = /promoted/i.test(res.note);
      if (promoted) toast.success(res.note);
      else toast.show(res.note, 'info');
      qc.invalidateQueries({ queryKey: ['vendors'] });
      qc.invalidateQueries({ queryKey: ['vendor', vendorId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Verification failed.'),
  });

  const v = q.data;

  return (
    <Modal
      open={!!vendorId}
      onClose={onClose}
      title={v?.name ?? 'Vendor'}
      description={v ? v.categories.join(' · ') : undefined}
      footer={
        v ? (
          <VendorActions vendor={v} approving={approve.isPending} onApprove={() => approve.mutate()} onClose={onClose} />
        ) : undefined
      }
    >
      {q.isLoading || !v ? (
        <div className="space-y-md">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-lg">
          <div className="flex flex-wrap items-center gap-sm">
            <TierBadge tier={v.verificationTier} />
            <span className="inline-flex items-center gap-xxs text-caption text-ink-60">
              <Star className="h-4 w-4 fill-[#F59E0B] text-[#F59E0B]" />
              <span className="tabular font-medium text-ink-100">{ratingNumber(v.ratingAvg).toFixed(1)}</span>
              <span className="text-ink-40">({v.ratingCount} ratings)</span>
            </span>
          </div>

          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            <InfoRow icon={Mail} label="Contact email" value={v.contactEmail ?? 'Not provided'} />
            <InfoRow icon={Phone} label="Contact phone" value={v.contactPhone ?? 'Not provided'} />
            <InfoRow icon={MapPin} label="Service radius" value={v.radiusKm ? `${v.radiusKm} km` : 'Not set'} />
            <InfoRow icon={BadgeCheck} label="Onboarded" value={formatDate(v.createdAt)} />
          </div>

          <div className="rounded-lg border border-border-subtle bg-bg-secondary p-md">
            <div className="flex items-center justify-between">
              <span className="text-overline uppercase text-ink-40">GSTIN</span>
              {v.gstin ? (
                v.gstinVerifiedAt ? (
                  <Badge tone="success">Verified {formatDate(v.gstinVerifiedAt)}</Badge>
                ) : (
                  <Badge tone="warning">Unverified</Badge>
                )
              ) : (
                <Badge tone="neutral">Not on file</Badge>
              )}
            </div>
            <p className="tabular mt-xs text-body font-medium text-ink-100">{v.gstin ?? '—'}</p>
          </div>

          {v.verificationTier === 'SOCIETY_ATTESTED' && (
            <div className="flex items-start gap-sm rounded-lg border border-border-subtle p-md text-caption text-ink-60">
              <Info className="mt-[1px] h-4 w-4 shrink-0 text-feedback-info" />
              <span>
                Promotion to Platform audited is operator-driven. That endpoint is not yet available, so this is
                the current ceiling for committee onboarding.
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function VendorActions({
  vendor,
  approving,
  onApprove,
  onClose,
}: {
  vendor: VendorDetail;
  approving: boolean;
  onApprove: () => void;
  onClose: () => void;
}) {
  const canAttest = vendor.verificationTier === 'UNVERIFIED';
  return (
    <>
      <Button variant="ghost" onClick={onClose}>
        Close
      </Button>
      {canAttest && (
        <Button icon={<ShieldCheck className="h-4 w-4" />} loading={approving} onClick={onApprove}>
          {vendor.gstin ? 'Verify GSTIN and attest' : 'Attempt attestation'}
        </Button>
      )}
    </>
  );
}

function TierBadge({ tier }: { tier: VendorDetail['verificationTier'] }) {
  const meta = TIER_META[tier];
  return (
    <Badge tone={meta.tone}>
      <BadgeCheck className="h-3.5 w-3.5" />
      {meta.label}
    </Badge>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-sm">
      <Icon className="mt-[2px] h-4 w-4 shrink-0 text-ink-40" />
      <div>
        <p className="text-overline uppercase text-ink-40">{label}</p>
        <p className="text-body text-ink-80">{value}</p>
      </div>
    </div>
  );
}

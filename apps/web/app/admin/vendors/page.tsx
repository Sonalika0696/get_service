'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Store, Search, Star, BadgeCheck, Lock, Plus, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { OnboardVendorModal } from '@/components/vendors/onboard-modal';
import { VendorSheet } from '@/components/vendors/vendor-sheet';
import { committee } from '@/lib/endpoints';
import { getIdentity } from '@/lib/session';
import { TIER_META, ratingNumber } from '@/lib/vendor';
import { boundedStagger, riseItem } from '@/lib/motion';
import { ApiError } from '@/lib/api';
import type { VendorDetail } from '@/lib/types';

type TierFilter = 'ALL' | 'UNVERIFIED' | 'SOCIETY_ATTESTED' | 'PLATFORM_AUDITED';

export default function VendorsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => setAllowed(getIdentity()?.principalKind === 'RESIDENT'), []);

  const [q, setQ] = useState('');
  const [tier, setTier] = useState<TierFilter>('ALL');
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);

  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => committee.listVendors(), enabled: allowed === true });

  const filtered = useMemo(() => {
    let list = vendors.data ?? [];
    if (tier !== 'ALL') list = list.filter((v) => v.verificationTier === tier);
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((v) => v.name.toLowerCase().includes(needle) || v.categories.some((c) => c.toLowerCase().includes(needle)));
    }
    return list;
  }, [vendors.data, q, tier]);

  const counts = useMemo(() => {
    const list = vendors.data ?? [];
    return {
      ALL: list.length,
      UNVERIFIED: list.filter((v) => v.verificationTier === 'UNVERIFIED').length,
      SOCIETY_ATTESTED: list.filter((v) => v.verificationTier === 'SOCIETY_ATTESTED').length,
      PLATFORM_AUDITED: list.filter((v) => v.verificationTier === 'PLATFORM_AUDITED').length,
    };
  }, [vendors.data]);

  if (allowed === false) {
    return (
      <>
        <PageHeader title="Vendors" subtitle="Your directory of service providers." />
        <Card>
          <EmptyState icon={Lock} title="Admin access only" description="Vendor onboarding and sourcing are admin functions." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle="Add service providers, verify their GST, and use them for group jobs."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOnboardOpen(true)}>
            Onboard vendor
          </Button>
        }
      />

      <div className="mb-lg flex flex-wrap items-end gap-md">
        <div className="w-full max-w-xs">
          <Field label="Search" leftIcon={<Search className="h-4 w-4" />} placeholder="Name or category" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-xs">
          {(['ALL', 'UNVERIFIED', 'SOCIETY_ATTESTED', 'PLATFORM_AUDITED'] as TierFilter[]).map((t) => (
            <FilterChip key={t} active={tier === t} onClick={() => setTier(t)} count={counts[t]}>
              {t === 'ALL' ? 'All' : TIER_META[t].label}
            </FilterChip>
          ))}
        </div>
      </div>

      {vendors.isLoading ? (
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-md">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <Skeleton className="mt-md h-5 w-32" />
              <Skeleton className="mt-xs h-4 w-24" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Store}
            title={q || tier !== 'ALL' ? 'No vendors match' : 'No vendors onboarded'}
            description={q || tier !== 'ALL' ? 'Try a different search or filter.' : 'Onboard your first vendor to build the sourcing directory.'}
            action={q || tier !== 'ALL' ? undefined : <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOnboardOpen(true)}>Onboard vendor</Button>}
          />
        </Card>
      ) : (
        <motion.div variants={boundedStagger(filtered.length)} initial="hidden" animate="show" className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((v) => (
            <VendorCard key={v.id} vendor={v} onOpen={() => setSheetId(v.id)} />
          ))}
        </motion.div>
      )}

      <OnboardVendorModal open={onboardOpen} onClose={() => setOnboardOpen(false)} />
      <VendorSheet vendorId={sheetId} onClose={() => setSheetId(null)} />
    </>
  );
}

function VendorCard({ vendor, onOpen }: { vendor: VendorDetail; onOpen: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const initials = vendor.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const meta = TIER_META[vendor.verificationTier];

  const approve = useMutation({
    mutationFn: () => committee.approveVendor(vendor.id),
    onSuccess: (res) => {
      toast.show(res.note, /promoted/i.test(res.note) ? 'success' : 'info');
      qc.invalidateQueries({ queryKey: ['vendors'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Verification failed.'),
  });

  return (
    <motion.div variants={riseItem} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
      <Card className="flex h-full flex-col gap-md p-md transition-shadow hover:shadow-md">
        <button onClick={onOpen} className="flex items-start justify-between text-left">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-700/[0.08] text-body font-semibold text-accent-800">
            {initials}
          </span>
          <Badge tone={meta.tone}>
            <BadgeCheck className="h-3.5 w-3.5" />
            {meta.label}
          </Badge>
        </button>

        <button onClick={onOpen} className="text-left">
          <h3 className="text-body font-semibold text-ink-100">{vendor.name}</h3>
          <div className="mt-xs flex flex-wrap gap-xs">
            {vendor.categories.slice(0, 3).map((c) => (
              <span key={c} className="rounded-pill bg-bg-secondary px-sm py-[2px] text-caption text-ink-60">
                {c}
              </span>
            ))}
            {vendor.categories.length > 3 && (
              <span className="rounded-pill bg-bg-secondary px-sm py-[2px] text-caption text-ink-40">
                +{vendor.categories.length - 3}
              </span>
            )}
          </div>
        </button>

        <div className="mt-auto flex items-center justify-between">
          <span className="flex items-center gap-xs text-caption text-ink-60">
            <Star className="h-4 w-4 fill-[#F59E0B] text-[#F59E0B]" />
            <span className="tabular font-medium text-ink-100">{ratingNumber(vendor.ratingAvg).toFixed(1)}</span>
            <span className="text-ink-40">({vendor.ratingCount})</span>
          </span>
          {vendor.verificationTier === 'UNVERIFIED' && (
            <Button
              variant="secondary"
              size="sm"
              icon={<ShieldCheck className="h-4 w-4" />}
              loading={approve.isPending}
              onClick={(e) => {
                e.stopPropagation();
                approve.mutate();
              }}
            >
              Verify GSTIN
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'inline-flex items-center gap-xs rounded-pill border px-sm py-[7px] text-caption font-medium transition-colors ' +
        (active
          ? 'border-accent-700 bg-accent-700/[0.08] text-accent-800'
          : 'border-border-divider bg-bg-elevated text-ink-60 hover:bg-bg-secondary')
      }
    >
      {children}
      <span className={'tabular rounded-pill px-xs text-[11px] ' + (active ? 'bg-accent-700/[0.12]' : 'bg-bg-secondary')}>{count}</span>
    </button>
  );
}

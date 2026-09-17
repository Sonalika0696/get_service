'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ClipboardList, Megaphone, Users, Lock } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { OfferCard } from '@/components/pooling/offer-card';
import { PollCard } from '@/components/pooling/poll-card';
import { CreateOfferModal } from '@/components/pooling/create-offer-modal';
import { VendorConfirmModal } from '@/components/pooling/vendor-confirm-modal';
import { committee, pooling } from '@/lib/endpoints';
import { getIdentity } from '@/lib/session';
import { staggerContainer } from '@/lib/motion';
import type { ResidentPollDetail } from '@/lib/types';

type Tab = 'requests' | 'offers';

export default function RequestsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => setAllowed(getIdentity()?.principalKind === 'RESIDENT'), []);

  const [tab, setTab] = useState<Tab>('requests');
  const [offerOpen, setOfferOpen] = useState(false);
  const [confirmPoll, setConfirmPoll] = useState<ResidentPollDetail | null>(null);

  const polls = useQuery({ queryKey: ['polls'], queryFn: pooling.listPolls, enabled: allowed === true });
  const offers = useQuery({ queryKey: ['offers'], queryFn: () => pooling.listOffers(), enabled: allowed === true });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => committee.listVendors(), enabled: allowed === true });

  const vendorName = useMemo(() => {
    const map = new Map((vendors.data ?? []).map((v) => [v.id, v.name]));
    return (id: string | null) => (id ? map.get(id) : undefined);
  }, [vendors.data]);

  if (allowed === false) {
    return (
      <>
        <PageHeader title="Group buying" subtitle="Pooled service requests and bulk offers." />
        <Card>
          <EmptyState icon={Lock} title="Admin access only" description="Sourcing group requests and posting offers are admin functions." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Group buying"
        subtitle="Residents pool into shared service requests, and you can post bulk offers everyone opts into."
        action={
          tab === 'offers' ? (
            <Button icon={<Megaphone className="h-4 w-4" />} onClick={() => setOfferOpen(true)}>
              Post offer
            </Button>
          ) : undefined
        }
      />

      <div className="mb-lg">
        <Tabs
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          tabs={[
            { key: 'requests', label: 'Resident requests', count: polls.data?.length },
            { key: 'offers', label: 'Bulk offers', count: offers.data?.length },
          ]}
        />
      </div>

      {tab === 'requests' ? (
        <PoolGrid
          loading={polls.isLoading}
          empty={
            <EmptyState
              icon={Users}
              title="No resident requests yet"
              description="When a resident raises a pooled request against a vendor, it appears here for the committee to source."
            />
          }
          count={polls.data?.length ?? 0}
        >
          {polls.data?.map((p) => (
            <PollCard key={p.id} poll={p} vendorName={vendorName(p.taggedVendorId)} onConfirm={setConfirmPoll} />
          ))}
        </PoolGrid>
      ) : (
        <PoolGrid
          loading={offers.isLoading}
          empty={
            <EmptyState
              icon={Megaphone}
              title="No bulk offers yet"
              description="Post a bulk offer against a vendor. Residents commit until the threshold is met."
              action={<Button icon={<Megaphone className="h-4 w-4" />} onClick={() => setOfferOpen(true)}>Post offer</Button>}
            />
          }
          count={offers.data?.length ?? 0}
        >
          {offers.data?.map((o) => (
            <OfferCard key={o.id} offer={o} vendorName={vendorName(o.vendorId)} />
          ))}
        </PoolGrid>
      )}

      <CreateOfferModal open={offerOpen} onClose={() => setOfferOpen(false)} />
      <VendorConfirmModal poll={confirmPoll} onClose={() => setConfirmPoll(null)} />
    </>
  );
}

function PoolGrid({
  loading,
  empty,
  count,
  children,
}: {
  loading: boolean;
  empty: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-lg">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-md h-5 w-40" />
            <Skeleton className="mt-lg h-2 w-full" />
            <Skeleton className="mt-md h-4 w-32" />
          </Card>
        ))}
      </div>
    );
  }
  if (count === 0) {
    return <Card>{empty}</Card>;
  }
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-3"
    >
      {children}
    </motion.div>
  );
}

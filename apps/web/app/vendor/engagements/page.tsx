'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ClipboardList, Tag, Clock, Users, Check, X, CalendarClock } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { formatRupees } from '@/lib/format';
import { staggerContainer, riseItem } from '@/lib/motion';

type EngagementStatus = 'ASSIGNED' | 'CONFIRMED' | 'DECLINED';

interface Engagement {
  id: string;
  title: string;
  category: string;
  society: string;
  participants: number;
  unitPrice: number;
  proposedSlot: string;
  status: EngagementStatus;
}

const INITIAL_ENGAGEMENTS: Engagement[] = [
  { id: 'e1', title: 'Recurring bathroom leaks in B block', category: 'Plumbing', society: 'Sunshine Residency', participants: 6, unitPrice: 850, proposedSlot: 'Thu, 20 Sept · morning', status: 'ASSIGNED' },
  { id: 'e2', title: 'Common-area wiring check', category: 'Electrical', society: 'Sunshine Residency', participants: 4, unitPrice: 600, proposedSlot: 'Fri, 21 Sept · afternoon', status: 'ASSIGNED' },
  { id: 'e3', title: 'Pre-monsoon AC servicing drive', category: 'AC service', society: 'Palm Grove Society', participants: 12, unitPrice: 1200, proposedSlot: 'Sat, 22 Sept · full day', status: 'CONFIRMED' },
  { id: 'e4', title: 'Festival deep-clean package', category: 'Deep cleaning', society: 'Sunshine Residency', participants: 8, unitPrice: 2500, proposedSlot: 'Mon, 24 Sept · morning', status: 'CONFIRMED' },
];

const STATUS_META: Record<EngagementStatus, { label: string; tone: 'warning' | 'success' | 'neutral' }> = {
  ASSIGNED: { label: 'Awaiting your response', tone: 'warning' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'neutral' },
};

export default function EngagementsPage() {
  const toast = useToast();
  const [engagements, setEngagements] = useState(INITIAL_ENGAGEMENTS);

  function respond(id: string, status: 'CONFIRMED' | 'DECLINED') {
    setEngagements((prev) => prev.map((e) => (e.id === id ? { ...e, status } : e)));
    const eng = engagements.find((e) => e.id === id);
    toast.show(
      status === 'CONFIRMED' ? `Confirmed — the pricing card is frozen for "${eng?.title}".` : `Declined "${eng?.title}".`,
      status === 'CONFIRMED' ? 'success' : 'info',
    );
  }

  const pending = engagements.filter((e) => e.status === 'ASSIGNED');
  const decided = engagements.filter((e) => e.status !== 'ASSIGNED');

  return (
    <>
      <PageHeader
        title="Engagements"
        subtitle="Incoming pooled requests assigned by committees. Confirm or decline, and propose a service slot."
        action={pending.length > 0 ? <Badge tone="warning"><Clock className="h-3.5 w-3.5" />{pending.length} awaiting response</Badge> : undefined}
      />

      {engagements.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardList} title="No engagements yet" description="Assigned pooled requests will appear here for you to confirm or decline." />
        </Card>
      ) : (
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-3">
          {[...pending, ...decided].map((e) => (
            <EngagementCard key={e.id} engagement={e} onRespond={respond} />
          ))}
        </motion.div>
      )}
    </>
  );
}

function EngagementCard({ engagement: e, onRespond }: { engagement: Engagement; onRespond: (id: string, status: 'CONFIRMED' | 'DECLINED') => void }) {
  const meta = STATUS_META[e.status];
  return (
    <motion.div variants={riseItem}>
      <Card className="flex h-full flex-col gap-md p-md">
        <div className="flex items-start justify-between gap-sm">
          <div className="min-w-0">
            <Badge tone="accent"><Tag className="h-3.5 w-3.5" />{e.category}</Badge>
            <h3 className="mt-xs text-body font-semibold text-ink-100">{e.title}</h3>
            <p className="text-caption text-ink-40">{e.society}</p>
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>

        <div className="flex items-center gap-md text-caption text-ink-60">
          <span className="inline-flex items-center gap-xxs"><Users className="h-3.5 w-3.5" />{e.participants} joined</span>
          <span className="tabular font-semibold text-ink-100">{formatRupees(e.unitPrice)}<span className="font-normal text-ink-40"> / unit</span></span>
        </div>

        <span className="inline-flex items-center gap-xxs text-caption text-ink-40">
          <CalendarClock className="h-3.5 w-3.5" />
          Proposed: {e.proposedSlot}
        </span>

        {e.status === 'ASSIGNED' && (
          <div className="mt-auto flex gap-xs border-t border-border-subtle pt-sm">
            <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => onRespond(e.id, 'CONFIRMED')} className="flex-1">
              Confirm
            </Button>
            <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => onRespond(e.id, 'DECLINED')} className="flex-1">
              Decline
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

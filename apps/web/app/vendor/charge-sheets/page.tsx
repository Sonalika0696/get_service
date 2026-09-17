'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Tag, Plus, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { formatRupees, formatDate } from '@/lib/format';
import { staggerContainer, riseItem } from '@/lib/motion';

type ChargeSheetStatus = 'DRAFT' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'DISPUTED';

interface ChargeLine {
  label: string;
  amount: number;
  onCard: boolean;
}

interface ChargeSheet {
  id: string;
  engagement: string;
  category: string;
  society: string;
  submittedAt: string;
  status: ChargeSheetStatus;
  lines: ChargeLine[];
}

const STATUS_META: Record<ChargeSheetStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Awaiting acknowledgement', tone: 'info' },
  ACKNOWLEDGED: { label: 'Settled', tone: 'success' },
  DISPUTED: { label: 'Disputed line', tone: 'danger' },
};

const CHARGE_SHEETS: ChargeSheet[] = [
  {
    id: 'cs1',
    engagement: 'Pre-monsoon AC servicing drive',
    category: 'AC service',
    society: 'Palm Grove Society',
    submittedAt: '2026-09-10',
    status: 'ACKNOWLEDGED',
    lines: [
      { label: 'Coil clean + gas top-up (12 units)', amount: 14400, onCard: true },
      { label: 'Filter replacement (12 units)', amount: 3600, onCard: true },
    ],
  },
  {
    id: 'cs2',
    engagement: 'Festival deep-clean package',
    category: 'Deep cleaning',
    society: 'Sunshine Residency',
    submittedAt: '2026-09-14',
    status: 'SUBMITTED',
    lines: [
      { label: 'Full-home deep clean (8 flats)', amount: 20000, onCard: true },
      { label: 'Extra: balcony grime removal (2 flats)', amount: 1200, onCard: false },
    ],
  },
  {
    id: 'cs3',
    engagement: 'Common-area wiring check', category: 'Electrical', society: 'Sunshine Residency', submittedAt: '2026-09-05', status: 'DISPUTED',
    lines: [
      { label: 'Wiring inspection (common areas)', amount: 2400, onCard: true },
      { label: 'Replacement MCB unit', amount: 950, onCard: false },
    ],
  },
];

export default function ChargeSheetsPage() {
  const toast = useToast();
  const [sheets] = useState(CHARGE_SHEETS);

  return (
    <>
      <PageHeader
        title="Charge sheets"
        subtitle="Itemised billing against the frozen pricing card. Out-of-card lines are flagged automatically."
        action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => toast.show('Pick a confirmed engagement from Engagements to start a new charge sheet.', 'info')}>New charge sheet</Button>}
      />

      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-md">
        {sheets.map((s) => (
          <ChargeSheetCard key={s.id} sheet={s} />
        ))}
      </motion.div>
    </>
  );
}

function ChargeSheetCard({ sheet }: { sheet: ChargeSheet }) {
  const meta = STATUS_META[sheet.status];
  const total = sheet.lines.reduce((sum, l) => sum + l.amount, 0);
  const outOfCard = sheet.lines.filter((l) => !l.onCard);

  return (
    <motion.div variants={riseItem}>
      <Card>
        <CardHeader
          title={sheet.engagement}
          action={<Badge tone={meta.tone}>{meta.label}</Badge>}
        />
        <CardBody className="pt-md">
          <div className="mb-md flex flex-wrap items-center gap-sm text-caption text-ink-60">
            <Badge tone="accent"><Tag className="h-3.5 w-3.5" />{sheet.category}</Badge>
            <span>{sheet.society}</span>
            <span className="text-ink-40">·</span>
            <span>Submitted {formatDate(sheet.submittedAt)}</span>
          </div>

          <ul className="divide-y divide-border-subtle">
            {sheet.lines.map((line, i) => (
              <li key={i} className="flex items-center justify-between gap-sm py-sm first:pt-0 last:pb-0">
                <span className="flex items-center gap-xs text-body text-ink-80">
                  {line.label}
                  {!line.onCard && <Badge tone="warning"><AlertTriangle className="h-3 w-3" />Out of card</Badge>}
                </span>
                <span className="tabular font-medium text-ink-100">{formatRupees(line.amount)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-md flex items-center justify-between border-t border-border-subtle pt-md">
            <span className="text-caption text-ink-60">
              {outOfCard.length > 0 ? `${outOfCard.length} line${outOfCard.length > 1 ? 's' : ''} routed to committee adjudication` : 'All lines within the frozen card'}
            </span>
            <span className="tabular text-heading font-semibold text-ink-100">{formatRupees(total)}</span>
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}

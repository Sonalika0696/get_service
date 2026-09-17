'use client';

import { useEffect, useState } from 'react';
import {
  Zap,
  Lock,
  UploadCloud,
  ShieldAlert,
  Calculator,
  Scale,
  GitCompareArrows,
  Send,
  Landmark,
  Truck,
  Waves,
  CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs } from '@/components/ui/tabs';
import { BillingPipeline, type PipelineStage } from '@/components/billing/pipeline';
import { useToast } from '@/components/ui/toast';
import { getIdentity } from '@/lib/session';
import { formatRupees, formatDate } from '@/lib/format';

type Tab = 'electricity' | 'water';

interface Cycle {
  id: string;
  period: string;
  status: 'Published' | 'In progress';
  totalBilled: number;
  variance: number;
  flatsBilled: number;
  publishedOn?: string;
}

const ELECTRICITY_CYCLES: Cycle[] = [
  { id: 'e-2026-09', period: 'September 2026', status: 'In progress', totalBilled: 184200, variance: 0, flatsBilled: 0 },
  { id: 'e-2026-08', period: 'August 2026', status: 'Published', totalBilled: 176900, variance: 420, flatsBilled: 90, publishedOn: '2026-09-02' },
  { id: 'e-2026-07', period: 'July 2026', status: 'Published', totalBilled: 168300, variance: -180, flatsBilled: 90, publishedOn: '2026-08-02' },
];

const WATER_CYCLES: Cycle[] = [
  { id: 'w-2026-09', period: 'September 2026', status: 'In progress', totalBilled: 52400, variance: 0, flatsBilled: 0 },
  { id: 'w-2026-08', period: 'August 2026', status: 'Published', totalBilled: 61800, variance: 1250, flatsBilled: 90, publishedOn: '2026-09-03' },
  { id: 'w-2026-07', period: 'July 2026', status: 'Published', totalBilled: 47600, variance: -320, flatsBilled: 90, publishedOn: '2026-08-03' },
];

const ELECTRICITY_STAGES: PipelineStage[] = [
  { key: 'ingest', title: 'Ingest readings', description: 'Sub-meter and common-area readings for September are captured. Every reading is written to the audit chain at capture.', icon: UploadCloud, state: 'done' },
  { key: 'validate', title: 'Validate', description: 'No negative consumption, stalled meters, rollover or out-of-bounds values flagged this cycle.', icon: ShieldAlert, state: 'done' },
  { key: 'compute', title: 'Compute slabs', description: 'Tariff slabs, fixed charges, duty and cess applied from the versioned schedule in force.', icon: Calculator, state: 'done' },
  { key: 'apportion', title: 'Apportion common area', description: 'Bulk less the sum of sub-meters, apportioned by area factor with deterministic rounding-residue allocation.', icon: Scale, state: 'active' },
  { key: 'reconcile', title: 'Reconcile against the bulk invoice', description: 'Compare the computed total against the licensee invoice once apportionment closes.', icon: GitCompareArrows, state: 'todo' },
  { key: 'publish', title: 'Publish', description: 'Publish the cycle so each flat sees its bill with the full computation trace.', icon: Send, state: 'todo' },
];

const WATER_STAGES: PipelineStage[] = [
  { key: 'sources', title: 'Record cost pool', description: 'Municipal supply, tanker purchases and borewell operation logged for September.', icon: Waves, state: 'done' },
  { key: 'blend', title: 'Blend per-kilolitre rate', description: 'Blended rate derived across all three sources, published with its derivation.', icon: Calculator, state: 'active' },
  { key: 'bill', title: 'Bill flats', description: 'Metered flats on measurement; unmetered flats on the recorded fallback basis.', icon: Scale, state: 'todo' },
  { key: 'publish', title: 'Publish', description: 'Publish with the tanker-season derivation visible.', icon: Send, state: 'todo' },
];

export default function BillingPage() {
  const toast = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => setAllowed(getIdentity()?.principalKind === 'RESIDENT'), []);

  const [tab, setTab] = useState<Tab>('electricity');

  if (allowed === false) {
    return (
      <>
        <PageHeader title="Utility bills" subtitle="Electricity and water bills from meter readings." />
        <Card>
          <EmptyState icon={Lock} title="Admin access only" description="Billing is run by administrators." />
        </Card>
      </>
    );
  }

  const stages = tab === 'electricity' ? ELECTRICITY_STAGES : WATER_STAGES;
  const cycles = tab === 'electricity' ? ELECTRICITY_CYCLES : WATER_CYCLES;
  const current = cycles.find((c) => c.status === 'In progress');

  return (
    <>
      <PageHeader
        title="Utility bills"
        subtitle="Turn meter readings into fair, itemised electricity and water bills for every flat."
        action={
          <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={() => toast.success('September cycle apportionment queued — reconciliation runs once it closes.')}>
            Advance cycle
          </Button>
        }
      />

      <div className="mb-lg">
        <Tabs
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          tabs={[
            { key: 'electricity', label: 'Electricity' },
            { key: 'water', label: 'Water' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-lg">
          <Card>
            <CardHeader title="Recent cycles" action={current && <Badge tone="info">{current.period} in progress</Badge>} />
            <CardBody className="pt-md">
              <ul className="divide-y divide-border-subtle">
                {cycles.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-sm py-sm first:pt-0 last:pb-0">
                    <div>
                      <p className="text-body font-medium text-ink-100">{c.period}</p>
                      <p className="text-caption text-ink-40">
                        {c.status === 'Published' ? `Published ${formatDate(c.publishedOn!)} · ${c.flatsBilled} flats` : 'Reconciliation not yet run'}
                      </p>
                    </div>
                    <div className="flex items-center gap-md">
                      {c.status === 'Published' && (
                        <span className={`tabular text-caption ${c.variance >= 0 ? 'text-feedback-warning' : 'text-feedback-success'}`}>
                          {c.variance >= 0 ? '+' : ''}{formatRupees(c.variance)} variance
                        </span>
                      )}
                      <span className="tabular font-semibold text-ink-100">{formatRupees(c.totalBilled)}</span>
                      <Badge tone={c.status === 'Published' ? 'success' : 'info'}>
                        {c.status === 'Published' && <CheckCircle2 className="h-3.5 w-3.5" />}
                        {c.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={tab === 'electricity' ? 'September cycle pipeline' : 'September cycle pipeline'} />
            <CardBody>
              <BillingPipeline stages={stages} />
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-lg">
          {tab === 'electricity' ? (
            <Card>
              <CardHeader title="What the resident sees" />
              <CardBody className="space-y-sm">
                <Detail icon={Zap} title="Computation trace" text="Every bill line carries its formula and inputs, linked to the underlying meter reading and apportionment." />
                <Detail icon={GitCompareArrows} title="Published variance" text="The reconciliation delta against the bulk invoice is visible by design, never absorbed silently." />
                <Detail icon={Landmark} title="Individually metered path" text="Societies with per-flat licensee meters bypass apportionment and route through a BBPS adapter." />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Three-source cost pool" />
              <CardBody className="space-y-sm">
                <Detail icon={Landmark} title="Municipal supply" text="Metered municipal cost for the cycle." />
                <Detail icon={Truck} title="Tanker purchases" text="Bought-in tanker water, the main driver of seasonal spikes." />
                <Detail icon={Waves} title="Borewell operation" text="Running cost of the society's own borewell." />
                <p className="pt-xs text-caption text-ink-40">These blend into one published per-kilolitre rate.</p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Detail({ icon: Icon, title, text }: { icon: typeof Zap; title: string; text: string }) {
  return (
    <div className="flex items-start gap-sm">
      <span className="mt-[2px] flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-700/[0.08]">
        <Icon className="h-4 w-4 text-accent-700" strokeWidth={2} />
      </span>
      <div>
        <p className="text-caption font-semibold text-ink-100">{title}</p>
        <p className="text-caption text-ink-60">{text}</p>
      </div>
    </div>
  );
}

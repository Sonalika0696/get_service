'use client';

import { useEffect, useState } from 'react';
import {
  Zap,
  Droplets,
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
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs } from '@/components/ui/tabs';
import { BillingPipeline, type PipelineStage } from '@/components/billing/pipeline';
import { getIdentity } from '@/lib/session';

type Tab = 'electricity' | 'water';

const ELECTRICITY_STAGES: PipelineStage[] = [
  { key: 'ingest', title: 'Ingest readings', description: 'Capture sub-meter and common-area readings, manually or by CSV. Every reading is written to the audit chain at capture.', icon: UploadCloud, state: 'blocked', endpoint: 'POST /billing/electricity/:cycleId/readings' },
  { key: 'validate', title: 'Validate', description: 'Flag negative consumption, stalled meters, rollover and out-of-bounds values. A flagged meter halts the cycle for review.', icon: ShieldAlert, state: 'todo', endpoint: 'POST /billing/electricity/:cycleId/validate' },
  { key: 'compute', title: 'Compute slabs', description: 'Apply tariff slabs, fixed charges, duty and cess from the versioned tariff schedule in force.', icon: Calculator, state: 'todo', endpoint: 'GET /billing/tariffs' },
  { key: 'apportion', title: 'Apportion common area', description: 'Bulk less the sum of sub-meters, apportioned by area factor with deterministic rounding-residue allocation.', icon: Scale, state: 'todo' },
  { key: 'reconcile', title: 'Reconcile against the bulk invoice', description: 'Compare the computed total against the licensee invoice. Variance is published, not absorbed, and is resident-visible.', icon: GitCompareArrows, state: 'todo', endpoint: 'POST /billing/electricity/:cycleId/reconcile' },
  { key: 'publish', title: 'Publish', description: 'Publish the cycle. Each flat sees its bill with the full computation trace: formula and inputs, not just the figure.', icon: Send, state: 'todo', endpoint: 'POST /billing/electricity/:cycleId/publish' },
];

const WATER_STAGES: PipelineStage[] = [
  { key: 'sources', title: 'Record cost pool', description: 'Three-source cost pool for the cycle: municipal supply, tanker purchases and borewell operation.', icon: Waves, state: 'blocked', endpoint: 'POST /billing/water/:cycleId/sources' },
  { key: 'blend', title: 'Blend per-kilolitre rate', description: 'Derive the blended per-kilolitre rate across all three sources, published with its derivation.', icon: Calculator, state: 'todo' },
  { key: 'bill', title: 'Bill flats', description: 'Metered flats billed on measurement; unmetered flats on a recorded fallback basis, with the cross-subsidy reported.', icon: Scale, state: 'todo' },
  { key: 'publish', title: 'Publish', description: 'Publish with the tanker-season derivation visible, so cost spikes are explained rather than argued about.', icon: Send, state: 'todo', endpoint: 'POST /billing/water/:cycleId/publish' },
];

export default function BillingPage() {
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

  return (
    <>
      <PageHeader
        title="Utility bills"
        subtitle="Turn meter readings into fair, itemised electricity and water bills for every flat."
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
        <Card>
          <CardHeader
            title={tab === 'electricity' ? 'Electricity cycle pipeline' : 'Water cycle pipeline'}
            action={<Badge tone="warning">Backend pending</Badge>}
          />
          <CardBody>
            <p className="mb-lg text-caption text-ink-60">
              The reusable stepper below is the cycle wizard shell. Each stage names the endpoint it will call.
              The billing backend (meters, readings, tariffs, cycles, apportionment, reconciliation) is not built
              yet, so this surface is inert until those land.
            </p>
            <BillingPipeline stages={stages} />
          </CardBody>
        </Card>

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

'use client';

import { Star, BadgeCheck, Building2, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';

const SOCIETY_BREAKDOWN = [
  { society: 'Sunshine Residency', jobs: 14, rating: 4.8 },
  { society: 'Palm Grove Society', jobs: 9, rating: 4.6 },
  { society: 'Maple Heights', jobs: 5, rating: 4.9 },
];

const JOB_HISTORY = [
  { title: 'Pre-monsoon AC servicing drive', society: 'Palm Grove Society', date: '2026-09-10', rating: 5 },
  { title: 'Common-area wiring check', society: 'Sunshine Residency', date: '2026-09-05', rating: 4 },
  { title: 'Recurring bathroom leak repair', society: 'Sunshine Residency', date: '2026-08-28', rating: 5 },
  { title: 'Quarterly AMC visit', society: 'Maple Heights', date: '2026-08-15', rating: 5 },
];

const totalJobs = SOCIETY_BREAKDOWN.reduce((s, r) => s + r.jobs, 0);
const overallRating = SOCIETY_BREAKDOWN.reduce((s, r) => s + r.rating * r.jobs, 0) / totalJobs;

export default function ReputationPage() {
  return (
    <>
      <PageHeader title="Reputation" subtitle="A portable record that follows you across societies." />

      <div className="grid grid-cols-1 gap-lg xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardBody className="flex flex-col items-center gap-sm p-lg text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-700/[0.10]">
              <Star className="h-8 w-8 fill-[#F59E0B] text-[#F59E0B]" />
            </span>
            <p className="tabular text-display font-semibold text-ink-100">{overallRating.toFixed(1)}</p>
            <p className="text-caption text-ink-60">{totalJobs} completed jobs across {SOCIETY_BREAKDOWN.length} societies</p>
            <Badge tone="success"><BadgeCheck className="h-3.5 w-3.5" />Society attested</Badge>
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="By society" />
          <CardBody className="pt-md">
            <ul className="divide-y divide-border-subtle">
              {SOCIETY_BREAKDOWN.map((r) => (
                <li key={r.society} className="flex items-center justify-between gap-sm py-sm first:pt-0 last:pb-0">
                  <span className="flex items-center gap-xs text-body text-ink-80">
                    <Building2 className="h-4 w-4 text-ink-40" />
                    {r.society}
                  </span>
                  <span className="flex items-center gap-md">
                    <span className="text-caption text-ink-40">{r.jobs} jobs</span>
                    <span className="flex items-center gap-xxs">
                      <Star className="h-3.5 w-3.5 fill-[#F59E0B] text-[#F59E0B]" />
                      <span className="tabular font-medium text-ink-100">{r.rating.toFixed(1)}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <div className="mt-lg">
        <Card>
          <CardHeader title="Recent job history" />
          <CardBody className="pt-md">
            <ul className="divide-y divide-border-subtle">
              {JOB_HISTORY.map((j, i) => (
                <li key={i} className="flex items-center justify-between gap-sm py-sm first:pt-0 last:pb-0">
                  <div className="flex items-start gap-sm">
                    <CheckCircle2 className="mt-[2px] h-4 w-4 shrink-0 text-feedback-success" />
                    <div>
                      <p className="text-body text-ink-100">{j.title}</p>
                      <p className="text-caption text-ink-40">{j.society} · {formatDate(j.date)}</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-xxs shrink-0">
                    <Star className="h-3.5 w-3.5 fill-[#F59E0B] text-[#F59E0B]" />
                    <span className="tabular font-medium text-ink-100">{j.rating}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

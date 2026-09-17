'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Receipt, Star, BadgeCheck, ShieldCheck, FileCheck2, MapPin, Building2, ArrowRight } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { vendor as vendorApi, pricing, identity as identityApi } from '@/lib/endpoints';
import { getIdentity, type IdentityHint } from '@/lib/session';
import { TIER_META, ratingNumber } from '@/lib/vendor';
import { staggerContainer } from '@/lib/motion';

export default function VendorDashboard() {
  const [hint, setHint] = useState<IdentityHint | null>(null);
  useEffect(() => setHint(getIdentity()), []);

  const profile = useQuery({ queryKey: ['vendorProfile'], queryFn: vendorApi.profile });
  const cards = useQuery({ queryKey: ['pricingMine'], queryFn: pricing.mine });
  const self = useQuery({ queryKey: ['vendorMe'], queryFn: identityApi.vendorMe });

  const p = profile.data;
  const published = (cards.data ?? []).filter((c) => c.status === 'PUBLISHED' && !c.supersededAt);
  const drafts = (cards.data ?? []).filter((c) => c.status === 'DRAFT');
  const tier = p ? TIER_META[p.verificationTier] : null;

  return (
    <div className="space-y-lg">
      <div>
        <h2 className="text-display font-semibold tracking-tight text-ink-100">
          Welcome{p?.name ? `, ${p.name}` : hint?.name ? `, ${hint.name}` : ''}
        </h2>
        <p className="mt-xxs text-body text-ink-60">
          One identity and one price sheet across every society you serve.
        </p>
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Published cards" value={published.length} icon={Receipt} accent="teal" loading={cards.isLoading} caption={published.length ? 'Live for residents' : 'None published yet'} />
        <StatCard label="Drafts in progress" value={drafts.length} icon={FileCheck2} accent="amber" loading={cards.isLoading} caption={drafts.length ? 'Finish and publish' : 'No open drafts'} />
        <StatCard label="Rating" value={p ? ratingNumber(p.ratingAvg).toFixed(1) : '—'} icon={Star} accent="violet" loading={profile.isLoading} caption={p ? `${p.ratingCount} reviews` : 'Portable across societies'} />
        <StatCard label="Societies served" value={self.data?.societyIds.length ?? 0} icon={Building2} accent="sky" loading={self.isLoading} caption="Linked to your identity" />
      </motion.div>

      <div className="grid grid-cols-1 gap-lg xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Verification"
            action={tier ? <Badge tone={tier.tone}><BadgeCheck className="h-3.5 w-3.5" />{tier.label}</Badge> : undefined}
          />
          <CardBody>
            {profile.isLoading ? (
              <p className="text-body text-ink-40">Loading your account...</p>
            ) : p ? (
              <dl className="grid grid-cols-1 gap-md sm:grid-cols-2">
                <Detail
                  icon={ShieldCheck}
                  label="GST registration"
                  value={p.gstin ?? 'Not on file'}
                  ok={!!p.gstinVerifiedAt}
                  okText="Verified"
                  pendingText={p.gstin ? 'Awaiting check' : 'Add your GSTIN'}
                />
                <Detail
                  icon={FileCheck2}
                  label="Trade licence"
                  value={p.tradeLicenceNumber ?? 'Not on file'}
                  ok={!!p.tradeLicenceVerifiedAt}
                  okText="Verified"
                  pendingText={p.tradeLicenceNumber ? 'Awaiting check' : 'Add your licence number'}
                />
                <Detail icon={MapPin} label="Service radius" value={p.radiusKm ? `${p.radiusKm} km` : 'Not set'} />
                <div>
                  <dt className="flex items-center gap-xs text-caption font-medium text-ink-80">
                    <Building2 className="h-4 w-4 text-ink-40" /> Categories
                  </dt>
                  <dd className="mt-xs flex flex-wrap gap-xs">
                    {p.categories.length ? (
                      p.categories.map((c) => (
                        <span key={c} className="rounded-pill bg-bg-secondary px-sm py-[2px] text-caption text-ink-60">{c}</span>
                      ))
                    ) : (
                      <span className="text-caption text-ink-40">None added yet</span>
                    )}
                  </dd>
                </div>
              </dl>
            ) : (
              <EmptyState icon={Building2} title="Account not loaded" description="Sign in again if this persists." />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Next steps" />
          <CardBody className="space-y-sm">
            <NextStep href="/vendor/pricing" icon={Receipt} title="Manage pricing cards" text={published.length ? 'Review or revise your published rates.' : 'Publish your first price sheet.'} />
            <NextStep href="/vendor/profile" icon={ShieldCheck} title="Complete your profile" text="Contact, service radius, trade licence and payout account." />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
  ok,
  okText,
  pendingText,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  ok?: boolean;
  okText?: string;
  pendingText?: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-xs text-caption font-medium text-ink-80">
        <Icon className="h-4 w-4 text-ink-40" /> {label}
      </dt>
      <dd className="mt-xxs flex items-center gap-xs">
        <span className="text-body text-ink-100">{value}</span>
        {okText && (
          <Badge tone={ok ? 'success' : 'warning'}>{ok ? okText : pendingText}</Badge>
        )}
      </dd>
    </div>
  );
}

function NextStep({ href, icon: Icon, title, text }: { href: string; icon: typeof Receipt; title: string; text: string }) {
  return (
    <Link href={href} className="group flex items-start gap-sm rounded-lg border border-border-subtle p-sm transition-colors hover:bg-bg-secondary">
      <span className="mt-[2px] flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-700/[0.08]">
        <Icon className="h-4 w-4 text-accent-700" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-xs text-caption font-semibold text-ink-100">
          {title}
          <ArrowRight className="h-3.5 w-3.5 text-ink-40 transition-transform group-hover:translate-x-[2px]" />
        </p>
        <p className="text-caption text-ink-60">{text}</p>
      </div>
    </Link>
  );
}

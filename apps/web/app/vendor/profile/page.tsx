'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Landmark, Tags, Plus, X, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { vendor as vendorApi } from '@/lib/endpoints';
import { ApiError } from '@/lib/api';
import { VENDOR_CATEGORY_PRESETS, TIER_META } from '@/lib/vendor';
import type { UpdateVendorProfileInput, VendorProfileDetail } from '@/lib/types';

export default function VendorProfilePage() {
  const profile = useQuery({ queryKey: ['vendorProfile'], queryFn: vendorApi.profile });

  return (
    <>
      <PageHeader title="Profile" subtitle="Your business details, payout account, and the categories you serve." />
      {profile.isLoading ? (
        <div className="space-y-lg">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="p-md">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-md h-32 w-full" />
            </Card>
          ))}
        </div>
      ) : profile.data ? (
        <div className="space-y-lg">
          <BusinessDetails profile={profile.data} />
          <PayoutAccount profile={profile.data} />
          <Categories profile={profile.data} />
        </div>
      ) : (
        <Card className="p-md">
          <p className="text-body text-ink-60">Could not load your profile. Sign in again if this persists.</p>
        </Card>
      )}
    </>
  );
}

/* --------------------------------------------------- business details --- */

function BusinessDetails({ profile }: { profile: VendorProfileDetail }) {
  const toast = useToast();
  const qc = useQueryClient();
  const tier = TIER_META[profile.verificationTier];

  const [form, setForm] = useState({
    contactEmail: profile.contactEmail ?? '',
    contactPhone: profile.contactPhone ?? '',
    radiusKm: profile.radiusKm != null ? String(profile.radiusKm) : '',
    tradeLicenceNumber: profile.tradeLicenceNumber ?? '',
  });

  const save = useMutation({
    mutationFn: () => {
      const patch: UpdateVendorProfileInput = {};
      if (form.contactEmail.trim()) patch.contactEmail = form.contactEmail.trim();
      if (form.contactPhone.trim()) patch.contactPhone = form.contactPhone.trim();
      if (form.radiusKm.trim()) patch.radiusKm = Number(form.radiusKm);
      if (form.tradeLicenceNumber.trim()) patch.tradeLicenceNumber = form.tradeLicenceNumber.trim();
      return vendorApi.updateProfile(patch);
    },
    onSuccess: (data) => {
      qc.setQueryData(['vendorProfile'], data);
      toast.success('Business details saved.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save your details.'),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card>
      <CardHeader
        title="Business details"
        action={<Badge tone={tier.tone}><ShieldCheck className="h-3.5 w-3.5" />{tier.label}</Badge>}
      />
      <CardBody>
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          className="grid grid-cols-1 gap-md sm:grid-cols-2"
        >
          <ReadOnly label="Legal name" value={profile.name} />
          <ReadOnly label="GST registration" value={profile.gstin ?? 'Not on file'} badge={profile.gstinVerifiedAt ? 'Verified' : undefined} />
          <Field label="Contact email" type="email" leftIcon={<Building2 className="h-4 w-4" />} placeholder="you@yourbusiness.in" value={form.contactEmail} onChange={set('contactEmail')} />
          <Field label="Contact phone" placeholder="+91 98xxx xxxxx" value={form.contactPhone} onChange={set('contactPhone')} />
          <Field label="Service radius (km)" type="number" inputMode="decimal" min={0} value={form.radiusKm} onChange={set('radiusKm')} />
          <Field label="Trade licence number" value={form.tradeLicenceNumber} onChange={set('tradeLicenceNumber')} hint={profile.tradeLicenceVerifiedAt ? 'Verified' : 'Verified manually after you submit it.'} />
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" loading={save.isPending}>Save details</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------ payout account --- */

function PayoutAccount({ profile }: { profile: VendorProfileDetail }) {
  const toast = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    settlementAccountName: profile.settlementAccountName ?? '',
    settlementAccountNumber: profile.settlementAccountNumber ?? '',
    settlementIfsc: profile.settlementIfsc ?? '',
  });
  const [err, setErr] = useState<string>();

  const save = useMutation({
    mutationFn: () => {
      const patch: UpdateVendorProfileInput = {};
      if (form.settlementAccountName.trim()) patch.settlementAccountName = form.settlementAccountName.trim();
      if (form.settlementAccountNumber.trim()) patch.settlementAccountNumber = form.settlementAccountNumber.trim();
      if (form.settlementIfsc.trim()) patch.settlementIfsc = form.settlementIfsc.trim().toUpperCase();
      return vendorApi.updateProfile(patch);
    },
    onSuccess: (data) => {
      qc.setQueryData(['vendorProfile'], data);
      toast.success('Payout account saved.');
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not save the payout account.'),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    if (form.settlementIfsc.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.settlementIfsc.trim().toUpperCase())) {
      return setErr('IFSC should be 4 letters, a 0, then 6 characters (e.g. HDFC0001234).');
    }
    save.mutate();
  }

  return (
    <Card>
      <CardHeader title="Payout account" action={<Badge tone="neutral">Self-declared</Badge>} />
      <CardBody>
        <p className="mb-md text-caption text-ink-60">
          Where settlements will be sent. This is your own account detail, not a credential. It is never shown to residents or societies.
        </p>
        <form onSubmit={submit} className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field label="Account holder name" leftIcon={<Landmark className="h-4 w-4" />} value={form.settlementAccountName} onChange={set('settlementAccountName')} />
          <Field label="Account number" inputMode="numeric" value={form.settlementAccountNumber} onChange={set('settlementAccountNumber')} hint="6 to 20 digits." />
          <Field label="IFSC" value={form.settlementIfsc} onChange={set('settlementIfsc')} className="uppercase" placeholder="HDFC0001234" />
          <div className="sm:col-span-2">
            {err && <p role="alert" className="mb-sm text-caption text-feedback-danger">{err}</p>}
            <div className="flex justify-end">
              <Button type="submit" loading={save.isPending}>Save payout account</Button>
            </div>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------- categories --- */

function Categories({ profile }: { profile: VendorProfileDetail }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const mutate = async (fn: () => Promise<VendorProfileDetail>, key: string) => {
    setBusy(key);
    try {
      const data = await fn();
      qc.setQueryData(['vendorProfile'], data);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update categories.');
    } finally {
      setBusy(null);
    }
  };

  const add = (category: string) => {
    const c = category.trim();
    if (!c || profile.categories.some((x) => x.toLowerCase() === c.toLowerCase())) return;
    mutate(() => vendorApi.addCategory(c), c);
    setDraft('');
  };

  const suggestions = VENDOR_CATEGORY_PRESETS.filter((c) => !profile.categories.some((x) => x.toLowerCase() === c.toLowerCase()));

  return (
    <Card>
      <CardHeader title="Categories" action={<Badge tone="neutral"><Tags className="h-3.5 w-3.5" />{profile.categories.length}</Badge>} />
      <CardBody className="space-y-md">
        <div className="flex flex-wrap gap-xs">
          {profile.categories.length === 0 && <span className="text-caption text-ink-40">No categories yet. Add the services you offer.</span>}
          {profile.categories.map((c) => (
            <span key={c} className="inline-flex items-center gap-xs rounded-pill bg-accent-700/[0.08] py-[4px] pl-sm pr-xs text-caption font-medium text-accent-800">
              {c}
              <button
                aria-label={`Remove ${c}`}
                disabled={busy === c}
                onClick={() => mutate(() => vendorApi.removeCategory(c), c)}
                className="flex h-4 w-4 items-center justify-center rounded-full text-accent-800/70 transition-colors hover:bg-accent-700/[0.16] hover:text-accent-800 disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); add(draft); }} className="flex items-end gap-sm">
          <div className="flex-1">
            <Field label="Add a category" placeholder="Type and press Add" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" icon={<Plus className="h-4 w-4" />} loading={busy === draft.trim()} disabled={!draft.trim()}>Add</Button>
        </form>

        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-xs">
            {suggestions.slice(0, 8).map((c) => (
              <button
                key={c}
                onClick={() => add(c)}
                disabled={busy === c}
                className="rounded-pill border border-border-divider bg-bg-elevated px-sm py-[4px] text-caption text-ink-60 transition-colors hover:bg-bg-secondary disabled:opacity-40"
              >
                + {c}
              </button>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------- bits --- */

function ReadOnly({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="flex flex-col gap-xxs">
      <span className="text-caption font-medium text-ink-80">{label}</span>
      <div className="flex h-11 items-center gap-xs rounded-md border border-border-subtle bg-bg-secondary px-sm">
        <span className="truncate text-body text-ink-60">{value}</span>
        {badge && <Badge tone="success">{badge}</Badge>}
      </div>
    </div>
  );
}

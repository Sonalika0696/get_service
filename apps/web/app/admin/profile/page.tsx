'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Mail,
  Phone,
  ShieldCheck,
  Building2,
  Home,
  Sun,
  Moon,
  UserCog,
  Wallet,
  ChevronRight,
  LogOut,
  BadgeCheck,
  Bell,
  Lock,
  Laptop,
  Smartphone,
  X,
  Save,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { auth, identity as identityApi } from '@/lib/endpoints';
import { getIdentity, clearIdentity, type IdentityHint } from '@/lib/session';
import { getCurrentTheme, setTheme, type Theme } from '@/lib/theme';
import { staggerContainer, riseItem } from '@/lib/motion';
import { cn } from '@/lib/cn';

const OCCUPANCY_LABELS: Record<string, string> = {
  OWNER_OCCUPIER: 'Owner, resident',
  OWNER_ABSENTEE: 'Owner, non-resident',
  TENANT: 'Tenant',
};

function initialsFor(name?: string | null): string {
  if (!name) return 'GX';
  // Ignore parenthetical/role suffixes like "(Committee)" so initials read cleanly.
  const parts = name.trim().split(/\s+/).filter((p) => /^[A-Za-z0-9]/.test(p));
  if (parts.length === 0) return 'GX';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function AdminProfilePage() {
  const [hint, setHint] = useState<IdentityHint | null>(null);
  useEffect(() => setHint(getIdentity()), []);

  const isResident = hint?.principalKind === 'RESIDENT';
  const me = useQuery({ queryKey: ['me'], queryFn: identityApi.me, enabled: isResident });

  const name = me.data?.name ?? hint?.name ?? 'Your account';
  const email = me.data?.email ?? hint?.email ?? '';
  const phone = me.data?.phone ?? null;
  const roleLabel = hint?.roleLabel ?? 'Administrator';
  const occupancy = me.data?.occupancyRole ? OCCUPANCY_LABELS[me.data.occupancyRole] ?? me.data.occupancyRole : null;
  const kyc = me.data?.kycTier ?? null;
  const societyId = me.data?.societyId ?? hint?.societyId ?? null;

  return (
    <>
      <PageHeader title="Profile" subtitle="Your account details, preferences and tools." />

      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="mx-auto max-w-3xl space-y-lg">
        {/* Identity header */}
        <motion.div variants={riseItem}>
          <Card className="p-md">
            <div className="flex flex-col items-center gap-md text-center sm:flex-row sm:text-left">
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-bg-elevated bg-accent-700/[0.10] text-heading font-semibold text-accent-800 shadow-sm">
                {initialsFor(name)}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-heading font-semibold text-ink-100">{name}</h2>
                <p className="mt-xxs break-words text-body text-ink-60">
                  {[email, phone].filter(Boolean).join('  ·  ') || ' '}
                </p>
                <div className="mt-sm flex flex-wrap justify-center gap-xs sm:justify-start">
                  <Badge tone="accent"><ShieldCheck className="h-3.5 w-3.5" />{roleLabel}</Badge>
                  {occupancy && <Badge tone="neutral">{occupancy}</Badge>}
                  {kyc && <Badge tone="neutral">KYC {kyc}</Badge>}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Account details */}
        <motion.div variants={riseItem}>
          <Card>
            <CardHeader title="Account details" />
            <CardBody>
              {isResident && me.isLoading ? (
                <div className="space-y-md">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full max-w-sm" />)}
                </div>
              ) : (
                <dl className="grid grid-cols-1 gap-md sm:grid-cols-2">
                  <Detail icon={UserCog} label="Full name" value={name} />
                  <Detail icon={Mail} label="Email" value={email || 'Not on file'} />
                  <Detail icon={Phone} label="Phone" value={phone ?? 'Not on file'} />
                  <Detail icon={ShieldCheck} label="Role" value={roleLabel} />
                  {occupancy && <Detail icon={Home} label="Occupancy" value={occupancy} />}
                  <Detail
                    icon={BadgeCheck}
                    label="Identity check"
                    value={kyc ? `KYC ${kyc}` : 'Not verified'}
                    badge={kyc && kyc !== 'NONE' ? 'Verified' : undefined}
                  />
                  {societyId && <Detail icon={Building2} label="Society" value={societyId} mono />}
                </dl>
              )}
              <p className="mt-md text-caption text-ink-40">
                Your name and contact details are held in your society's records. To change them, ask your society to update your resident record.
              </p>
            </CardBody>
          </Card>
        </motion.div>

        {/* Preferences */}
        <motion.div variants={riseItem}>
          <Card>
            <CardHeader title="Preferences" />
            <div className="divide-y divide-border-subtle">
              <ThemeRow />
              <NotificationsRow />
              <SecurityRow />
            </div>
          </Card>
        </motion.div>

        {/* Committee tools */}
        <motion.div variants={riseItem}>
          <Card>
            <CardHeader title="Admin tools" />
            <div className="divide-y divide-border-subtle">
              <NavRow icon={ShieldCheck} title="Resident approvals" subtitle="Ratify new residents joining the society" href="/admin/ratifications" />
              <NavRow icon={Wallet} title="Spending rules" subtitle="Approval thresholds for payments" href="/admin/approvals" />
              <NavRow icon={Building2} title="Finances" subtitle="Fund balances and record integrity" href="/admin/treasury" />
            </div>
          </Card>
        </motion.div>

        {/* Session */}
        <motion.div variants={riseItem}>
          <Card>
            <CardHeader title="Session" />
            <div className="divide-y divide-border-subtle">
              <SignOutRow />
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </>
  );
}

/* ---------------------------------------------------------------- bits --- */

function Detail({
  icon: Icon,
  label,
  value,
  badge,
  mono,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  badge?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="flex items-center gap-xs text-caption font-medium text-ink-80">
        <Icon className="h-4 w-4 text-ink-40" /> {label}
      </dt>
      <dd className="mt-xxs flex items-center gap-xs">
        <span className={cn('break-words text-body text-ink-100', mono && 'font-mono text-caption')}>{value}</span>
        {badge && <Badge tone="success">{badge}</Badge>}
      </dd>
    </div>
  );
}

/** Value-row: icon chip, title/subtitle, optional right value, caret. */
function Row({
  icon: Icon,
  title,
  subtitle,
  right,
  danger,
  showCaret = true,
}: {
  icon: typeof Mail;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  danger?: boolean;
  showCaret?: boolean;
}) {
  return (
    <span className="flex w-full items-center gap-sm px-lg py-md">
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          danger ? 'bg-feedback-danger/[0.10]' : 'bg-accent-700/[0.10]',
        )}
      >
        <Icon className={cn('h-[18px] w-[18px]', danger ? 'text-feedback-danger' : 'text-accent-700')} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className={cn('block text-body font-semibold', danger ? 'text-feedback-danger' : 'text-ink-100')}>{title}</span>
        {subtitle && <span className="block truncate text-caption text-ink-60">{subtitle}</span>}
      </span>
      {right}
      {showCaret && <ChevronRight className="h-4 w-4 shrink-0 text-ink-40" />}
    </span>
  );
}

function NavRow({ icon, title, subtitle, href }: { icon: typeof Mail; title: string; subtitle?: string; href: string }) {
  return (
    <Link href={href} className="block transition-colors hover:bg-bg-secondary">
      <Row icon={icon} title={title} subtitle={subtitle} />
    </Link>
  );
}

/* -------------------------------------------------------- notifications --- */

interface NotificationPref {
  key: string;
  label: string;
  hint: string;
  enabled: boolean;
}

const INITIAL_NOTIFICATIONS: NotificationPref[] = [
  { key: 'requests', label: 'New resident requests', hint: 'A resident raises a pooled service request', enabled: true },
  { key: 'payments', label: 'Payments received', hint: 'A credit lands and needs allocation', enabled: true },
  { key: 'approvals', label: 'Approvals needed', hint: 'A payout or transfer is waiting on your signature', enabled: true },
  { key: 'digest', label: 'Weekly digest', hint: 'A Monday summary of the society’s finances', enabled: false },
];

function NotificationsRow() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(INITIAL_NOTIFICATIONS);
  const onCount = prefs.filter((p) => p.enabled).length;

  function toggle(key: string) {
    setPrefs((prev) => prev.map((p) => (p.key === key ? { ...p, enabled: !p.enabled } : p)));
  }

  function save() {
    toast.success('Notification preferences saved.');
    setOpen(false);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full transition-colors hover:bg-bg-secondary">
        <Row icon={Bell} title="Notifications" subtitle="Choose what you get notified about" right={<span className="text-caption text-ink-40">{onCount} on</span>} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Notifications" description="Choose what you get notified about." footer={<Button icon={<Save className="h-4 w-4" />} onClick={save}>Save</Button>}>
        <div className="flex flex-col gap-md">
          {prefs.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-md">
              <div>
                <p className="text-body font-medium text-ink-100">{p.label}</p>
                <p className="text-caption text-ink-40">{p.hint}</p>
              </div>
              <Switch checked={p.enabled} onChange={() => toggle(p.key)} label={p.label} />
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------ security --- */

interface Session {
  id: string;
  device: string;
  location: string;
  lastActive: string;
  current: boolean;
}

const INITIAL_SESSIONS: Session[] = [
  { id: 's1', device: 'Chrome on Windows', location: 'Mumbai, India', lastActive: 'Active now', current: true },
  { id: 's2', device: 'Safari on iPhone', location: 'Pune, India', lastActive: '2 days ago', current: false },
];

function SecurityRow() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [twoFactor, setTwoFactor] = useState(true);
  const [sessions, setSessions] = useState(INITIAL_SESSIONS);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string>();

  function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    if (!current || !next) return setErr('Fill in your current and new password.');
    if (next !== confirm) return setErr('New password and confirmation do not match.');
    if (next.length < 8) return setErr('New password should be at least 8 characters.');
    toast.success('Password updated.');
    setCurrent('');
    setNext('');
    setConfirm('');
  }

  function signOutSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    toast.show('Session signed out.', 'info');
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full transition-colors hover:bg-bg-secondary">
        <Row icon={Lock} title="Security" subtitle="Password, two-factor and active sessions" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Security" description="Password, two-factor authentication and active sessions.">
        <div className="flex flex-col gap-lg">
          <form onSubmit={changePassword} className="flex flex-col gap-md">
            <p className="text-overline uppercase text-ink-40">Change password</p>
            <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <div className="grid grid-cols-2 gap-md">
              <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              <Field label="Confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={err} />
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm">Update password</Button>
            </div>
          </form>

          <div className="flex items-center justify-between border-t border-border-subtle pt-md">
            <div>
              <p className="text-body font-medium text-ink-100">Two-factor authentication</p>
              <p className="text-caption text-ink-40">Require a code from your authenticator app at sign-in.</p>
            </div>
            <Switch checked={twoFactor} onChange={setTwoFactor} label="Two-factor authentication" />
          </div>

          <div className="border-t border-border-subtle pt-md">
            <p className="mb-sm text-overline uppercase text-ink-40">Active sessions</p>
            <ul className="flex flex-col gap-sm">
              {sessions.map((s) => {
                const Icon = s.device.includes('iPhone') ? Smartphone : Laptop;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-sm">
                    <span className="flex items-center gap-sm">
                      <Icon className="h-4 w-4 text-ink-40" />
                      <span>
                        <span className="block text-caption font-medium text-ink-100">{s.device}{s.current && <Badge tone="accent" className="ml-xs">This device</Badge>}</span>
                        <span className="block text-caption text-ink-40">{s.location} · {s.lastActive}</span>
                      </span>
                    </span>
                    {!s.current && (
                      <button type="button" onClick={() => signOutSession(s.id)} aria-label={`Sign out ${s.device}`} className="rounded-md p-xxs text-ink-40 transition-colors hover:bg-feedback-dangerTint hover:text-feedback-danger">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Modal>
    </>
  );
}

function ThemeRow() {
  const [theme, setThemeState] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setThemeState(getCurrentTheme());
    setMounted(true);
  }, []);

  const isDark = mounted && theme === 'dark';
  const Icon = isDark ? Moon : Sun;

  function toggle() {
    const next: Theme = isDark ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  }

  return (
    <button type="button" onClick={toggle} className="block w-full transition-colors hover:bg-bg-secondary">
      <Row
        icon={Icon}
        title="Theme"
        subtitle="Switch between light and dark"
        right={<span className="text-caption font-semibold text-accent-800">{mounted ? (isDark ? 'Dark' : 'Light') : ''}</span>}
        showCaret={false}
      />
    </button>
  );
}

function SignOutRow() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function onSignOut() {
    setBusy(true);
    try {
      await auth.logout();
    } catch {
      /* clear locally regardless of network result */
    }
    clearIdentity();
    toast.success('Signed out.');
    router.replace('/login');
  }

  return (
    <button type="button" onClick={onSignOut} disabled={busy} className="block w-full transition-colors hover:bg-bg-secondary disabled:opacity-60">
      <Row icon={LogOut} title="Sign out" subtitle="You will need to sign in again" danger showCaret={false} />
    </button>
  );
}

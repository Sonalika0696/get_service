'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Mail, Lock, KeyRound, ShieldCheck, ArrowLeft, Store, Building2, TerminalSquare } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Field } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { auth, identity as identityApi } from '@/lib/endpoints';
import { setIdentity, identityFromSession } from '@/lib/session';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

type Portal = 'admin' | 'vendor';

const ROLE_FROM_KINDS = (kinds: string[]): string => {
  if (kinds.includes('TREASURER') || kinds.includes('COMMITTEE') || kinds.includes('DEPUTY_TREASURER')) return 'Administrator';
  return 'Administrator';
};

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();

  const [portal, setPortal] = useState<Portal>('admin');

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />

      <div className="flex items-center justify-center px-lg py-2xl">
        <div className="w-full max-w-[420px]">
          <div className="mb-xl lg:hidden">
            <Logo />
          </div>

          <span className="text-overline uppercase text-accent-700">Management console</span>
          <h1 className="mt-xs text-display font-semibold tracking-tight text-ink-100">Welcome back</h1>
          <p className="mt-xs text-body text-ink-60">Sign in to the portal for your role.</p>

          {/* Portal switch */}
          <div className="mt-lg grid grid-cols-2 gap-xs rounded-xl border border-border-subtle bg-bg-secondary p-[4px]">
            <SegButton active={portal === 'admin'} onClick={() => setPortal('admin')} icon={Building2}>
              Admin
            </SegButton>
            <SegButton active={portal === 'vendor'} onClick={() => setPortal('vendor')} icon={Store}>
              Vendor
            </SegButton>
          </div>

          <div className="mt-lg">
            <AnimatePresence mode="wait">
              {portal === 'admin' ? (
                <motion.div key="admin" {...swap}>
                  <CommitteeForm
                    onDone={(name, email, roleLabel, societyId) => {
                      setIdentity({ portal: 'admin', name, email, principalKind: 'RESIDENT', roleLabel, societyId });
                      toast.success('Signed in.');
                      router.replace('/admin');
                    }}
                  />
                </motion.div>
              ) : (
                <motion.div key="vendor" {...swap}>
                  <OfficerForm
                    kind="vendor"
                    onDone={(name, email) => {
                      setIdentity({ portal: 'vendor', name, email, principalKind: 'VENDOR', roleLabel: 'Vendor' });
                      toast.success('Signed in to the vendor portal.');
                      router.replace('/vendor');
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <DevPanel />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------- dev quick sign-in --- */

const DEV_ACCOUNTS = [
  { label: 'Admin', caption: 'Full access', email: 'committee@test-society.local', icon: Building2 },
  { label: 'Vendor', caption: 'CoolBreeze AC Services', email: 'vendor@coolbreeze.local', icon: Store },
];

function DevPanel() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (process.env.NODE_ENV === 'production') return null;

  async function signIn(email: string) {
    setBusy(email);
    try {
      await auth.devLogin(email);
      const s = await auth.session();
      const id = identityFromSession(s);
      setIdentity(id);
      toast.success(`Dev sign-in as ${id.roleLabel.toLowerCase()}.`);
      router.replace(`/${id.portal}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Dev sign-in failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-xl rounded-xl border border-dashed border-border-divider bg-bg-secondary/50 p-md">
      <div className="mb-sm flex items-center gap-xs text-ink-40">
        <TerminalSquare className="h-4 w-4" />
        <span className="text-overline uppercase">Developer sign-in</span>
      </div>
      <div className="flex flex-col gap-xs">
        {DEV_ACCOUNTS.map((a) => (
          <Button
            key={a.email}
            variant="secondary"
            size="sm"
            className="justify-between"
            loading={busy === a.email}
            onClick={() => signIn(a.email)}
          >
            <span className="flex items-center gap-xs">
              <a.icon className="h-4 w-4" />
              <span className="flex flex-col items-start leading-tight">
                <span>{a.label}</span>
                <span className="text-[11px] font-normal text-ink-40">{a.caption}</span>
              </span>
            </span>
            <span className="text-ink-40">{a.email}</span>
          </Button>
        ))}
      </div>
      <p className="mt-xs text-[11px] text-ink-40">Local only. Disabled in production builds.</p>
    </div>
  );
}

const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const },
};

/* -------------------------------------------------- committee (OTP) --- */

function CommitteeForm({
  onDone,
}: {
  onDone: (name: string, email: string, roleLabel: string, societyId: string) => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    setBusy(true);
    try {
      await auth.requestOtp(email.trim());
      toast.success('We sent a 6-digit code to your email.');
      setStep('code');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    setBusy(true);
    try {
      await auth.verifyOtp(email.trim(), code.trim());
      const me = await identityApi.me();
      onDone(me.name, me.email, ROLE_FROM_KINDS(me.roleKinds), me.societyId);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'That code did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence mode="wait">
      {step === 'email' ? (
        <motion.form key="email" {...swap} onSubmit={requestCode} className="flex flex-col gap-md">
          <Field
            label="Work email"
            type="email"
            required
            autoComplete="email"
            leftIcon={<Mail className="h-4 w-4" />}
            placeholder="you@society.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={err}
          />
          <Button type="submit" size="lg" loading={busy} className="mt-xs w-full">
            Send code
          </Button>
          <p className="text-center text-caption text-ink-40">
            Admins sign in with a one-time code sent to their email.
          </p>
        </motion.form>
      ) : (
        <motion.form key="code" {...swap} onSubmit={verify} className="flex flex-col gap-md">
          <button
            type="button"
            onClick={() => setStep('email')}
            className="flex w-fit items-center gap-xxs text-caption text-ink-60 transition-colors hover:text-ink-80"
          >
            <ArrowLeft className="h-4 w-4" /> {email}
          </button>
          <Field
            label="6-digit code"
            inputMode="numeric"
            maxLength={6}
            required
            autoFocus
            leftIcon={<KeyRound className="h-4 w-4" />}
            placeholder="000000"
            className="tabular tracking-[0.4em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            error={err}
          />
          <Button type="submit" size="lg" loading={busy} className="w-full">
            Verify and continue
          </Button>
        </motion.form>
      )}
    </AnimatePresence>
  );
}

/* --------------------------------------------- officer (password+2FA) --- */

function OfficerForm({
  kind,
  onDone,
}: {
  kind: 'operator' | 'vendor';
  onDone: (name: string, email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    setBusy(true);
    try {
      const res = await auth.officerLogin(email.trim(), password, totp.trim());
      onDone(res.name, res.email);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-md">
      <Field
        label="Email"
        type="email"
        required
        autoComplete="email"
        leftIcon={<Mail className="h-4 w-4" />}
        placeholder={kind === 'vendor' ? 'you@yourbusiness.in' : 'operator@gatex.app'}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Password"
        type="password"
        required
        autoComplete="current-password"
        leftIcon={<Lock className="h-4 w-4" />}
        placeholder="Your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Field
        label="Authenticator code"
        inputMode="numeric"
        maxLength={6}
        required
        leftIcon={<ShieldCheck className="h-4 w-4" />}
        placeholder="000000"
        hint="From your authenticator app. 2FA is mandatory for this account."
        className="tabular tracking-[0.3em]"
        value={totp}
        onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
        error={err}
      />
      <Button type="submit" size="lg" loading={busy} className="mt-xs w-full">
        Sign in
      </Button>
    </form>
  );
}

/* ----------------------------------------------------------- pieces --- */

function SegButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Store;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center justify-center gap-xs rounded-lg py-sm text-caption font-semibold transition-colors',
        active ? 'text-accent-800' : 'text-ink-60 hover:text-ink-80',
      )}
    >
      {active && (
        <motion.span
          layoutId="portal-seg"
          className="absolute inset-0 -z-10 rounded-lg bg-bg-elevated shadow-sm"
          transition={{ type: 'spring', stiffness: 480, damping: 38 }}
        />
      )}
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function MethodTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative -mb-px pb-sm text-body font-medium transition-colors',
        active ? 'text-ink-100' : 'text-ink-40 hover:text-ink-60',
      )}
    >
      {children}
      {active && (
        <motion.span layoutId="method-tab" className="absolute inset-x-0 bottom-0 h-[2px] rounded-pill bg-accent-700" />
      )}
    </button>
  );
}

function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-ink-100 lg:block">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 15% 10%, #0F766E 0%, #115E59 38%, #14181A 100%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'linear-gradient(#5EEAD4 1px, transparent 1px), linear-gradient(90deg, #5EEAD4 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="relative flex h-full flex-col justify-between p-2xl">
        <Logo onDark />
        <div>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-md text-[40px] font-semibold leading-[1.1] tracking-tight text-white"
          >
            The financial-operations layer for your society.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="mt-md max-w-md text-body text-white/70"
          >
            Metered utility recovery, pooled procurement against published pricing cards, and a
            tamper-evident approval ladder. Every rupee traceable to its source.
          </motion.p>
        </div>
        <div className="flex gap-lg text-white/60">
          {['Hash-chained audit', 'No fund-holding', 'Compliance by construction'].map((f) => (
            <span key={f} className="text-caption">
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LogOut, ChevronDown, UserCog } from 'lucide-react';
import { auth } from '@/lib/endpoints';
import { clearIdentity, type IdentityHint } from '@/lib/session';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/theme/theme-toggle';

export function Topbar({ identity }: { identity: IdentityHint | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  async function onLogout() {
    try {
      await auth.logout();
    } catch {
      /* clear locally regardless of network result */
    }
    clearIdentity();
    toast.success('Signed out.');
    router.replace('/login');
  }

  const initials = (identity?.name ?? 'GX')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-end gap-md border-b border-border-subtle bg-bg-primary/80 px-lg backdrop-blur-md">
      <div className="flex items-center gap-sm">
        <ThemeToggle />

        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-sm rounded-pill border border-border-divider bg-bg-elevated py-[6px] pl-[6px] pr-sm transition-colors hover:bg-bg-secondary"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-pill bg-accent-700 text-caption font-semibold text-ink-onAccent">
              {initials}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-caption font-semibold leading-tight text-ink-100">
                {identity?.name ?? 'Signed in'}
              </span>
              <span className="block text-[11px] leading-tight text-ink-40">{identity?.roleLabel ?? ''}</span>
            </span>
            <ChevronDown className={cn('h-4 w-4 text-ink-40 transition-transform', open && 'rotate-180')} />
          </button>

          <AnimatePresence>
            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 z-20 mt-xs w-56 overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated shadow-lg"
                >
                  <div className="border-b border-border-subtle px-md py-sm">
                    <p className="text-caption font-semibold text-ink-100">{identity?.name}</p>
                    <p className="truncate text-[11px] text-ink-40">{identity?.email}</p>
                  </div>
                  <Link
                    href={`/${identity?.portal ?? 'admin'}/profile`}
                    onClick={() => setOpen(false)}
                    className="flex w-full items-center gap-sm border-b border-border-subtle px-md py-sm text-caption text-ink-80 transition-colors hover:bg-bg-secondary"
                  >
                    <UserCog className="h-4 w-4 text-ink-40" />
                    Profile
                  </Link>
                  <button
                    onClick={onLogout}
                    className="flex w-full items-center gap-sm px-md py-sm text-caption text-feedback-danger transition-colors hover:bg-feedback-dangerTint"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

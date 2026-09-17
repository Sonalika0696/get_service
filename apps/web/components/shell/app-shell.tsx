'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { getIdentity, setIdentity, clearIdentity, identityFromSession, type IdentityHint, type Portal } from '@/lib/session';
import { auth } from '@/lib/endpoints';
import { cn } from '@/lib/cn';
import { Logo } from '@/components/brand/logo';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { adminNav, vendorNav, type NavGroup } from './nav-config';

const NAV: Record<Portal, { groups: NavGroup[]; label: string }> = {
  admin: { groups: adminNav, label: 'Admin console' },
  vendor: { groups: vendorNav, label: 'Vendor portal' },
};

export function AppShell({ portal, children }: { portal: Portal; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [identity, setIdentityState] = useState<IdentityHint | null>(null);
  const [ready, setReady] = useState(false);
  const [drawer, setDrawer] = useState(false);

  const { groups, label } = NAV[portal];

  useEffect(() => {
    let cancelled = false;

    // Optimistic: render immediately from the cached hint if it fits this portal.
    const cached = getIdentity();
    if (cached && cached.portal === portal) {
      setIdentityState(cached);
      setReady(true);
    }

    // Authoritative: the session cookie decides. /auth/session serves any
    // principal kind, so the localStorage hint is only a cache.
    (async () => {
      try {
        const s = await auth.session();
        if (cancelled) return;
        const id = identityFromSession(s);
        setIdentity(id);
        if (id.portal !== portal) {
          router.replace(`/${id.portal}`);
          return;
        }
        setIdentityState(id);
        setReady(true);
      } catch {
        if (cancelled) return;
        clearIdentity();
        router.replace('/login');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [portal, router]);

  useEffect(() => setDrawer(false), [pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg-primary">
        <Logo />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-bg-primary">
      <Sidebar groups={groups} portalLabel={label} />

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-[800] lg:hidden">
            <motion.div
              className="absolute inset-0 bg-[var(--overlay-scrim)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
            />
            <motion.div
              className="absolute left-0 top-0 h-full w-[264px] bg-bg-elevated"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            >
              <div className="flex h-16 items-center justify-between px-lg">
                <Logo />
                <button onClick={() => setDrawer(false)} aria-label="Close menu" className="text-ink-40">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="px-sm py-md">
                {groups.map((group, gi) => (
                  <div
                    key={group.label}
                    className={gi > 0 ? 'mt-md border-t border-border-subtle pt-md' : ''}
                  >
                    <p className="px-sm pb-xs text-overline uppercase text-ink-40">{group.label}</p>
                    {group.items.map((item) => {
                      const active =
                        item.href === `/${portal}` ? pathname === item.href : pathname.startsWith(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            'flex items-center gap-sm rounded-md px-sm py-[9px] text-body',
                            active ? 'bg-accent-700/[0.08] font-semibold text-accent-800' : 'text-ink-60',
                          )}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center lg:hidden">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            className="ml-md mt-md flex h-10 w-10 items-center justify-center rounded-md border border-border-divider bg-bg-elevated text-ink-60"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        <Topbar identity={identity} />
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-lg py-lg">{children}</main>
      </div>
    </div>
  );
}

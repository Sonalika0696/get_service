'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';
import { Logo } from '@/components/brand/logo';
import type { NavGroup } from './nav-config';

export function Sidebar({ groups, portalLabel }: { groups: NavGroup[]; portalLabel: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[264px] shrink-0 flex-col border-r border-border-subtle bg-bg-elevated dark:bg-bg-primary lg:flex">
      <div className="flex h-16 items-center px-lg">
        <Logo />
      </div>
      <div className="px-lg pb-md">
        <span className="text-overline uppercase text-ink-40">{portalLabel}</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-sm pb-lg">
        {groups.map((group, gi) => (
          <div
            key={group.label}
            className={gi > 0 ? 'mt-md border-t border-border-subtle pt-md' : ''}
          >
            <p className="px-sm pb-xs text-overline uppercase text-ink-40">{group.label}</p>
            <ul className="space-y-[2px]">
              {group.items.map((item) => {
                const active =
                  item.href === '/admin' || item.href === '/vendor'
                    ? pathname === item.href
                    : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'relative flex items-center gap-sm rounded-md px-sm py-[9px] text-body transition-colors',
                        active
                          ? 'font-semibold text-accent-800'
                          : 'text-ink-60 hover:bg-bg-secondary hover:text-ink-80',
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="nav-active"
                          className="absolute inset-0 -z-10 rounded-md bg-accent-700/[0.08]"
                          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                        />
                      )}
                      <span className="flex-1">{item.label}</span>
                      {item.soon && (
                        <span className="rounded-pill bg-bg-secondary px-xs py-[1px] text-[10px] font-medium uppercase tracking-wide text-ink-40">
                          Soon
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

import {
  LayoutDashboard,
  UserCheck,
  Store,
  ClipboardList,
  Wallet,
  ShieldCheck,
  Gauge,
  Receipt,
  FileText,
  Star,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Marks a screen whose backend is not built yet. */
  soon?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const adminNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', href: '/admin', icon: LayoutDashboard }],
  },
  {
    label: 'Community',
    items: [
      { label: 'Resident approvals', href: '/admin/ratifications', icon: UserCheck },
      { label: 'Vendors', href: '/admin/vendors', icon: Store },
    ],
  },
  {
    label: 'Services',
    items: [
      { label: 'Group buying', href: '/admin/requests', icon: ClipboardList },
      { label: 'Utility bills', href: '/admin/billing', icon: Zap, soon: true },
    ],
  },
  {
    label: 'Money',
    items: [
      { label: 'Payments & dues', href: '/admin/collections', icon: Wallet },
      { label: 'Spending rules', href: '/admin/approvals', icon: ShieldCheck },
      { label: 'Finances', href: '/admin/treasury', icon: Gauge },
    ],
  },
];

export const vendorNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', href: '/vendor', icon: LayoutDashboard }],
  },
  {
    label: 'Business',
    items: [
      { label: 'Pricing cards', href: '/vendor/pricing', icon: Receipt },
      { label: 'Engagements', href: '/vendor/engagements', icon: ClipboardList, soon: true },
      { label: 'Charge sheets', href: '/vendor/charge-sheets', icon: FileText, soon: true },
      { label: 'Reputation', href: '/vendor/reputation', icon: Star, soon: true },
    ],
  },
  {
    label: 'Account',
    items: [{ label: 'Profile', href: '/vendor/profile', icon: UserCheck }],
  },
];

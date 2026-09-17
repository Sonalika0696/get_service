import { AppShell } from '@/components/shell/app-shell';

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return <AppShell portal="vendor">{children}</AppShell>;
}

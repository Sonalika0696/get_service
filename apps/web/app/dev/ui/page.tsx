'use client';

import { useState } from 'react';
import { Plus, Store, Wallet, UserCheck, ShieldCheck } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { Logo } from '@/components/brand/logo';
import { useToast } from '@/components/ui/toast';

export default function DevUi() {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto max-w-[1100px] space-y-lg p-lg">
      <div className="flex items-center justify-between">
        <Logo />
        <span className="text-caption text-ink-40">Design system playground</span>
      </div>

      <section className="grid grid-cols-2 gap-md lg:grid-cols-4">
        <StatCard label="Vendors" value={4} icon={Store} accent="teal" />
        <StatCard label="Pending" value={12} icon={UserCheck} accent="amber" />
        <StatCard label="Collected" value="9.8L" icon={Wallet} accent="sky" />
        <StatCard label="Chain" value="Intact" icon={ShieldCheck} accent="violet" />
      </section>

      <Card>
        <CardHeader title="Buttons and badges" />
        <CardBody className="flex flex-wrap items-center gap-md">
          <Button icon={<Plus className="h-4 w-4" />}>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
        <Card>
          <CardHeader title="Inputs" />
          <CardBody className="space-y-md">
            <Field label="Email" placeholder="you@society.org" hint="A helper line." />
            <Field label="With error" placeholder="000000" error="That code did not work." />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Feedback" />
          <CardBody className="space-y-md">
            <div className="flex flex-wrap gap-sm">
              <Button variant="secondary" onClick={() => toast.success('Saved successfully.')}>Toast success</Button>
              <Button variant="secondary" onClick={() => toast.error('Something went wrong.')}>Toast error</Button>
              <Button variant="secondary" onClick={() => setOpen(true)}>Open modal</Button>
            </div>
            <div className="space-y-xs">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Example modal" description="Spring entrance, scrim, escape to close." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => setOpen(false)}>Confirm</Button></>}>
        <p className="text-body text-ink-60">Modal body content sits here.</p>
      </Modal>
    </div>
  );
}

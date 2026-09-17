import { ClipboardList } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { ComingSoon } from '@/components/ui/coming-soon';

export default function EngagementsPage() {
  return (
    <>
      <PageHeader title="Engagements" subtitle="Incoming pooled requests to confirm or decline." />
      <ComingSoon
        icon={ClipboardList}
        title="Engagement queue"
        sprint="Vendor Sprint 3"
        points={[
          'Incoming pooled requests assigned by committees',
          'Confirm or decline, and propose a service slot',
          'The pricing card freezes against the pool at confirmation',
          'The freeze is written to the audit chain and pushed to every participant',
        ]}
      />
    </>
  );
}

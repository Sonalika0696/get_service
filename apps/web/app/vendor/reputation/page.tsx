import { Star } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { ComingSoon } from '@/components/ui/coming-soon';

export default function ReputationPage() {
  return (
    <>
      <PageHeader title="Reputation" subtitle="A portable record that follows you across societies." />
      <ComingSoon
        icon={Star}
        title="Reputation and settlement"
        sprint="Vendor Sprint 5"
        points={[
          'Rating aggregate across every society you serve, from one identity',
          'Settlement status per pooled engagement',
          'Verification tier: unverified, society attested, platform audited',
          'History of completed job cards and acknowledgements',
        ]}
      />
    </>
  );
}

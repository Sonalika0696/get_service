import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { ComingSoon } from '@/components/ui/coming-soon';

export default function ChargeSheetsPage() {
  return (
    <>
      <PageHeader title="Charge sheets" subtitle="Itemised billing against the frozen card." />
      <ComingSoon
        icon={FileText}
        title="Charge sheets"
        sprint="Vendor Sprint 4"
        points={[
          'Submit an itemised charge sheet against the frozen pricing card',
          'Out-of-card lines are flagged automatically for participant acknowledgement',
          'Disputed lines route to committee adjudication',
          'One settlement per pooled engagement, less any hold-back',
        ]}
      />
    </>
  );
}

import { describe, expect, it } from 'vitest';
import { computeMilestoneAmount } from './milestone-amount.util.js';

/**
 * The approvals inbox shows an officer the amount a milestone authorisation
 * will pay. It must match BulkBuyService.authoriseMilestone exactly, so these
 * cases use the same figures as test/bulk-buy.e2e-spec.ts's LARGE-tier chain:
 * T = 1900, retention 10%, 40/60 split -> vendorPayable 1710, milestones 684
 * then 1026.
 */
describe('computeMilestoneAmount', () => {
  it('deducts retention from the offer percentage BEFORE it has been set aside (the first milestone)', () => {
    const amount = computeMilestoneAmount({
      jobCardsTotal: 1900,
      retentionSetAside: false,
      retentionAmount: 0,
      offerRetentionPct: 10,
      milestonePct: 40,
      isLastMilestone: false,
      alreadyPaidTotal: 0,
    });
    expect(amount.toString()).toBe('684');
  });

  it('would overstate the first milestone if the offer retention were ignored (the bug this guards against)', () => {
    const withoutRetention = computeMilestoneAmount({
      jobCardsTotal: 1900,
      retentionSetAside: false,
      retentionAmount: 0,
      offerRetentionPct: 0,
      milestonePct: 40,
      isLastMilestone: false,
      alreadyPaidTotal: 0,
    });
    expect(withoutRetention.toString()).toBe('760');
    expect(withoutRetention.toString()).not.toBe('684');
  });

  it('uses the persisted retention amount once set aside, ignoring the offer percentage', () => {
    const amount = computeMilestoneAmount({
      jobCardsTotal: 1900,
      retentionSetAside: true,
      retentionAmount: 190,
      offerRetentionPct: 99,
      milestonePct: 40,
      isLastMilestone: false,
      alreadyPaidTotal: 0,
    });
    expect(amount.toString()).toBe('684');
  });

  it('releases exactly the remainder of vendorPayable on the last milestone, so no rounding dust is stranded', () => {
    const amount = computeMilestoneAmount({
      jobCardsTotal: 1900,
      retentionSetAside: true,
      retentionAmount: 190,
      offerRetentionPct: 10,
      milestonePct: 60,
      isLastMilestone: true,
      alreadyPaidTotal: 684,
    });
    expect(amount.toString()).toBe('1026');
  });

  it('rounds a non-terminal milestone to 2dp', () => {
    const amount = computeMilestoneAmount({
      jobCardsTotal: 1000,
      retentionSetAside: false,
      retentionAmount: 0,
      offerRetentionPct: 7.5,
      milestonePct: 33.33,
      isLastMilestone: false,
      alreadyPaidTotal: 0,
    });
    // vendorPayable = 1000 - 75 = 925; 925 * 33.33% = 308.3025 -> 308.30
    expect(amount.toFixed(2)).toBe('308.30');
  });
});

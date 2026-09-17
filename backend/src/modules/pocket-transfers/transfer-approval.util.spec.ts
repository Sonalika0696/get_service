import { describe, expect, it } from 'vitest';
import { DEFAULT_APPROVAL_CONFIG, type ApprovalConfig } from '../bulk-buy/approval-ladder.util.js';
import { requiredTransferApprovers } from './transfer-approval.util.js';

describe('requiredTransferApprovers (Phase 9.6 Decision #4 — floor of 2)', () => {
  it('rung 1 (amount <= lowerThreshold) would normally be 1 officer — floored up to 2 for a pocket transfer', () => {
    expect(requiredTransferApprovers(100, DEFAULT_APPROVAL_CONFIG, 10)).toBe(2);
  });

  it('rung 2 (lowerThreshold < amount <= upperThreshold) is already 2 — floor is a no-op', () => {
    expect(requiredTransferApprovers(10_000, DEFAULT_APPROVAL_CONFIG, 10)).toBe(2);
  });

  it('rung 3 (amount > upperThreshold) uses the committee-majority math untouched when it already exceeds 2', () => {
    // ceil(0.5 * 10) = 5
    expect(requiredTransferApprovers(100_000, DEFAULT_APPROVAL_CONFIG, 10)).toBe(5);
  });

  it('rung 3 with a tiny roster still floors at 2 (majority-of-one is not a control)', () => {
    const config: ApprovalConfig = { lowerThreshold: 100, upperThreshold: 200, majorityFraction: 0.5 };
    // ceil(0.5 * 1) = 1, but requiredApprovers itself floors rung 3 at 2, and this wrapper agrees.
    expect(requiredTransferApprovers(1000, config, 1)).toBe(2);
  });

  it('a custom config whose rung 1 covers a large amount is still floored to 2', () => {
    const config: ApprovalConfig = { lowerThreshold: 1_000_000, upperThreshold: 2_000_000, majorityFraction: 0.5 };
    expect(requiredTransferApprovers(500_000, config, 10)).toBe(2);
  });
});

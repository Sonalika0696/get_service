import { describe, expect, it } from 'vitest';
import { computeTally } from './poll-tally.util.js';
import { VoteChoice } from '../../generated/prisma/enums.js';

describe('computeTally', () => {
  it('passes when quorum and passing thresholds are both cleared', () => {
    const result = computeTally({
      totalEligibleWeight: 10,
      votes: [
        { choice: VoteChoice.YES, weight: 6 },
        { choice: VoteChoice.NO, weight: 2 },
      ],
      quorumPct: 60, // needs castWeight >= 6
      passingPct: 50, // needs yes/(yes+no) >= 0.5
    });
    expect(result.castWeight).toBe(8);
    expect(result.quorumMet).toBe(true); // 8/10 = 0.8 >= 0.6
    expect(result.passed).toBe(true); // 6/8 = 0.75 >= 0.5
  });

  it('fails when quorum is not met even if every cast vote is YES', () => {
    const result = computeTally({
      totalEligibleWeight: 10,
      votes: [{ choice: VoteChoice.YES, weight: 3 }],
      quorumPct: 60, // needs castWeight >= 6, only 3 cast
      passingPct: 50,
    });
    expect(result.quorumMet).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails when quorum is met but YES share is below passingPct', () => {
    const result = computeTally({
      totalEligibleWeight: 10,
      votes: [
        { choice: VoteChoice.YES, weight: 4 },
        { choice: VoteChoice.NO, weight: 6 },
      ],
      quorumPct: 50,
      passingPct: 50,
    });
    expect(result.quorumMet).toBe(true); // 10/10 = 1.0
    expect(result.passed).toBe(false); // 4/10 = 0.4 < 0.5
  });

  it('ABSTAIN counts toward quorum (castWeight) but not toward the yes/no passing ratio', () => {
    const result = computeTally({
      totalEligibleWeight: 10,
      votes: [
        { choice: VoteChoice.YES, weight: 3 },
        { choice: VoteChoice.NO, weight: 2 },
        { choice: VoteChoice.ABSTAIN, weight: 5 },
      ],
      quorumPct: 100, // needs castWeight >= 10 — only met because abstain counts
      passingPct: 50, // yes/(yes+no) = 3/5 = 0.6
    });
    expect(result.castWeight).toBe(10);
    expect(result.quorumMet).toBe(true);
    expect(result.abstainWeight).toBe(5);
    expect(result.passed).toBe(true);
  });

  it('a tie (yes == no) passes at exactly passingPct = 50 (inclusive comparison)', () => {
    const result = computeTally({
      totalEligibleWeight: 10,
      votes: [
        { choice: VoteChoice.YES, weight: 5 },
        { choice: VoteChoice.NO, weight: 5 },
      ],
      quorumPct: 50,
      passingPct: 50,
    });
    expect(result.quorumMet).toBe(true);
    expect(result.passed).toBe(true); // 5/10 = 0.5 >= 0.5
  });

  it('a tie fails once passingPct is pushed above 50', () => {
    const result = computeTally({
      totalEligibleWeight: 10,
      votes: [
        { choice: VoteChoice.YES, weight: 5 },
        { choice: VoteChoice.NO, weight: 5 },
      ],
      quorumPct: 50,
      passingPct: 50.01,
    });
    expect(result.passed).toBe(false); // 0.5 < 0.5001
  });

  it('nobody voting YES or NO (all abstain, or no votes) never passes even with quorum met', () => {
    const allAbstain = computeTally({
      totalEligibleWeight: 4,
      votes: [
        { choice: VoteChoice.ABSTAIN, weight: 2 },
        { choice: VoteChoice.ABSTAIN, weight: 2 },
      ],
      quorumPct: 50,
      passingPct: 1,
    });
    expect(allAbstain.quorumMet).toBe(true);
    expect(allAbstain.passed).toBe(false);

    const noVotes = computeTally({
      totalEligibleWeight: 4,
      votes: [],
      quorumPct: 0,
      passingPct: 1,
    });
    expect(noVotes.quorumMet).toBe(true); // 0/4 >= 0
    expect(noVotes.passed).toBe(false); // decisiveWeight is 0
  });

  it('totalEligibleWeight of 0 never meets quorum, even with 0% required', () => {
    const result = computeTally({
      totalEligibleWeight: 0,
      votes: [],
      quorumPct: 0,
      passingPct: 0,
    });
    expect(result.quorumMet).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('supports ownership-weighted (fractional) weights', () => {
    const result = computeTally({
      totalEligibleWeight: 2.5, // e.g. one owner at 1.0 share, one at 1.5
      votes: [
        { choice: VoteChoice.YES, weight: 1.5 },
        { choice: VoteChoice.NO, weight: 1.0 },
      ],
      quorumPct: 60,
      passingPct: 50,
    });
    expect(result.castWeight).toBe(2.5);
    expect(result.quorumMet).toBe(true);
    expect(result.yesWeight).toBe(1.5);
    expect(result.passed).toBe(true); // 1.5/2.5 = 0.6 >= 0.5
  });
});

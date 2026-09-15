import { VoteChoice } from '../../generated/prisma/enums.js';

/**
 * Pure tally math, independent of Prisma/Nest — unit-tested directly (see
 * poll-tally.util.spec.ts). Weights are plain numbers: the service layer
 * converts Decimal columns (quorumPct, passingPct, Vote.weight,
 * Flat.ownershipShare) to numbers before calling in, mirroring how
 * VendorsService treats its Decimal columns as plain numbers at this scale.
 */

export interface TallyVote {
  choice: VoteChoice;
  weight: number;
}

export interface TallyInput {
  /** Sum of weights of every voter eligible for this poll, whether or not they voted. */
  totalEligibleWeight: number;
  votes: TallyVote[];
  /** 0-100. Share of totalEligibleWeight that must be cast for quorum. */
  quorumPct: number;
  /** 0-100. Share of (yes + no) weight that must be YES to pass. */
  passingPct: number;
}

export interface TallyResult {
  totalEligibleWeight: number;
  castWeight: number;
  yesWeight: number;
  noWeight: number;
  abstainWeight: number;
  quorumMet: boolean;
  /** True only when quorum is met AND the yes-share of (yes+no) clears passingPct. */
  passed: boolean;
}

function sumWeight(votes: TallyVote[], choice: VoteChoice): number {
  return votes.filter((v) => v.choice === choice).reduce((total, v) => total + v.weight, 0);
}

/**
 * `passed` requires BOTH quorum and a majority:
 *  - quorumMet = castWeight / totalEligibleWeight >= quorumPct/100 (ABSTAIN
 *    counts toward castWeight, i.e. toward quorum).
 *  - passed = quorumMet AND yesWeight / (yesWeight + noWeight) >= passingPct/100
 *    (ABSTAIN does NOT count toward the yes/no ratio). If yesWeight +
 *    noWeight is 0 (everyone abstained, or nobody who voted took a side),
 *    the poll is not passed regardless of quorum.
 * totalEligibleWeight <= 0 is treated as "quorum can never be met" rather
 * than throwing — a poll in a society with zero eligible voters simply
 * never clears quorum.
 */
export function computeTally(input: TallyInput): TallyResult {
  const yesWeight = sumWeight(input.votes, VoteChoice.YES);
  const noWeight = sumWeight(input.votes, VoteChoice.NO);
  const abstainWeight = sumWeight(input.votes, VoteChoice.ABSTAIN);
  const castWeight = yesWeight + noWeight + abstainWeight;

  const quorumMet = input.totalEligibleWeight > 0 && castWeight / input.totalEligibleWeight >= input.quorumPct / 100;

  const decisiveWeight = yesWeight + noWeight;
  const passed = quorumMet && decisiveWeight > 0 && yesWeight / decisiveWeight >= input.passingPct / 100;

  return {
    totalEligibleWeight: input.totalEligibleWeight,
    castWeight,
    yesWeight,
    noWeight,
    abstainWeight,
    quorumMet,
    passed,
  };
}

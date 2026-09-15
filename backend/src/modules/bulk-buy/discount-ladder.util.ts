/**
 * Pure discount-ladder math, independent of Prisma/Nest — unit-tested
 * directly (see discount-ladder.util.spec.ts). BulkBuyService treats
 * Offer.discountLadder (a Json column) as an array of these once validated,
 * mirroring how poll-tally.util.ts and ledger-posting.util.ts keep their
 * pure math out of the service layer.
 */

export interface LadderRung {
  minN: number;
  pct: number;
}

/**
 * Returns a human-readable validation error, or null if the ladder is
 * well-formed: non-empty, minN a positive integer and strictly increasing
 * rung-to-rung (which also rules out duplicate minN values), and pct a
 * 0-100 number that never decreases rung-to-rung.
 */
export function validateLadder(ladder: unknown): string | null {
  if (!Array.isArray(ladder) || ladder.length === 0) {
    return 'discountLadder must be a non-empty array';
  }

  for (const rung of ladder as LadderRung[]) {
    if (typeof rung !== 'object' || rung === null) {
      return 'each discountLadder rung must be an object of {minN, pct}';
    }
    if (!Number.isInteger(rung.minN) || rung.minN < 1) {
      return 'each discountLadder rung.minN must be an integer >= 1';
    }
    if (typeof rung.pct !== 'number' || Number.isNaN(rung.pct) || rung.pct < 0 || rung.pct > 100) {
      return 'each discountLadder rung.pct must be a number between 0 and 100';
    }
  }

  const rungs = ladder as LadderRung[];
  for (let i = 1; i < rungs.length; i++) {
    if (rungs[i].minN <= rungs[i - 1].minN) {
      return 'discountLadder rung.minN must be strictly increasing (and unique)';
    }
    if (rungs[i].pct < rungs[i - 1].pct) {
      return 'discountLadder rung.pct must be non-decreasing';
    }
  }

  return null;
}

/**
 * The ladder rung's minN, for the offer's minCommitments — always the
 * lowest rung. Callers must validate the ladder first (validateLadder);
 * this assumes a non-empty, minN-ascending array.
 */
export function minCommitmentsOf(ladder: LadderRung[]): number {
  return ladder[0].minN;
}

/**
 * The discount pct for the ladder rung with the highest minN <=
 * commitmentCount, or null if commitmentCount is below every rung's minN
 * (shouldn't happen once an offer has fired, since minCommitments is
 * exactly the lowest rung's minN — but this stays a plain lookup, not an
 * assertion, so it's safe to call before that invariant holds too).
 * Assumes the ladder is minN-ascending (validateLadder enforces this).
 */
export function appliedTier(ladder: LadderRung[], commitmentCount: number): number | null {
  let best: number | null = null;
  for (const rung of ladder) {
    if (rung.minN <= commitmentCount) {
      best = rung.pct;
    } else {
      break;
    }
  }
  return best;
}

/**
 * The smallest minN strictly greater than commitmentCount — "commit N more
 * to reach the next tier" — or null once commitmentCount has cleared the
 * top rung. Used for the live tier readout on GET /offers and /offers/:id.
 */
export function nextTierThreshold(ladder: LadderRung[], commitmentCount: number): number | null {
  for (const rung of ladder) {
    if (rung.minN > commitmentCount) {
      return rung.minN;
    }
  }
  return null;
}

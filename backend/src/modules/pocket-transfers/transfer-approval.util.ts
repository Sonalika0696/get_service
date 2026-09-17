import { requiredApprovers, type ApprovalConfig } from '../bulk-buy/approval-ladder.util.js';

/**
 * Phase 9.6 Decision #4: a pocket transfer is NEVER single-officer, even
 * when the society's own approval-ladder config (or a tiny committee
 * roster) would otherwise resolve rung 1 to a single approver for this
 * amount. This wraps bulk-buy's `requiredApprovers` (read-only reuse — see
 * PocketTransfersService's doc comment for why the util itself is never
 * modified) with a hard floor of 2 distinct officers.
 *
 * `requiredApprovers` itself already floors rung 3 (committee majority) at
 * 2 — this floor additionally covers rung 1 (amount <= lowerThreshold),
 * which `requiredApprovers` alone resolves to 1.
 */
export function requiredTransferApprovers(amount: number, config: ApprovalConfig, committeeRosterSize: number): number {
  return Math.max(2, requiredApprovers(amount, config, committeeRosterSize));
}

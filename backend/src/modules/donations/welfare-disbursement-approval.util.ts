import { requiredApprovers, type ApprovalConfig } from '../bulk-buy/approval-ladder.util.js';

/**
 * A welfare disbursement is NEVER single-officer, mirroring Phase 9.6's
 * PocketTransfer decision exactly (see pocket-transfers/transfer-approval
 * .util.ts's identical doc comment for the full rationale) — read-only reuse
 * of bulk-buy's `requiredApprovers`, floored at 2 distinct officers.
 * "The requester's request counts as their signature" (this lane's brief)
 * means WelfareDisbursementsService auto-records the requester's own
 * authorisation at request time — so a lone requester is 1 signature short
 * of even the floor for the smallest possible amount.
 */
export function requiredDisbursementApprovers(amount: number, config: ApprovalConfig, committeeRosterSize: number): number {
  return Math.max(2, requiredApprovers(amount, config, committeeRosterSize));
}

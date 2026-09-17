/**
 * Phase 11/12 read lane (b1read) — committee approvals inbox, `GET
 * /me/approvals`. See ApprovalsService's doc comment for the full design.
 */
export type ApprovalItemKind =
  | 'POCKET_TRANSFER'
  | 'PAYOUT'
  | 'MILESTONE'
  | 'FIXED_DEPOSIT_PLACEMENT'
  | 'FIXED_DEPOSIT_WITHDRAWAL'
  | 'EVENT_SETTLEMENT'
  | 'WELFARE_DISBURSEMENT'
  | 'RATIFICATION'
  | 'DISPUTE';

export interface ApprovalItem {
  kind: ApprovalItemKind;
  id: string;
  title: string;
  subtitle?: string;
  /** Rupees, as a string (Decimal serialisation convention) — null for a non-money item (ratification, dispute triage). */
  amount: string | null;
  /** Distinct officers required to act, when this item follows a ladder — null for RATIFICATION/DISPUTE, which aren't N-of-M authorisations. */
  requiredApprovers: number | null;
  /** Distinct officers who have already authorised, when applicable. */
  authorisedCount: number | null;
  /** True if the CALLER themselves already authorised this item — such items are excluded from the inbox, but the field is kept on the type for clarity/tests. */
  alreadyAuthorisedByMe: boolean;
  createdAt: Date;
  /** The REST path the client would call to act on this item next. */
  actionHint: string;
}

export interface ApprovalsInboxResponse {
  items: ApprovalItem[];
  counts: {
    total: number;
    byKind: Record<ApprovalItemKind, number>;
  };
}

/**
 * Pure masking rule for a campaign's contributor list. Anonymity applies
 * toward OTHER residents ONLY — the audit chain (AuditLog) always records
 * the real contributor regardless of this flag; this util only shapes what
 * an API RESPONSE shows a given viewer.
 */
export interface ContributionForMasking {
  id: string;
  amount: string | number;
  anonymous: boolean;
  createdAt: Date;
  flatUnitNo: string;
  residentId: string;
}

export interface MaskedContributor {
  id: string;
  amount: string | number;
  anonymous: boolean;
  createdAt: Date;
  /** null when masked (anonymous contribution, non-officer viewer). */
  flatUnitNo: string | null;
  /** null when masked (anonymous contribution, non-officer viewer). */
  residentId: string | null;
  /** The flat's unit number, or the literal "Anonymous" when masked. */
  displayName: string;
}

/**
 * An officer (TREASURER/DEPUTY_TREASURER/COMMITTEE) always sees the real
 * contributor. A plain RESIDENT sees it too UNLESS the contribution was
 * marked anonymous, in which case they see "Anonymous" with no flat/resident
 * identifier at all.
 */
export function maskContributor(contribution: ContributionForMasking, viewerIsOfficer: boolean): MaskedContributor {
  const reveal = viewerIsOfficer || !contribution.anonymous;
  return {
    id: contribution.id,
    amount: contribution.amount,
    anonymous: contribution.anonymous,
    createdAt: contribution.createdAt,
    flatUnitNo: reveal ? contribution.flatUnitNo : null,
    residentId: reveal ? contribution.residentId : null,
    displayName: reveal ? contribution.flatUnitNo : 'Anonymous',
  };
}

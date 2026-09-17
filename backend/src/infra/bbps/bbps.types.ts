export type BbpsUtility = 'ELECTRICITY' | 'WATER';

/**
 * A licensee (electricity/water board) bill as presented to a resident of an
 * individually-metered (Configuration A) society. The platform never
 * computes this bill itself — Configuration B (sub-metered) societies do
 * that internally via their own apportionment logic (see other Phase 10
 * lanes). Here we only fetch and present what the licensee already billed
 * against the flat's own `consumerNumber`.
 */
export interface PresentedBill {
  consumerNumber: string;
  utility: BbpsUtility;
  billNumber: string;
  /** Paise (smallest INR unit) — same convention as RazorpayOrder.amount. */
  amountPaise: number;
  /** ISO 8601 date (yyyy-mm-dd) the bill is due. */
  dueDate: string;
  /** ISO 8601 date (yyyy-mm-dd) the bill was raised. */
  billDate: string;
  billerName: string;
}

export interface BbpsFetchInput {
  consumerNumber: string;
  utility: BbpsUtility;
}

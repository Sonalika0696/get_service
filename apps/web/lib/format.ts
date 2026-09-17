/** Locale-aware formatters. Amounts are stored as integer minor units (paise). */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function formatMinor(minor: number): string {
  return inr.format(minor / 100);
}

/** Major-unit (rupee) amounts, e.g. Offer.unitPrice which is already in rupees. */
export function formatRupees(value: string | number): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return inr.format(Number.isFinite(n) ? n : 0);
}

/** Relative deadline label, e.g. "in 3 days", "closes today", "closed". */
export function relativeDeadline(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (ms < 0) return 'closed';
  if (days === 0) return 'closes today';
  if (days === 1) return 'in 1 day';
  return `in ${days} days`;
}

const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCompact(n: number): string {
  return compact.format(n);
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Friendly names for the ledger account kinds, so funds read in plain English. */
const ACCOUNT_LABELS: Record<string, string> = {
  SOCIETY_MASTER: 'Operating fund',
  BULK_BUY: 'Group-buy escrow',
  VENDOR: 'Vendor payable',
  RETENTION: 'Retention held',
  DISPUTE: 'Dispute hold',
  EXTERNAL: 'Bank / external',
  // Phase 9.1 sub-ledger pockets — a bank-statement credit or a cross-pocket
  // transfer targets one of these seven; see lib/pocket.ts POCKET_KINDS.
  MAINTENANCE: 'Maintenance fund',
  ELECTRICITY: 'Electricity fund',
  WATER: 'Water fund',
  EVENTS: 'Events fund',
  WELFARE: 'Welfare fund',
  SINKING: 'Sinking fund',
  CORPUS: 'Corpus fund',
};

/** Human label for a ledger account kind. */
export function humanizeAccountKind(kind: string): string {
  return (
    ACCOUNT_LABELS[kind] ??
    kind
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}

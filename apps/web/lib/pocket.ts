import { humanizeAccountKind } from './format';
import type { BankStatementLineStatus, PocketKind, PocketTransferStatus } from './types';

/** The seven Phase 9.1 sub-ledger pockets a treasurer can allocate into or transfer between. */
export const POCKET_KINDS: PocketKind[] = ['MAINTENANCE', 'ELECTRICITY', 'WATER', 'EVENTS', 'WELFARE', 'SINKING', 'CORPUS'];

export const POCKET_OPTIONS = POCKET_KINDS.map((value) => ({ value, label: humanizeAccountKind(value) }));

export const BANK_LINE_STATUS_META: Record<BankStatementLineStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  UNMATCHED: { label: 'Unmatched', tone: 'warning' },
  MATCHED: { label: 'Matched to a flat', tone: 'info' },
  ALLOCATED: { label: 'Allocated', tone: 'success' },
  IGNORED: { label: 'Ignored', tone: 'neutral' },
};

export const TRANSFER_STATUS_META: Record<PocketTransferStatus, { label: string; tone: 'neutral' | 'success' | 'warning' }> = {
  PENDING: { label: 'Awaiting authorisation', tone: 'warning' },
  EXECUTED: { label: 'Executed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

import type { ApprovalConfig } from './types';

/**
 * Client mirror of the backend approval-ladder math
 * (backend/src/modules/bulk-buy/approval-ladder.util.ts). Kept in step so
 * the ladder simulator shows exactly what an authorisation call will
 * require. If the backend rule changes, change it here too.
 */

export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  lowerThreshold: 5_000,
  upperThreshold: 50_000,
  majorityFraction: 0.5,
};

export type Rung = 1 | 2 | 3;

/** Distinct officers required to authorise a disbursement of `amount`. */
export function requiredApprovers(amount: number, config: ApprovalConfig, rosterSize: number): number {
  if (amount <= config.lowerThreshold) return 1;
  if (amount <= config.upperThreshold) return 2;
  return Math.max(2, Math.ceil(config.majorityFraction * rosterSize));
}

export function rungForAmount(amount: number, config: ApprovalConfig): Rung {
  if (amount <= config.lowerThreshold) return 1;
  if (amount <= config.upperThreshold) return 2;
  return 3;
}

export function validateApprovalConfig(c: ApprovalConfig): string | null {
  if (!(c.lowerThreshold > 0)) return 'Lower threshold must be a positive amount.';
  if (!(c.upperThreshold > 0)) return 'Upper threshold must be a positive amount.';
  if (c.lowerThreshold >= c.upperThreshold) return 'Lower threshold must be less than the upper threshold.';
  if (!(c.majorityFraction > 0) || c.majorityFraction > 1) return 'Majority fraction must be between 0 and 1.';
  return null;
}

export interface RungMeta {
  rung: Rung;
  title: string;
  approvers: string;
  detail: string;
}

export function ladderRungs(config: ApprovalConfig, rosterSize: number): RungMeta[] {
  const majority = Math.max(2, Math.ceil(config.majorityFraction * rosterSize));
  return [
    {
      rung: 1,
      title: 'Small payments',
      approvers: '1 admin',
      detail: 'A single admin can approve.',
    },
    {
      rung: 2,
      title: 'Medium payments',
      approvers: '2 admins',
      detail: 'Two different admins must approve. The same person cannot approve twice.',
    },
    {
      rung: 3,
      title: 'Large payments',
      approvers: `${majority} admins`,
      detail: `A majority (${Math.round(config.majorityFraction * 100)}%) of the ${rosterSize} admins must approve.`,
    },
  ];
}

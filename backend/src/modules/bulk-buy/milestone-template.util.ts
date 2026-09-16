/**
 * Pure milestone-template math, independent of Prisma/Nest — unit-tested
 * directly (see milestone-template.util.spec.ts). Mirrors
 * discount-ladder.util.ts's role for the discount ladder: BulkBuyService
 * treats Offer.milestoneTemplate (a Json column, LARGE offers only) as an
 * array of these once validated.
 */

export interface MilestoneTemplateRung {
  name: string;
  pct: number;
}

/**
 * Returns a human-readable validation error, or null if the template is
 * well-formed: non-empty, every entry a non-empty `name` and a `pct`
 * strictly greater than 0, and the pcts sum to EXACTLY 100 (a small
 * floating-point tolerance is applied — rounded to 2dp before comparing —
 * so e.g. three 33.34/33.33/33.33 rungs aren't rejected over a
 * floating-point artifact).
 */
export function validateMilestoneTemplate(template: unknown): string | null {
  if (!Array.isArray(template) || template.length === 0) {
    return 'milestoneTemplate must be a non-empty array';
  }

  let sum = 0;
  for (const rung of template as MilestoneTemplateRung[]) {
    if (typeof rung !== 'object' || rung === null) {
      return 'each milestoneTemplate entry must be an object of {name, pct}';
    }
    if (typeof rung.name !== 'string' || rung.name.trim().length === 0) {
      return 'each milestoneTemplate entry.name must be a non-empty string';
    }
    if (typeof rung.pct !== 'number' || Number.isNaN(rung.pct) || rung.pct <= 0) {
      return 'each milestoneTemplate entry.pct must be a number > 0';
    }
    sum += rung.pct;
  }

  // Round to 2dp before comparing to 100 to absorb ordinary floating-point
  // drift (e.g. 0.1 + 0.2 !== 0.3) without accepting a genuinely wrong sum.
  const roundedSum = Math.round(sum * 100) / 100;
  if (roundedSum !== 100) {
    return `milestoneTemplate pct values must sum to exactly 100 (got ${roundedSum})`;
  }

  return null;
}

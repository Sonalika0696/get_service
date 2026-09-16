import { describe, expect, it } from 'vitest';
import { validateMilestoneTemplate } from './milestone-template.util.js';

const TEMPLATE = [
  { name: 'Advance', pct: 40 },
  { name: 'Completion', pct: 60 },
];

describe('validateMilestoneTemplate', () => {
  it('accepts a well-formed template whose pcts sum to 100', () => {
    expect(validateMilestoneTemplate(TEMPLATE)).toBeNull();
  });

  it('accepts a single-entry template of pct 100', () => {
    expect(validateMilestoneTemplate([{ name: 'Full payment', pct: 100 }])).toBeNull();
  });

  it('accepts a template whose pcts sum to 100 only after floating-point rounding', () => {
    expect(validateMilestoneTemplate([{ name: 'A', pct: 33.34 }, { name: 'B', pct: 33.33 }, { name: 'C', pct: 33.33 }])).toBeNull();
  });

  it('rejects an empty array', () => {
    expect(validateMilestoneTemplate([])).toMatch(/non-empty/);
  });

  it('rejects a non-array', () => {
    expect(validateMilestoneTemplate({ name: 'A', pct: 100 })).toMatch(/non-empty/);
    expect(validateMilestoneTemplate(null)).toMatch(/non-empty/);
    expect(validateMilestoneTemplate(undefined)).toMatch(/non-empty/);
  });

  it('rejects a sum below 100', () => {
    expect(validateMilestoneTemplate([{ name: 'Advance', pct: 40 }])).toMatch(/sum to exactly 100/);
  });

  it('rejects a sum above 100', () => {
    expect(validateMilestoneTemplate([{ name: 'Advance', pct: 40 }, { name: 'Completion', pct: 65 }])).toMatch(/sum to exactly 100/);
  });

  it('rejects a zero or negative pct', () => {
    expect(validateMilestoneTemplate([{ name: 'Advance', pct: 0 }, { name: 'Completion', pct: 100 }])).toMatch(/pct/);
    expect(validateMilestoneTemplate([{ name: 'Advance', pct: -10 }, { name: 'Completion', pct: 110 }])).toMatch(/pct/);
  });

  it('rejects a non-number pct', () => {
    expect(validateMilestoneTemplate([{ name: 'Advance', pct: Number.NaN }])).toMatch(/pct/);
  });

  it('rejects a missing or empty name', () => {
    expect(validateMilestoneTemplate([{ name: '', pct: 100 }])).toMatch(/name/);
    expect(validateMilestoneTemplate([{ name: '   ', pct: 100 }])).toMatch(/name/);
    expect(validateMilestoneTemplate([{ pct: 100 }])).toMatch(/name/);
  });

  it('rejects a malformed entry shape', () => {
    expect(validateMilestoneTemplate([null])).toMatch(/object/);
    expect(validateMilestoneTemplate(['not-an-object'])).toMatch(/object/);
  });
});

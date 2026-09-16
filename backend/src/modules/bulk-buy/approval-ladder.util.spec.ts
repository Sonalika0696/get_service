import { describe, expect, it } from 'vitest';
import { DEFAULT_APPROVAL_CONFIG, parseApprovalConfig, requiredApprovers, validateApprovalConfig, type ApprovalConfig } from './approval-ladder.util.js';

const CONFIG: ApprovalConfig = { lowerThreshold: 1000, upperThreshold: 10000, majorityFraction: 0.5 };

describe('validateApprovalConfig', () => {
  it('accepts a well-formed config', () => {
    expect(validateApprovalConfig(CONFIG)).toBeNull();
  });

  it('rejects a non-positive lowerThreshold', () => {
    expect(validateApprovalConfig({ ...CONFIG, lowerThreshold: 0 })).toMatch(/lowerThreshold/);
    expect(validateApprovalConfig({ ...CONFIG, lowerThreshold: -1 })).toMatch(/lowerThreshold/);
  });

  it('rejects a non-positive upperThreshold', () => {
    expect(validateApprovalConfig({ ...CONFIG, upperThreshold: 0 })).toMatch(/upperThreshold/);
  });

  it('rejects lowerThreshold >= upperThreshold', () => {
    expect(validateApprovalConfig({ ...CONFIG, lowerThreshold: 10000, upperThreshold: 10000 })).toMatch(/lowerThreshold must be less than/);
    expect(validateApprovalConfig({ ...CONFIG, lowerThreshold: 20000, upperThreshold: 10000 })).toMatch(/lowerThreshold must be less than/);
  });

  it('rejects majorityFraction outside (0, 1]', () => {
    expect(validateApprovalConfig({ ...CONFIG, majorityFraction: 0 })).toMatch(/majorityFraction/);
    expect(validateApprovalConfig({ ...CONFIG, majorityFraction: -0.1 })).toMatch(/majorityFraction/);
    expect(validateApprovalConfig({ ...CONFIG, majorityFraction: 1.1 })).toMatch(/majorityFraction/);
  });

  it('accepts majorityFraction exactly 1', () => {
    expect(validateApprovalConfig({ ...CONFIG, majorityFraction: 1 })).toBeNull();
  });
});

describe('parseApprovalConfig', () => {
  it('falls back to the documented default when config is missing/empty', () => {
    expect(parseApprovalConfig(undefined)).toEqual(DEFAULT_APPROVAL_CONFIG);
    expect(parseApprovalConfig(null)).toEqual(DEFAULT_APPROVAL_CONFIG);
    expect(parseApprovalConfig({})).toEqual(DEFAULT_APPROVAL_CONFIG);
  });

  it('falls back to the default when approval is present but malformed', () => {
    expect(parseApprovalConfig({ approval: null })).toEqual(DEFAULT_APPROVAL_CONFIG);
    expect(parseApprovalConfig({ approval: { lowerThreshold: 'nope', upperThreshold: 10000, majorityFraction: 0.5 } })).toEqual(DEFAULT_APPROVAL_CONFIG);
    expect(parseApprovalConfig({ approval: { lowerThreshold: 10000, upperThreshold: 1000, majorityFraction: 0.5 } })).toEqual(DEFAULT_APPROVAL_CONFIG); // lower >= upper
  });

  it('reads a well-formed approval config', () => {
    expect(parseApprovalConfig({ approval: CONFIG })).toEqual(CONFIG);
  });

  it('does not partially merge — an otherwise-valid config with one bad field falls back entirely, not field-by-field', () => {
    const result = parseApprovalConfig({ approval: { lowerThreshold: 1000, upperThreshold: 10000, majorityFraction: 5 } });
    expect(result).toEqual(DEFAULT_APPROVAL_CONFIG);
    expect(result.lowerThreshold).not.toBe(1000);
  });
});

describe('requiredApprovers', () => {
  it('rung 1: amount at or below lowerThreshold needs exactly 1 officer', () => {
    expect(requiredApprovers(0, CONFIG, 10)).toBe(1);
    expect(requiredApprovers(999, CONFIG, 10)).toBe(1);
    expect(requiredApprovers(1000, CONFIG, 10)).toBe(1); // boundary is inclusive on the lower side
  });

  it('rung 2: amount between lowerThreshold (exclusive) and upperThreshold (inclusive) needs 2 distinct officers', () => {
    expect(requiredApprovers(1001, CONFIG, 10)).toBe(2);
    expect(requiredApprovers(5000, CONFIG, 10)).toBe(2);
    expect(requiredApprovers(10000, CONFIG, 10)).toBe(2); // boundary is inclusive on the upper side
  });

  it('rung 3: amount above upperThreshold needs ceil(majorityFraction * roster), never fewer than 2', () => {
    expect(requiredApprovers(10001, CONFIG, 10)).toBe(5); // ceil(0.5 * 10)
    expect(requiredApprovers(10001, CONFIG, 7)).toBe(4); // ceil(0.5 * 7) = 4
    expect(requiredApprovers(10001, CONFIG, 1)).toBe(2); // ceil(0.5 * 1) = 1, floored to 2
    expect(requiredApprovers(10001, CONFIG, 0)).toBe(2); // no roster at all still floors to 2
  });

  it('rung 3 with a full majorityFraction of 1 requires the entire roster', () => {
    const fullMajority: ApprovalConfig = { ...CONFIG, majorityFraction: 1 };
    expect(requiredApprovers(10001, fullMajority, 6)).toBe(6);
  });
});

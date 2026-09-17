import { describe, expect, it } from 'vitest';
import { DEFAULT_TREASURY_CONFIG, mergeTreasuryConfig, parseTreasuryConfig, validateTreasuryConfig, type TreasuryConfig } from './treasury-config.util.js';

const VALID: TreasuryConfig = {
  operatingFloatFloor: 50_000,
  minTenorDays: 30,
  defaultTenorDays: 180,
  defaultRatePct: 7.1,
  defaultBankName: 'HDFC Bank',
};

describe('validateTreasuryConfig', () => {
  it('accepts a well-formed config', () => {
    expect(validateTreasuryConfig(VALID)).toBeNull();
  });

  it('rejects a negative operatingFloatFloor', () => {
    expect(validateTreasuryConfig({ ...VALID, operatingFloatFloor: -1 })).toMatch(/operatingFloatFloor/);
  });

  it('accepts operatingFloatFloor of exactly 0', () => {
    expect(validateTreasuryConfig({ ...VALID, operatingFloatFloor: 0 })).toBeNull();
  });

  it('rejects minTenorDays below 7', () => {
    expect(validateTreasuryConfig({ ...VALID, minTenorDays: 6 })).toMatch(/minTenorDays/);
  });

  it('accepts minTenorDays of exactly 7', () => {
    expect(validateTreasuryConfig({ ...VALID, minTenorDays: 7, defaultTenorDays: 7 })).toBeNull();
  });

  it('rejects a non-integer minTenorDays', () => {
    expect(validateTreasuryConfig({ ...VALID, minTenorDays: 30.5 })).toMatch(/minTenorDays/);
  });

  it('rejects defaultTenorDays below minTenorDays', () => {
    expect(validateTreasuryConfig({ ...VALID, minTenorDays: 60, defaultTenorDays: 30 })).toMatch(/defaultTenorDays/);
  });

  it('accepts defaultTenorDays exactly equal to minTenorDays', () => {
    expect(validateTreasuryConfig({ ...VALID, minTenorDays: 30, defaultTenorDays: 30 })).toBeNull();
  });

  it('rejects defaultRatePct outside [0, 20]', () => {
    expect(validateTreasuryConfig({ ...VALID, defaultRatePct: -0.1 })).toMatch(/defaultRatePct/);
    expect(validateTreasuryConfig({ ...VALID, defaultRatePct: 20.1 })).toMatch(/defaultRatePct/);
  });

  it('accepts the boundary rates 0 and 20', () => {
    expect(validateTreasuryConfig({ ...VALID, defaultRatePct: 0 })).toBeNull();
    expect(validateTreasuryConfig({ ...VALID, defaultRatePct: 20 })).toBeNull();
  });

  it('rejects an empty defaultBankName', () => {
    expect(validateTreasuryConfig({ ...VALID, defaultBankName: '   ' })).toMatch(/defaultBankName/);
  });
});

describe('parseTreasuryConfig', () => {
  it('returns the default, flagged, when config is null/undefined/not an object', () => {
    expect(parseTreasuryConfig(null)).toEqual({ config: DEFAULT_TREASURY_CONFIG, isDefault: true });
    expect(parseTreasuryConfig(undefined)).toEqual({ config: DEFAULT_TREASURY_CONFIG, isDefault: true });
    expect(parseTreasuryConfig('nope')).toEqual({ config: DEFAULT_TREASURY_CONFIG, isDefault: true });
  });

  it('returns the default, flagged, when the treasury key is absent', () => {
    expect(parseTreasuryConfig({ approval: { lowerThreshold: 1 } })).toEqual({ config: DEFAULT_TREASURY_CONFIG, isDefault: true });
  });

  it('returns the default, flagged, when the stored treasury config fails validation', () => {
    expect(parseTreasuryConfig({ treasury: { ...VALID, operatingFloatFloor: -5 } })).toEqual({ config: DEFAULT_TREASURY_CONFIG, isDefault: true });
  });

  it('returns the default, flagged, when a field has the wrong type', () => {
    expect(parseTreasuryConfig({ treasury: { ...VALID, defaultBankName: 123 } })).toEqual({ config: DEFAULT_TREASURY_CONFIG, isDefault: true });
  });

  it('returns the stored config, unflagged, when valid', () => {
    expect(parseTreasuryConfig({ treasury: VALID })).toEqual({ config: VALID, isDefault: false });
  });
});

describe('mergeTreasuryConfig', () => {
  it('adds the treasury key onto an empty/nullish existing config', () => {
    expect(mergeTreasuryConfig(null, VALID)).toEqual({ treasury: VALID });
    expect(mergeTreasuryConfig(undefined, VALID)).toEqual({ treasury: VALID });
  });

  it('preserves an unrelated existing key (e.g. approval) untouched', () => {
    const existing = { approval: { lowerThreshold: 5000, upperThreshold: 50000, majorityFraction: 0.5 } };
    expect(mergeTreasuryConfig(existing, VALID)).toEqual({ ...existing, treasury: VALID });
  });

  it('overwrites only its own prior treasury value', () => {
    const existing = { treasury: { ...VALID, defaultBankName: 'Old Bank' }, other: 'untouched' };
    expect(mergeTreasuryConfig(existing, VALID)).toEqual({ other: 'untouched', treasury: VALID });
  });
});

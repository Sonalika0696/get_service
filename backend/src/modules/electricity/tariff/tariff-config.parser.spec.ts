import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DUTY_CESS,
  DEFAULT_FIXED_CHARGES,
  parseTariffConfig,
  validateDutyCess,
  validateFixedCharges,
  validateSlabs,
} from './tariff-config.parser.js';

const SLABS = [
  { upTo: 100, rate: 3 },
  { upTo: 200, rate: 5 },
  { upTo: null, rate: 7 },
];

describe('validateSlabs', () => {
  it('accepts a well-formed ascending slab array with an open final slab', () => {
    expect(validateSlabs(SLABS)).toBeNull();
  });

  it('accepts a single slab with upTo: null', () => {
    expect(validateSlabs([{ upTo: null, rate: 4 }])).toBeNull();
  });

  it('rejects a non-array', () => {
    expect(validateSlabs(undefined)).toMatch(/non-empty array/);
    expect(validateSlabs({})).toMatch(/non-empty array/);
  });

  it('rejects an empty array', () => {
    expect(validateSlabs([])).toMatch(/non-empty array/);
  });

  it('rejects a non-object entry', () => {
    expect(validateSlabs([null])).toMatch(/slabs\[0\] must be an object/);
    expect(validateSlabs(['nope'])).toMatch(/slabs\[0\] must be an object/);
  });

  it('rejects a negative or non-numeric rate', () => {
    expect(validateSlabs([{ upTo: 100, rate: -1 }])).toMatch(/rate/);
    expect(validateSlabs([{ upTo: 100, rate: 'nope' }])).toMatch(/rate/);
  });

  it('accepts a rate of exactly 0', () => {
    expect(validateSlabs([{ upTo: null, rate: 0 }])).toBeNull();
  });

  it('rejects a non-positive or non-numeric upTo (other than null)', () => {
    expect(validateSlabs([{ upTo: 0, rate: 3 }])).toMatch(/upTo/);
    expect(validateSlabs([{ upTo: -5, rate: 3 }])).toMatch(/upTo/);
    expect(validateSlabs([{ upTo: 'nope', rate: 3 }])).toMatch(/upTo/);
  });

  it('rejects upTo: null anywhere but the last slab', () => {
    expect(
      validateSlabs([
        { upTo: null, rate: 3 },
        { upTo: 100, rate: 5 },
      ]),
    ).toMatch(/only be null on the last slab/);
  });

  it('rejects non-ascending upTo values', () => {
    expect(
      validateSlabs([
        { upTo: 100, rate: 3 },
        { upTo: 100, rate: 5 },
      ]),
    ).toMatch(/ascending/);
    expect(
      validateSlabs([
        { upTo: 200, rate: 3 },
        { upTo: 100, rate: 5 },
      ]),
    ).toMatch(/ascending/);
  });
});

describe('validateFixedCharges', () => {
  it('accepts an empty object (both fields optional)', () => {
    expect(validateFixedCharges({})).toBeNull();
  });

  it('accepts well-formed values', () => {
    expect(validateFixedCharges({ perConnection: 50, perSanctionedLoadKw: 20 })).toBeNull();
  });

  it('rejects a negative perConnection', () => {
    expect(validateFixedCharges({ perConnection: -1 })).toMatch(/perConnection/);
  });

  it('rejects a negative perSanctionedLoadKw', () => {
    expect(validateFixedCharges({ perSanctionedLoadKw: -1 })).toMatch(/perSanctionedLoadKw/);
  });
});

describe('validateDutyCess', () => {
  it('accepts an empty object (both fields optional)', () => {
    expect(validateDutyCess({})).toBeNull();
  });

  it('rejects a negative energyDutyPct', () => {
    expect(validateDutyCess({ energyDutyPct: -1 })).toMatch(/energyDutyPct/);
  });

  it('rejects a negative fixedCess', () => {
    expect(validateDutyCess({ fixedCess: -1 })).toMatch(/fixedCess/);
  });
});

describe('parseTariffConfig', () => {
  it('parses a fully well-formed config', () => {
    const result = parseTariffConfig({
      slabs: SLABS,
      fixedCharges: { perConnection: 50, perSanctionedLoadKw: 20 },
      dutyCess: { energyDutyPct: 5, fixedCess: 10 },
    });
    expect(result).toEqual({
      slabs: SLABS,
      fixedCharges: { perConnection: 50, perSanctionedLoadKw: 20 },
      dutyCess: { energyDutyPct: 5, fixedCess: 10 },
    });
  });

  it('throws when raw is not an object', () => {
    expect(() => parseTariffConfig(undefined)).toThrow();
    expect(() => parseTariffConfig(null)).toThrow();
    expect(() => parseTariffConfig('nope')).toThrow();
  });

  it('throws when slabs is missing or malformed — never silently defaults the rate table', () => {
    expect(() => parseTariffConfig({})).toThrow(/slabs/);
    expect(() => parseTariffConfig({ slabs: [] })).toThrow(/slabs/);
    expect(() => parseTariffConfig({ slabs: [{ upTo: 100, rate: -1 }] })).toThrow(/rate/);
  });

  it('defaults fixedCharges to all-zero when absent', () => {
    const result = parseTariffConfig({ slabs: SLABS });
    expect(result.fixedCharges).toEqual(DEFAULT_FIXED_CHARGES);
  });

  it('defaults fixedCharges to all-zero when present but malformed (full fallback, not partial merge)', () => {
    const result = parseTariffConfig({ slabs: SLABS, fixedCharges: { perConnection: -5, perSanctionedLoadKw: 20 } });
    expect(result.fixedCharges).toEqual(DEFAULT_FIXED_CHARGES);
    expect(result.fixedCharges.perSanctionedLoadKw).not.toBe(20);
  });

  it('defaults dutyCess to all-zero when absent', () => {
    const result = parseTariffConfig({ slabs: SLABS });
    expect(result.dutyCess).toEqual(DEFAULT_DUTY_CESS);
  });

  it('defaults dutyCess to all-zero when present but malformed (full fallback, not partial merge)', () => {
    const result = parseTariffConfig({ slabs: SLABS, dutyCess: { energyDutyPct: 5, fixedCess: -1 } });
    expect(result.dutyCess).toEqual(DEFAULT_DUTY_CESS);
    expect(result.dutyCess.energyDutyPct).not.toBe(5);
  });

  it('fills individually-omitted fixedCharges/dutyCess fields with 0 rather than leaving them undefined', () => {
    const result = parseTariffConfig({ slabs: SLABS, fixedCharges: { perConnection: 50 }, dutyCess: { fixedCess: 10 } });
    expect(result.fixedCharges).toEqual({ perConnection: 50, perSanctionedLoadKw: 0 });
    expect(result.dutyCess).toEqual({ energyDutyPct: 0, fixedCess: 10 });
  });
});

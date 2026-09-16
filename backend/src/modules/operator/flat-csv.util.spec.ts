import { describe, expect, it } from 'vitest';
import { parseFlatCsv } from './flat-csv.util.js';

describe('parseFlatCsv', () => {
  it('parses well-formed rows', () => {
    const { rows, errors } = parseFlatCsv('unitNo,maintenanceAmount\nA-101,1500.50\nA-102,1600\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { unitNo: 'A-101', maintenanceAmount: 1500.5 },
      { unitNo: 'A-102', maintenanceAmount: 1600 },
    ]);
  });

  it('accepts a case-insensitive header and tolerates blank/whitespace lines', () => {
    const { rows, errors } = parseFlatCsv('  UnitNo , MaintenanceAmount \n\nB-1, 900\n   \n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ unitNo: 'B-1', maintenanceAmount: 900 }]);
  });

  it('rejects an empty file', () => {
    const { rows, errors } = parseFlatCsv('');
    expect(rows).toEqual([]);
    expect(errors).toEqual(['CSV is empty']);
  });

  it('rejects a wrong header', () => {
    const { errors } = parseFlatCsv('flatNo,amount\nA-1,100\n');
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/header must be exactly/);
  });

  it('rejects a header with no data rows', () => {
    const { errors } = parseFlatCsv('unitNo,maintenanceAmount\n');
    expect(errors).toEqual(['CSV has a header but no data rows']);
  });

  it('rejects a duplicate unitNo within the same file, and does not silently drop it', () => {
    const { rows, errors } = parseFlatCsv('unitNo,maintenanceAmount\nC-1,1000\nC-1,2000\n');
    expect(rows).toEqual([{ unitNo: 'C-1', maintenanceAmount: 1000 }]);
    expect(errors).toEqual(['Line 3: duplicate unitNo "C-1" within this file']);
  });

  it('rejects a row with the wrong number of columns', () => {
    const { errors } = parseFlatCsv('unitNo,maintenanceAmount\nD-1,1000,extra\n');
    expect(errors).toEqual(['Line 2: expected 2 columns (unitNo,maintenanceAmount), got 3']);
  });

  it('rejects an empty unitNo', () => {
    const { errors } = parseFlatCsv('unitNo,maintenanceAmount\n,1000\n');
    expect(errors).toEqual(['Line 2: unitNo is empty']);
  });

  it('rejects a non-numeric amount', () => {
    const { errors } = parseFlatCsv('unitNo,maintenanceAmount\nE-1,not-a-number\n');
    expect(errors[0]).toMatch(/must be a positive number/);
  });

  it('rejects a zero or negative amount', () => {
    const { errors: zeroErrors } = parseFlatCsv('unitNo,maintenanceAmount\nF-1,0\n');
    expect(zeroErrors[0]).toMatch(/must be a positive number/);
    const { errors: negErrors } = parseFlatCsv('unitNo,maintenanceAmount\nF-1,-5\n');
    expect(negErrors[0]).toMatch(/must be a positive number/);
  });

  it('rejects more than 2 decimal places', () => {
    const { errors } = parseFlatCsv('unitNo,maintenanceAmount\nG-1,100.999\n');
    expect(errors[0]).toMatch(/at most 2 decimal places/);
  });

  it('accumulates every row error, not just the first', () => {
    const { errors } = parseFlatCsv('unitNo,maintenanceAmount\n,1000\nH-1,bad\n');
    expect(errors).toHaveLength(2);
  });

  it('rejects a unitNo over 50 characters', () => {
    const { errors } = parseFlatCsv(`unitNo,maintenanceAmount\n${'X'.repeat(51)},1000\n`);
    expect(errors[0]).toMatch(/exceeds 50 characters/);
  });
});

import { describe, expect, it } from 'vitest';
import { parseBankStatementCsv } from './bank-statement-csv.util.js';

describe('parseBankStatementCsv', () => {
  it('parses well-formed rows, including one with no reference', () => {
    const { rows, errors } = parseBankStatementCsv('valueDate,amount,narration,reference\n2026-01-05,1500.50,NEFT VA-ABCD1234-A101,UTR123\n2026-01-06,900,cash deposit,\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { valueDate: '2026-01-05', amount: 1500.5, narration: 'NEFT VA-ABCD1234-A101', reference: 'UTR123' },
      { valueDate: '2026-01-06', amount: 900, narration: 'cash deposit', reference: undefined },
    ]);
  });

  it('accepts a case-insensitive header and tolerates blank/whitespace lines', () => {
    const { rows, errors } = parseBankStatementCsv('  ValueDate , Amount , Narration , Reference \n\n2026-02-01, 100, deposit, \n   \n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ valueDate: '2026-02-01', amount: 100, narration: 'deposit', reference: undefined }]);
  });

  it('rejects an empty file', () => {
    const { rows, errors } = parseBankStatementCsv('');
    expect(rows).toEqual([]);
    expect(errors).toEqual(['CSV is empty']);
  });

  it('rejects a wrong header', () => {
    const { errors } = parseBankStatementCsv('date,amt,desc,ref\n2026-01-01,100,x,y\n');
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/header must be exactly/);
  });

  it('rejects a header with no data rows', () => {
    const { errors } = parseBankStatementCsv('valueDate,amount,narration,reference\n');
    expect(errors).toEqual(['CSV has a header but no data rows']);
  });

  it('rejects a row with the wrong number of columns', () => {
    const { errors } = parseBankStatementCsv('valueDate,amount,narration,reference\n2026-01-01,100,x\n');
    expect(errors).toEqual(['Line 2: expected 4 columns (valueDate,amount,narration,reference), got 3']);
  });

  it('rejects an invalid calendar date (syntactically valid but Feb 30)', () => {
    const { errors } = parseBankStatementCsv('valueDate,amount,narration,reference\n2026-02-30,100,x,\n');
    expect(errors[0]).toMatch(/valid calendar date/);
  });

  it('rejects a malformed date', () => {
    const { errors } = parseBankStatementCsv('valueDate,amount,narration,reference\n01-01-2026,100,x,\n');
    expect(errors[0]).toMatch(/valid calendar date/);
  });

  it('rejects a non-numeric amount', () => {
    const { errors } = parseBankStatementCsv('valueDate,amount,narration,reference\n2026-01-01,not-a-number,x,\n');
    expect(errors[0]).toMatch(/positive number/);
  });

  it('rejects a zero or negative amount', () => {
    const { errors: zeroErrors } = parseBankStatementCsv('valueDate,amount,narration,reference\n2026-01-01,0,x,\n');
    expect(zeroErrors[0]).toMatch(/positive number/);
    const { errors: negErrors } = parseBankStatementCsv('valueDate,amount,narration,reference\n2026-01-01,-5,x,\n');
    expect(negErrors[0]).toMatch(/positive number/);
  });

  it('rejects more than 2 decimal places', () => {
    const { errors } = parseBankStatementCsv('valueDate,amount,narration,reference\n2026-01-01,100.999,x,\n');
    expect(errors[0]).toMatch(/at most 2 decimal places/);
  });

  it('rejects an empty narration', () => {
    const { errors } = parseBankStatementCsv('valueDate,amount,narration,reference\n2026-01-01,100,,\n');
    expect(errors).toEqual(['Line 2: narration is empty']);
  });

  it('rejects a narration over 500 characters', () => {
    const { errors } = parseBankStatementCsv(`valueDate,amount,narration,reference\n2026-01-01,100,${'X'.repeat(501)},\n`);
    expect(errors[0]).toMatch(/exceeds 500 characters/);
  });

  it('rejects a reference over 100 characters', () => {
    const { errors } = parseBankStatementCsv(`valueDate,amount,narration,reference\n2026-01-01,100,x,${'Y'.repeat(101)}\n`);
    expect(errors[0]).toMatch(/exceeds 100 characters/);
  });

  it('accumulates every row error, not just the first, and still returns the good rows', () => {
    const { rows, errors } = parseBankStatementCsv('valueDate,amount,narration,reference\n2026-01-01,100,ok,\nbad-date,100,x,\n2026-01-02,not-a-number,y,\n');
    expect(rows).toEqual([{ valueDate: '2026-01-01', amount: 100, narration: 'ok', reference: undefined }]);
    expect(errors).toHaveLength(2);
  });
});

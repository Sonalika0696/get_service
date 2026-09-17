import { describe, expect, it } from 'vitest';
import { parseReadingCsv } from './reading-csv.util.js';

describe('parseReadingCsv', () => {
  it('parses well-formed rows with a capturedAt column', () => {
    const { rows, errors } = parseReadingCsv(
      'serial,value,capturedAt\nMTR-001,1234.5,2026-01-05T10:00:00.000Z\nMTR-002,876,2026-01-05T10:05:00.000Z\n',
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { serial: 'MTR-001', value: 1234.5, capturedAt: '2026-01-05T10:00:00.000Z' },
      { serial: 'MTR-002', value: 876, capturedAt: '2026-01-05T10:05:00.000Z' },
    ]);
  });

  it('parses well-formed rows with a 2-column header and no capturedAt', () => {
    const { rows, errors } = parseReadingCsv('serial,value\nMTR-001,1234.5\nMTR-002,876\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { serial: 'MTR-001', value: 1234.5, capturedAt: undefined },
      { serial: 'MTR-002', value: 876, capturedAt: undefined },
    ]);
  });

  it('parses a 3-column-header file with a blank capturedAt cell for some rows', () => {
    const { rows, errors } = parseReadingCsv('serial,value,capturedAt\nMTR-001,1234.5,\nMTR-002,876,2026-01-05T10:05:00.000Z\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { serial: 'MTR-001', value: 1234.5, capturedAt: undefined },
      { serial: 'MTR-002', value: 876, capturedAt: '2026-01-05T10:05:00.000Z' },
    ]);
  });

  it('accepts a case-insensitive header and tolerates blank/whitespace lines', () => {
    const { rows, errors } = parseReadingCsv('  Serial , Value , CapturedAt \n\nMTR-001, 100, 2026-01-05\n   \n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ serial: 'MTR-001', value: 100, capturedAt: '2026-01-05' }]);
  });

  it('treats a file with no header as all data rows (no header line detected)', () => {
    const { rows, errors } = parseReadingCsv('MTR-001,100\nMTR-002,200\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { serial: 'MTR-001', value: 100, capturedAt: undefined },
      { serial: 'MTR-002', value: 200, capturedAt: undefined },
    ]);
  });

  it('rejects an empty file', () => {
    const { rows, errors } = parseReadingCsv('');
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 0, message: 'CSV is empty' }]);
  });

  it('rejects a header with no data rows', () => {
    const { errors } = parseReadingCsv('serial,value,capturedAt\n');
    expect(errors).toEqual([{ line: 1, message: 'CSV has a header but no data rows' }]);
  });

  it('rejects a row with the wrong number of columns', () => {
    const { errors } = parseReadingCsv('serial,value\nMTR-001,100,extra,stuff\n');
    expect(errors).toEqual([{ line: 2, message: 'expected 2 or 3 columns (serial,value[,capturedAt]), got 4' }]);
  });

  it('rejects an empty serial', () => {
    const { errors } = parseReadingCsv('serial,value\n,100\n');
    expect(errors).toEqual([{ line: 2, message: 'serial is empty' }]);
  });

  it('rejects a non-numeric value', () => {
    const { errors } = parseReadingCsv('serial,value\nMTR-001,not-a-number\n');
    expect(errors).toEqual([{ line: 2, message: 'value "not-a-number" must be a finite non-negative number' }]);
  });

  it('rejects a negative value', () => {
    const { errors } = parseReadingCsv('serial,value\nMTR-001,-5\n');
    expect(errors).toEqual([{ line: 2, message: 'value "-5" must be a finite non-negative number' }]);
  });

  it('rejects a blank value', () => {
    const { errors } = parseReadingCsv('serial,value\nMTR-001,\n');
    expect(errors).toEqual([{ line: 2, message: 'value "" must be a finite non-negative number' }]);
  });

  it('accepts a value of exactly 0', () => {
    const { rows, errors } = parseReadingCsv('serial,value\nMTR-001,0\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ serial: 'MTR-001', value: 0, capturedAt: undefined }]);
  });

  it('rejects a malformed capturedAt', () => {
    const { errors } = parseReadingCsv('serial,value,capturedAt\nMTR-001,100,not-a-date\n');
    expect(errors).toEqual([{ line: 2, message: 'capturedAt "not-a-date" must be a valid ISO-8601 timestamp' }]);
  });

  it('accumulates every row error, not just the first, and still returns the good rows', () => {
    const { rows, errors } = parseReadingCsv('serial,value\nMTR-001,100\n,200\nMTR-003,not-a-number\n');
    expect(rows).toEqual([{ serial: 'MTR-001', value: 100, capturedAt: undefined }]);
    expect(errors).toHaveLength(2);
    expect(errors[0].line).toBe(3);
    expect(errors[1].line).toBe(4);
  });
});

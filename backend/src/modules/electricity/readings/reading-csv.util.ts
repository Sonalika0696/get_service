/**
 * Pure CSV-parsing/validation for a bulk meter-reading import (Phase 10),
 * independent of Prisma/Nest — unit-tested directly (see
 * reading-csv.util.spec.ts). Mirrors bank-statement-csv.util.ts's shape: a
 * fixed-header, comma-separated body string, per-row error accumulation
 * rather than throw-on-first-bad-row, and never throws itself.
 *
 * Expected header: `serial,value[,capturedAt]` — capturedAt is an optional
 * third column; both a 2-column and a 3-column header are accepted so a
 * caller may omit per-row capture timestamps entirely.
 */

export interface ParsedReadingRow {
  /** The Meter.serial this row's reading belongs to. */
  serial: string;
  /** Raw dial value at capture. */
  value: number;
  /** Optional ISO-8601 capture timestamp; omitted rows default at the caller (e.g. to now()). */
  capturedAt?: string;
}

export interface ReadingCsvParseError {
  line: number;
  message: string;
}

export interface ReadingCsvParseResult {
  rows: ParsedReadingRow[];
  errors: ReadingCsvParseError[];
}

const EXPECTED_HEADER_NO_DATE = ['serial', 'value'];
const EXPECTED_HEADER_WITH_DATE = ['serial', 'value', 'capturedat'];

/** True for a syntactically well-formed ISO-8601 timestamp that Date can round-trip. */
function isValidIsoTimestamp(raw: string): boolean {
  if (!raw) return false;
  const d = new Date(raw);
  return !Number.isNaN(d.getTime());
}

/** True when the first line looks like the expected header rather than a data row. */
function isHeaderLine(line: string): boolean {
  const cols = line.split(',').map((c) => c.trim().toLowerCase());
  if (cols.length === EXPECTED_HEADER_NO_DATE.length) {
    return EXPECTED_HEADER_NO_DATE.every((h, i) => cols[i] === h);
  }
  if (cols.length === EXPECTED_HEADER_WITH_DATE.length) {
    return EXPECTED_HEADER_WITH_DATE.every((h, i) => cols[i] === h);
  }
  return false;
}

export function parseReadingCsv(csv: string): ReadingCsvParseResult {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, message: 'CSV is empty' }] };
  }

  const hasHeader = isHeaderLine(lines[0]);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const lineOffset = hasHeader ? 2 : 1; // 1-based line numbers, +1 more when a header row was consumed

  if (dataLines.length === 0) {
    return { rows: [], errors: [{ line: 1, message: 'CSV has a header but no data rows' }] };
  }

  const rows: ParsedReadingRow[] = [];
  const errors: ReadingCsvParseError[] = [];

  dataLines.forEach((line, idx) => {
    const lineNo = idx + lineOffset;
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length !== 2 && cols.length !== 3) {
      errors.push({ line: lineNo, message: `expected 2 or 3 columns (serial,value[,capturedAt]), got ${cols.length}` });
      return;
    }
    const [serial, valueRaw, capturedAtRaw] = cols;

    if (!serial) {
      errors.push({ line: lineNo, message: 'serial is empty' });
      return;
    }

    const value = Number(valueRaw);
    if (valueRaw === '' || !Number.isFinite(value) || value < 0) {
      errors.push({ line: lineNo, message: `value "${valueRaw}" must be a finite non-negative number` });
      return;
    }

    let capturedAt: string | undefined;
    if (capturedAtRaw !== undefined && capturedAtRaw !== '') {
      if (!isValidIsoTimestamp(capturedAtRaw)) {
        errors.push({ line: lineNo, message: `capturedAt "${capturedAtRaw}" must be a valid ISO-8601 timestamp` });
        return;
      }
      capturedAt = capturedAtRaw;
    }

    rows.push({ serial, value, capturedAt });
  });

  return { rows, errors };
}

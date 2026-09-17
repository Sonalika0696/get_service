/**
 * Pure CSV-parsing/validation for the bank-statement import (Phase 9.5),
 * independent of Prisma/Nest — unit-tested directly (see
 * bank-statement-csv.util.spec.ts). Mirrors operator/flat-csv.util.ts's
 * shape: a fixed-header, comma-separated body string (there is no
 * multipart upload in this repo), per-row error accumulation rather than
 * throw-on-first-bad-row, and never throws itself.
 *
 * UNLIKE flat-csv.util.ts (whose caller rejects the WHOLE file on any row
 * error), BankStatementsService.ingestCsv intentionally does NOT do that —
 * see its doc comment. This function still separates good rows from bad
 * ones the same way, so the caller can decide.
 */

export interface ParsedBankStatementRow {
  /** ISO calendar date, 'YYYY-MM-DD'. */
  valueDate: string;
  amount: number;
  narration: string;
  reference?: string;
}

export interface BankStatementCsvParseResult {
  rows: ParsedBankStatementRow[];
  errors: string[];
}

const EXPECTED_HEADER = ['valuedate', 'amount', 'narration', 'reference'];
const MAX_NARRATION_LENGTH = 500;
const MAX_REFERENCE_LENGTH = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

/** True for a syntactically well-formed AND calendar-valid 'YYYY-MM-DD' (rejects e.g. 2024-02-30). */
function isValidCalendarDate(raw: string): boolean {
  if (!DATE_RE.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

export function parseBankStatementCsv(csv: string): BankStatementCsvParseResult {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: ['CSV is empty'] };
  }

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  if (header.length !== EXPECTED_HEADER.length || !EXPECTED_HEADER.every((h, i) => header[i] === h)) {
    return { rows: [], errors: [`CSV header must be exactly "valueDate,amount,narration,reference" (case-insensitive) — got "${lines[0]}"`] };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length === 0) {
    return { rows: [], errors: ['CSV has a header but no data rows'] };
  }

  const rows: ParsedBankStatementRow[] = [];
  const errors: string[] = [];

  dataLines.forEach((line, idx) => {
    const lineNo = idx + 2; // 1-based, +1 to account for the header row
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length !== 4) {
      errors.push(`Line ${lineNo}: expected 4 columns (valueDate,amount,narration,reference), got ${cols.length}`);
      return;
    }
    const [valueDate, amountRaw, narration, referenceRaw] = cols;

    if (!isValidCalendarDate(valueDate)) {
      errors.push(`Line ${lineNo}: valueDate "${valueDate}" must be a valid calendar date in YYYY-MM-DD format`);
      return;
    }

    if (!AMOUNT_RE.test(amountRaw)) {
      errors.push(`Line ${lineNo}: amount "${amountRaw}" must be a positive number with at most 2 decimal places`);
      return;
    }
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`Line ${lineNo}: amount "${amountRaw}" must be a positive number`);
      return;
    }

    if (!narration) {
      errors.push(`Line ${lineNo}: narration is empty`);
      return;
    }
    if (narration.length > MAX_NARRATION_LENGTH) {
      errors.push(`Line ${lineNo}: narration exceeds ${MAX_NARRATION_LENGTH} characters`);
      return;
    }

    if (referenceRaw.length > MAX_REFERENCE_LENGTH) {
      errors.push(`Line ${lineNo}: reference exceeds ${MAX_REFERENCE_LENGTH} characters`);
      return;
    }

    rows.push({ valueDate, amount, narration, reference: referenceRaw ? referenceRaw : undefined });
  });

  return { rows, errors };
}

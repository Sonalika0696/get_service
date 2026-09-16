/**
 * Pure CSV-parsing/validation for the flat register import, independent of
 * Prisma/Nest — unit-tested directly (see flat-csv.util.spec.ts), mirroring
 * how discount-ladder.util.ts and verification-tier.util.ts keep their pure
 * validation logic out of the service layer. FlatsService.importCsv wraps
 * a non-empty `errors` return in a BadRequestException; this function never
 * throws.
 */

export interface ParsedFlatRow {
  unitNo: string;
  maintenanceAmount: number;
}

export interface FlatCsvParseResult {
  rows: ParsedFlatRow[];
  errors: string[];
}

const EXPECTED_HEADER = ['unitno', 'maintenanceamount'];
const MAX_UNIT_NO_LENGTH = 50;

export function parseFlatCsv(csv: string): FlatCsvParseResult {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: ['CSV is empty'] };
  }

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  if (header.length !== EXPECTED_HEADER.length || !EXPECTED_HEADER.every((h, i) => header[i] === h)) {
    return { rows: [], errors: [`CSV header must be exactly "unitNo,maintenanceAmount" (case-insensitive) — got "${lines[0]}"`] };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length === 0) {
    return { rows: [], errors: ['CSV has a header but no data rows'] };
  }

  const rows: ParsedFlatRow[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  dataLines.forEach((line, idx) => {
    const lineNo = idx + 2; // 1-based, +1 to account for the header row
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length !== 2) {
      errors.push(`Line ${lineNo}: expected 2 columns (unitNo,maintenanceAmount), got ${cols.length}`);
      return;
    }
    const [unitNo, amountRaw] = cols;
    if (!unitNo) {
      errors.push(`Line ${lineNo}: unitNo is empty`);
      return;
    }
    if (unitNo.length > MAX_UNIT_NO_LENGTH) {
      errors.push(`Line ${lineNo}: unitNo exceeds ${MAX_UNIT_NO_LENGTH} characters`);
      return;
    }
    if (seen.has(unitNo)) {
      errors.push(`Line ${lineNo}: duplicate unitNo "${unitNo}" within this file`);
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(amountRaw)) {
      errors.push(`Line ${lineNo}: maintenanceAmount "${amountRaw}" must be a positive number with at most 2 decimal places`);
      return;
    }
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`Line ${lineNo}: maintenanceAmount "${amountRaw}" must be a positive number`);
      return;
    }

    seen.add(unitNo);
    rows.push({ unitNo, maintenanceAmount: amount });
  });

  return { rows, errors };
}

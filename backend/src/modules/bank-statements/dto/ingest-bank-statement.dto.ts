import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of POST /bank-statements/ingest — a raw CSV body string, not a
 * multipart file upload, exactly like operator/dto/import-flats.dto.ts (see
 * its doc comment: this repo has no file-upload middleware). 500_000 chars
 * comfortably covers a full month's statement for the reference society
 * (SDD §Phase 13) and bounds the payload for a much larger one.
 */
export class IngestBankStatementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  csv!: string;
}

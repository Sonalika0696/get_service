import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of POST /readings/ingest — a raw CSV body string (see
 * reading-csv.util.ts for the expected `serial,value[,capturedAt]` shape),
 * exactly like bank-statements/dto/ingest-bank-statement.dto.ts: this repo
 * has no file-upload middleware, so a bulk import is always a CSV string in
 * the JSON body.
 */
export class IngestReadingsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  csv!: string;
}

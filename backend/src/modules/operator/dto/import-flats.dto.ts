import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * CSV as a request-body string, not a multipart file upload — this repo has
 * no file-upload middleware wired up yet (see KycDocument's doc comment:
 * "no real file storage" even for KYC), and adding one is out of scope for
 * Phase 6.3. 500_000 chars is comfortably more than a 90-flat reference
 * society (SDD §Phase 13) needs, and bounds the payload for a much larger
 * one.
 */
export class ImportFlatsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  csv!: string;
}

import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Phase-2 stub DTO: records upload METADATA only. There is no real file
 * upload handling here (multipart, virus scan, storage) — that's future
 * work once an object store is wired up.
 */
export class UploadKycDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  kind!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;
}

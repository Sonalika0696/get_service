import { IsEmail, IsEnum, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { JobBlogKind } from '../../../generated/prisma/enums.js';

export class CreateJobPostDto {
  @IsEnum(JobBlogKind)
  kind!: JobBlogKind;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  /** Required for HIRING posts (company-email verification gate); unused for SEEKING. */
  @ValidateIf((dto: CreateJobPostDto) => dto.kind === JobBlogKind.HIRING)
  @IsEmail()
  companyEmail?: string;
}

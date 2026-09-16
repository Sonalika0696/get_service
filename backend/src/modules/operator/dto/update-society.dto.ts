import { IsLatitude, IsLongitude, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSocietyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  address?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  /** Society-level feature/config toggles — replaces the whole object, not a deep merge. */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

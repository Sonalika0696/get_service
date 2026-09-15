import { ArrayMinSize, IsArray, IsEmail, IsLatitude, IsLongitude, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateVendorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  categories!: string[];

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  radiusKm?: number;

  /** Self-declared GSTIN; checked against the GSTIN lookup API at approval time, not at onboarding. */
  @IsOptional()
  @IsString()
  @MaxLength(15)
  gstin?: string;
}

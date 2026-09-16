import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSocietyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(400)
  address!: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

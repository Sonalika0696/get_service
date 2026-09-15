import { IsString, MaxLength, MinLength } from 'class-validator';

export class VendorAccessRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  purpose!: string;
}

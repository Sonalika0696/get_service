import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Note is optional on ratify, required on reject — enforced in RatificationService.reject, not here. */
export class DecideRatificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

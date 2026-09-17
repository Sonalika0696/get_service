import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of POST /health-camps/:id/registrations. `attendeeName` is the ONLY
 * personal detail this module ever carries (I5) — do not add anything else
 * to this DTO.
 */
export class RegisterCampDto {
  @IsString()
  @MinLength(1)
  slotId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  attendeeName!: string;
}

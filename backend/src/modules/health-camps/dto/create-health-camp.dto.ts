import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsISO8601, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

/**
 * One slot of a health camp. Purely scheduling + capacity — INVARIANT I5
 * forbids any per-person or clinical field anywhere in this module, so this
 * DTO (and every other one here) carries ONLY identity/logistics fields.
 * Never add a free-text field to this class.
 */
export class CreateHealthCampSlotDto {
  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  @IsInt()
  @Min(1)
  capacity!: number;
}

/**
 * Body of POST /health-camps. `description` is camp-level logistics only
 * (what is offered, what to bring, timing notes) — NEVER per-person
 * information; see HealthCamp.description's doc comment in schema.prisma.
 */
export class CreateHealthCampDto {
  @IsString()
  @MinLength(1)
  providerName!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  venue?: string;

  @IsISO8601()
  campDate!: string;

  @IsISO8601()
  registrationClosesAt!: string;

  /** Major units (rupees). 0 = free. */
  @IsNumber()
  @Min(0)
  chargePerRegistration!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateHealthCampSlotDto)
  slots!: CreateHealthCampSlotDto[];
}

import { IsString, MinLength } from 'class-validator';
import { CreateServiceRequestDto } from './create-service-request.dto.js';

/**
 * Body of POST /service-requests/committee — a COMMITTEE member raises a
 * Phase 8.2 pooling service request on a NAMED flat's behalf (origin=
 * COMMITTEE), e.g. reporting a common-area issue rather than one specific
 * resident's own complaint. `raisedByFlatId` must name a Flat in the
 * caller's own society (validated in the service) — everything else is
 * identical to CreateServiceRequestDto.
 */
export class CreateServiceRequestCommitteeDto extends CreateServiceRequestDto {
  @IsString()
  @MinLength(1)
  raisedByFlatId!: string;
}

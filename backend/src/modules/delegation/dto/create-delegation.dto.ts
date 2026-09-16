import { IsIn, IsString } from 'class-validator';
import { DelegationScope } from '../../../generated/prisma/enums.js';

const DELEGATION_SCOPES = Object.values(DelegationScope);

export class CreateDelegationDto {
  /** One of the resident's own occupancies — see DelegationService.grant. */
  @IsString()
  occupancyId!: string;

  @IsString()
  delegateUserId!: string;

  @IsIn(DELEGATION_SCOPES)
  scope!: DelegationScope;
}

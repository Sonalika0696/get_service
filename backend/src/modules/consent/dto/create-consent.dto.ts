import { IsIn, IsString } from 'class-validator';
import { ConsentPurpose } from '../../../generated/prisma/enums.js';

const CONSENT_PURPOSES = Object.values(ConsentPurpose);

export class CreateConsentDto {
  /** Today: a VENDOR-principal User's id — see VendorsService.getResidentContact. */
  @IsString()
  granteeUserId!: string;

  @IsIn(CONSENT_PURPOSES)
  purpose!: ConsentPurpose;
}

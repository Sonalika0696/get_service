import { IsIn, IsString } from 'class-validator';
import { RoleKind } from '../../../generated/prisma/enums.js';

const ROLE_KINDS = Object.values(RoleKind);

export class AssignRoleDto {
  @IsString()
  userId!: string;

  @IsIn(ROLE_KINDS)
  kind!: RoleKind;
}

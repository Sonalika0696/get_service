import { SetMetadata } from '@nestjs/common';
import type { PrincipalKind } from '../../generated/prisma/enums.js';

export const PRINCIPAL_KIND_METADATA_KEY = 'principal-kind';

/** Requires AuthGuard + PrincipalGuard. Only a RESIDENT principal may call the route; anyone else gets 403. */
export const ResidentOnly = () => SetMetadata<string, PrincipalKind>(PRINCIPAL_KIND_METADATA_KEY, 'RESIDENT');

/** Requires AuthGuard + PrincipalGuard. Only a VENDOR principal may call the route; anyone else gets 403. */
export const VendorOnly = () => SetMetadata<string, PrincipalKind>(PRINCIPAL_KIND_METADATA_KEY, 'VENDOR');

/** Requires AuthGuard + PrincipalGuard. Only an OPERATOR principal may call the route; anyone else gets 403. */
export const OperatorOnly = () => SetMetadata<string, PrincipalKind>(PRINCIPAL_KIND_METADATA_KEY, 'OPERATOR');

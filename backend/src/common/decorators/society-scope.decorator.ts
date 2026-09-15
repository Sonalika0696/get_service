import { SetMetadata } from '@nestjs/common';

export const SOCIETY_SCOPE_METADATA_KEY = 'society-scope';

/**
 * Marks a route whose `:sid` param must match the caller's own society.
 * Needed once routes carry an explicit `:sid` (committee/admin surfaces
 * from Phase 2 onward) — routes without `:sid` are implicitly scoped via
 * `CurrentUser.societyId` in their own queries and don't need this.
 */
export const SocietyScope = () => SetMetadata(SOCIETY_SCOPE_METADATA_KEY, true);

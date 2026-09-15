import { SetMetadata } from '@nestjs/common';

export const AUDIT_LOG_METADATA_KEY = 'audit-log:action';

export interface AuditLogMetadata {
  action: string;
  subjectType: string;
}

/**
 * Marks a route as one whose outcome should be written to the append-only
 * audit log. Routes without this decorator are not audited — most GETs
 * don't need to be; mutating routes from Phase 1 onward should carry it.
 */
export const AuditLog = (action: string, subjectType: string) => SetMetadata(AUDIT_LOG_METADATA_KEY, { action, subjectType } satisfies AuditLogMetadata);

import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service.js';
import { AUDIT_LOG_METADATA_KEY, type AuditLogMetadata } from '../decorators/audit-log.decorator.js';

interface RequestWithUser extends Request {
  /** Populated by AuthGuard from Phase 1 onward. */
  user?: { id: string; societyId: string };
}

/**
 * Global interceptor; only does work on routes carrying `@AuditLog(...)`.
 * Writes fire-and-forget (don't block or fail the response) — an audit
 * write failure should be logged, never surfaced to the caller.
 *
 * Resolves societyId from the route's `:sid` param if present, else from
 * the authenticated user's own society (one user, one society in v1 — see
 * SUPERVISOR.md decisions log). Skips the write (logged) if neither is
 * available, rather than guessing.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditLogMetadata | undefined>(AUDIT_LOG_METADATA_KEY, context.getHandler());

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    return next.handle().pipe(
      tap((responseBody: unknown) => {
        const societyId = resolveSocietyId(request);
        if (!societyId) {
          this.logger.warn(`Skipping audit log for ${metadata.action}: no societyId resolvable from route or session`);
          return;
        }

        const subjectId = extractSubjectId(responseBody, request.params);
        this.auditService
          .append({
            societyId,
            actorId: request.user?.id ?? null,
            action: metadata.action,
            subjectType: metadata.subjectType,
            subjectId,
            payload: safeJson({ params: request.params, body: request.body }),
          })
          .catch((error: unknown) => {
            this.logger.error(`Failed to write audit log for ${metadata.action}`, error instanceof Error ? error.stack : String(error));
          });
      }),
    );
  }
}

function resolveSocietyId(request: RequestWithUser): string | null {
  const sidParam = request.params.sid;
  if (typeof sidParam === 'string') return sidParam;
  return request.user?.societyId ?? null;
}

function extractSubjectId(responseBody: unknown, params: Record<string, string | string[]>): string {
  if (responseBody && typeof responseBody === 'object' && 'id' in responseBody) {
    const id = (responseBody as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  const paramId = params.id;
  return typeof paramId === 'string' ? paramId : 'unknown';
}

function safeJson(value: unknown): object {
  return JSON.parse(JSON.stringify(value ?? {})) as object;
}

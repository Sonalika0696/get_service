import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AUDIT_LOG_METADATA_KEY, type AuditLogMetadata } from '../decorators/audit-log.decorator.js';

interface RequestWithUser extends Request {
  user?: { id: string };
}

/**
 * Global interceptor; only does work on routes carrying `@AuditLog(...)`.
 * Writes fire-and-forget (don't block or fail the response) — an audit
 * write failure should be logged, never surfaced to the caller.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditLogMetadata | undefined>(AUDIT_LOG_METADATA_KEY, context.getHandler());

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    return next.handle().pipe(
      tap((responseBody: unknown) => {
        const subjectId = extractSubjectId(responseBody, request.params);
        this.prisma.auditLog
          .create({
            data: {
              actorId: request.user?.id ?? null,
              action: metadata.action,
              subjectType: metadata.subjectType,
              subjectId,
              payload: safeJson({ params: request.params, body: request.body }),
            },
          })
          .catch((error: unknown) => {
            this.logger.error(`Failed to write audit log for ${metadata.action}`, error instanceof Error ? error.stack : String(error));
          });
      }),
    );
  }
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

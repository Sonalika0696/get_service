import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  /** True when this call returned a *stored* result from an earlier call with the same (scope, key) instead of running `fn` again. */
  replayed: boolean;
}

/**
 * Generic idempotency-key infrastructure, kept in `ledger/` for now (the
 * ledger adjustment endpoint is its first caller) but designed to be
 * reused as-is by Phase 4B's payment/webhook routes: a route reads its
 * caller-supplied `Idempotency-Key` header, picks a stable `scope` string
 * for itself (e.g. its own route name), and calls `runOnce(scope, key,
 * societyId, fn)` with `fn` doing the actual (transactional) work.
 *
 * `fn` receives the same Prisma transaction client the existence-check and
 * the stored-response insert run in, so a replay race can't create the
 * side effect twice: the whole "check -> run -> record" sequence is one
 * atomic unit of work, serialized per (scope, key) by a Postgres advisory
 * lock (mirrors AuditService.append's use of pg_advisory_xact_lock).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async runOnce<T>(scope: string, key: string, societyId: string | null, fn: (tx: Prisma.TransactionClient) => Promise<{ status: number; body: T }>): Promise<IdempotentResult<T>> {
    return this.prisma.$transaction(async (tx) => {
      // Advisory lock namespace 51 = "idempotency key"; released automatically
      // at transaction end. Serializes concurrent replays of the same
      // (scope, key) so the check-then-insert below can't race.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(51, hashtext(${`${scope}:${key}`}))`;

      const existing = await tx.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
      if (existing) {
        return { status: existing.responseStatus, body: existing.responseBody as T, replayed: true };
      }

      const result = await fn(tx);

      await tx.idempotencyKey.create({
        data: {
          scope,
          key,
          societyId,
          responseStatus: result.status,
          // Normalize through JSON so what's stored is exactly what a JSON
          // HTTP response would carry (Decimal/Date -> string), matching what
          // a fresh (non-replayed) call returns to the client — see
          // AuditLogInterceptor's safeJson() for the same pattern.
          responseBody: JSON.parse(JSON.stringify(result.body)) as never,
        },
      });

      return { ...result, replayed: false };
    });
  }
}

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../app.module.js';

/**
 * Resolved from this compiled file's own location (dist/openapi/document.js)
 * rather than `process.cwd()`, so the path is the same repo-root
 * shared/openapi.json regardless of whether npm scripts are invoked from
 * the repo root or from backend/ (both are common with npm workspaces).
 */
export function sharedOpenApiPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/openapi -> dist -> backend -> repo root
  return resolve(here, '../../../shared/openapi.json');
}

/**
 * Phase 6.5 — OpenAPI spec generation (BACKEND_PLAN.md Phase 6.5).
 *
 * Boots the full Nest APPLICATION CONTEXT — `NestFactory.create` without
 * ever calling `.listen()` — purely so `@nestjs/swagger`'s
 * `SwaggerModule.createDocument` can walk the real DI container and read
 * every controller/route's decorator metadata (including the CLI-plugin-
 * inferred DTO shapes configured in nest-cli.json). No HTTP port is bound
 * and no request is ever served, so this is safe to run in CI: it never
 * calls out to Razorpay/SMS/GSTIN (all off-by-default per env.schema.ts —
 * RazorpayService/SmsService/GstinApiService only hit the network when
 * their *_ENABLED flag is true, which it isn't for this script's env), and
 * the only side effect is PrismaModule's normal DB connection to the
 * already-running Postgres instance (see backend/.env DATABASE_URL) — the
 * same thing every unit/e2e test run already does.
 *
 * This module is imported by both `generate.ts` (writes shared/openapi.json)
 * and `check.ts` (the CI drift guard) so the two can never disagree about
 * how the document is built.
 *
 * Consumers (packages/api-client, apps/*) generate their typed HTTP client
 * from the emitted shared/openapi.json — this package only produces the
 * spec, it does not own or regenerate the client itself.
 */
export async function buildOpenApiDocument(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(AppModule, { logger: false });
  // Mirrors main.ts's app.setGlobalPrefix exactly, so the paths in the
  // generated document match the real, mounted routes (e.g.
  // /api/v1/auth/signup, with /health left unprefixed). This app instance
  // never listens on a port, so setting the prefix here has no runtime
  // effect on anything — it only shapes the document SwaggerModule reads.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  const config = new DocumentBuilder()
    .setTitle('Society FinTech API')
    .setDescription(
      'GateX / Society FinTech backend HTTP API, generated from the NestJS route ' +
        'and DTO decorators in backend/src — see backend/src/openapi/document.ts. ' +
        'Not hand-edited: run `npm run openapi:generate --workspace backend` to ' +
        'regenerate after any route/DTO change, and `npm run openapi:check ' +
        '--workspace backend` (wired into CI) to catch drift. Consumers generate ' +
        'their typed client from this file — see shared/README.md.',
    )
    .setVersion('1.0.0')
    .addCookieAuth('sid', { type: 'apiKey', in: 'cookie', name: 'sid' })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  await app.close();
  return document;
}

/**
 * `JSON.stringify` with object keys sorted alphabetically at every level
 * (arrays keep their original element order — only object *key* order is
 * unstable coming out of Swagger's introspection, e.g. across Node
 * versions or object-spread call sites; array element order is always
 * meaningful, e.g. `parameters`, and must never be reordered).
 *
 * This is what makes the emitted file byte-for-byte deterministic: running
 * the generator twice in a row, or on two different machines, produces an
 * identical shared/openapi.json — which is exactly what `check.ts` relies
 * on to detect real drift instead of incidental key-order noise.
 */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

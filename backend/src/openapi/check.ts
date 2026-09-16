import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildOpenApiDocument, sharedOpenApiPath, stableStringify } from './document.js';

/**
 * `npm run openapi:check` (backend/package.json) — the CI drift guard for
 * Phase 6.5 (BACKEND_PLAN.md: "CI fails on drift"). Regenerates the OpenAPI
 * document to a throwaway temp file (mirroring exactly what
 * `openapi:generate` would produce) and byte-compares it against the
 * committed repo-root shared/openapi.json. Exits non-zero with a clear
 * message on any difference — a stale spec (route/DTO changed but
 * shared/openapi.json wasn't regenerated) fails the build instead of
 * silently shipping a wrong contract to typed-client consumers.
 */
async function main(): Promise<void> {
  const document = await buildOpenApiDocument();
  const fresh = stableStringify(document);

  const tmpDir = await mkdtemp(join(tmpdir(), 'openapi-check-'));
  const tmpPath = join(tmpDir, 'openapi.json');
  try {
    await writeFile(tmpPath, fresh, 'utf8');

    const committedPath = sharedOpenApiPath();
    let committed: string;
    try {
      committed = await readFile(committedPath, 'utf8');
    } catch {
      console.error(`OpenAPI spec is stale — run npm run openapi:generate and commit (${committedPath} does not exist yet)`);
      process.exitCode = 1;
      return;
    }

    if (committed !== fresh) {
      console.error('OpenAPI spec is stale — run npm run openapi:generate and commit');
      console.error(`  committed: ${committedPath}`);
      console.error(`  freshly generated (for inspection): ${tmpPath}`);
      process.exitCode = 1;
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`OpenAPI spec is up to date (${committedPath}).`);
  } finally {
    if (process.exitCode !== 1) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

await main();

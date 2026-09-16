import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildOpenApiDocument, sharedOpenApiPath, stableStringify } from './document.js';

/**
 * `npm run openapi:generate` (backend/package.json). Writes the generated
 * document to repo-root `shared/openapi.json`. Run this (via `nest build`
 * first, so the @nestjs/swagger CLI plugin configured in nest-cli.json has
 * compiled DTO metadata in) after any route/DTO change and commit the
 * result — `npm run openapi:check` is what enforces that in CI.
 *
 * This file's only export is side-effecting (`main()` runs at import time),
 * unlike document.ts — deliberately: nothing else should ever import this
 * module, so that stays safe. `check.ts` imports `sharedOpenApiPath` from
 * document.ts instead, not from here.
 */
async function main(): Promise<void> {
  const document = await buildOpenApiDocument();
  const outPath = sharedOpenApiPath();
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, stableStringify(document), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote OpenAPI spec (${Object.keys(document.paths).length} paths) to ${outPath}`);
}

await main();

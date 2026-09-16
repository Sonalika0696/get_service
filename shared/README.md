# shared/

## `openapi.json`

Generated — do not hand-edit. Produced from the NestJS route/DTO decorators
in `backend/src` by `backend/src/openapi/document.ts`.

- Regenerate: `npm run openapi:generate --workspace backend`
- Check for drift (wired into CI): `npm run openapi:check --workspace backend`
  — fails non-zero if a route or DTO changed without regenerating.

Consumers (`packages/api-client`, `apps/*`) generate their typed HTTP client
from this file; that generation step lives in those packages, not here.

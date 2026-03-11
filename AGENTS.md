# Repository Guidelines

## Project Structure & Module Organization
This project is a Cloudflare Workers proxy with a static admin UI.

- `src/index.ts`: Worker entrypoint and route mounting.
- `src/routes/`: HTTP handlers (`v1/` for OpenAI/Anthropic-compatible APIs, plus auth/token/admin routes).
- `src/grok/`: Upstream Grok integration logic (chat, image, video, headers, model helpers).
- `src/repo/`: D1 data-access helpers (API keys, tokens).
- `src/middleware/`: shared middleware (API auth, request guards).
- `src/utils/`: utility helpers.
- `migrations/`: D1 SQL migrations.
- `static/`: frontend assets (`css/`, `js/`, HTML).
- `wrangler.toml`: Worker, D1, KV, and asset bindings.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: run local Worker via Wrangler.
- `npm run typecheck`: strict TypeScript check (`noEmit`).
- `npm run deploy`: deploy Worker.
- `npm run db:migrate`: apply D1 migrations to remote DB.
- First-time local DB setup (example):
  - `npx wrangler d1 create grok-art-proxy --local`
  - `npx wrangler d1 migrations apply DB --local`

## Coding Style & Naming Conventions
- Language: TypeScript (ES modules), strict mode enabled in `tsconfig.json`.
- Indentation: 2 spaces; keep functions small and endpoint-focused.
- Naming:
  - files/modules: `kebab-case` (e.g., `image-edit.ts` style where applicable)
  - variables/functions: `camelCase`
  - types/interfaces: `PascalCase`
  - constants: `UPPER_SNAKE_CASE`
- Keep route translation logic explicit; avoid hidden magic in request/response mapping.

## Testing Guidelines
No dedicated unit test framework is currently configured. Minimum validation for every change:

1. Run `npm run typecheck`.
2. Smoke test changed endpoints locally (`npm run dev` + `curl`).
3. If DB behavior changes, run relevant migration(s) and verify read/write paths.

When adding tests, colocate by feature (for example under `src/routes/v1/__tests__/`).

## Commit & Pull Request Guidelines
Follow existing commit style from history:
- `fix(scope): ...`
- `feat: ...`
- `docs: ...`
- `debug(scope): ...`

Use imperative, concise subjects and include scope when helpful (e.g., `fix(vision): ...`).

PRs should include:
1. What changed and why.
2. API surface impact (request/response fields, model mapping, auth behavior).
3. Migration notes for `migrations/` updates.
4. Validation evidence (`typecheck`, manual endpoint checks, UI screenshots for `static/` changes).

## Security & Configuration Tips
- Never commit real tokens or secrets; use `.dev.vars` locally and Wrangler secrets in Cloudflare.
- Treat `AUTH_USERNAME`, `AUTH_PASSWORD`, and API keys as secrets.
- Review `wrangler.toml` bindings carefully before deploy (D1/KV IDs, environment vars).

# AGENTS.md

## Cursor Cloud specific instructions

This is a **Cloudflare Workers** application (Hono framework) that proxies requests to grok.com. It is a single-service project (not a monorepo).

### Quick reference

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Type check | `npm run typecheck` |
| Dev server | `npm run dev` (starts on `http://localhost:8787`) |
| Apply DB migrations (local) | `npx wrangler d1 migrations apply DB --local` |

### Dev environment setup caveats

- Before running `npm run dev`, you must have a `.dev.vars` file in the project root with `AUTH_USERNAME` and `AUTH_PASSWORD` set (see `.dev.vars.example`).
- Local D1 migrations (`npx wrangler d1 migrations apply DB --local`) must be applied before the first `npm run dev` run, otherwise database tables will not exist. Migrations are idempotent and safe to re-run.
- `wrangler dev` automatically emulates D1 (SQLite) and KV locally — no Docker or external databases are needed.
- The `npm run typecheck` command currently has 2 pre-existing TS errors in `src/routes/v1/messages.ts` (TS2532). These are in the existing codebase and do not affect runtime.
- There are no automated test suites in this project. Validation is done via type checking (`npm run typecheck`) and manual testing of the running dev server.
- There is no dedicated lint command (e.g. ESLint). The only static analysis available is `npm run typecheck`.

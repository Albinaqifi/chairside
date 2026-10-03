# Chairside

Scheduling app for dental clinics with automated patient communication. Multi-clinic,
holds health data, built by one developer with AI agents.

**Status:** the project skeleton and database foundation exist (E00-T01). What is done and
what comes next is on the board, `docs/progress/board.md`.

## Start of every session (in this order)

1. `docs/intent.md` — what we build and why. Short. Always read it.
2. `docs/process/agent-rules.md` — the working rules. Short. Always read it.
3. `docs/progress/board.md` — what is done, in progress, next, blocked.
4. Your task in `docs/backlog/` — then **only** the documents its "Read" line lists.

Do not read the whole `docs/` tree. `docs/README.md` is the map if you need to find something.

## Rules that are never broken

- **No real patient data** anywhere outside production. Synthetic data only.
- **Every tenant table has `clinic_id` and Row-Level Security.** No query bypasses the tenant context.
- **Every outgoing message goes through the message pipeline** (a row in `messages` first). Never call a provider directly.
- **Nothing AI-written reaches a patient without human approval,** and no patient identifiers go to the AI.
- **No patient data in logs, errors, test snapshots, commits or handoff notes.**
- **Stay inside your task.** Found something else? Write it in the board's "Discovered" list. Do not fix it.
- **Never weaken or delete a test to make it pass.**
- **Stop and ask the owner** when the rules say so (`agent-rules.md`, rule 4).

## Design reference

The two HTML files in `design/originals/` are the original plan and UI design. They are compressed
bundles; readable copies are in `design/unpacked/`. They are a **visual and behavioural
reference, not code to copy**. Where the demo and the docs disagree, the docs win
(`docs/product/design-reference.md` lists every deliberate difference).

## Technical conventions

Stack and reasons: `docs/architecture/overview.md`. First-time setup: `README.md`.

### Commands

| Command | What it does |
|---|---|
| `pnpm check` | **Everything a task must pass:** format, lint, types, unit and integration tests. Needs the database: `docker compose up -d --wait`. |
| `pnpm dev` | The app at http://localhost:3000. |
| `pnpm test` | Unit tests (`src/**/*.test.ts`, `eslint-rules/`). No database. |
| `pnpm test:integration` | Tests against real PostgreSQL (`tests/integration/`). First rebuilds the separate `<db>_test` database from the migrations. |
| `pnpm exec vitest run <file>` | One test file. |
| `pnpm lint` · `pnpm typecheck` | ESLint (a warning fails too) · `next typegen` + `tsc`. |
| `pnpm format` · `pnpm format:check` | Prettier: fix · check only. Markdown and `docs/` are not formatted. |
| `pnpm db:reset` | Rebuild the local database from nothing: roles, database, every migration. Refuses any non-local host, and URLs that do not all name the same host and port. |
| `pnpm db:migrate` | Apply pending migrations as the migration role. |
| `pnpm db:generate --name <what>` | Generate a migration from changed `schema.ts` files. |
| `pnpm build` · `pnpm start` | Production build · run it. |

Every script must work on Windows (the owner's OS): no bash-only syntax in `package.json`.

### Folder structure

```
src/app/              Next.js routes. Thin: parse input, call a module, render.
src/modules/<name>/   All business logic. index.ts = public API, schema.ts = its tables.
src/db/               Connection pool, withTenant, migrations/, migrate and reset scripts.
src/lib/              Small shared pieces: clock, ids, logger, personal-fields.
tests/integration/    Tests against real PostgreSQL, including the tenant meta-test.
eslint-rules/         The module-boundary lint rule and the tests of all architecture rules.
```

Create a folder only when it has content. Coming later: `src/ui` (E00-T04), `tests/e2e` (E00-T06), `src/worker` (E00-T07).

### Module rules (lint enforces them; `eslint-rules/architecture.test.ts` proves it)

1. A module's tables are private. Other modules call its functions, never query its tables.
2. Import another module only through its `index.ts`: `@/modules/patients`. One exception: a
   `schema.ts` may import another module's `schema.ts` to declare foreign keys (D-058).
3. No Next.js or React in `src/modules`, so the worker and tests can use every module.
4. No reading the clock in `src/modules` (`Date.now()`, `new Date()`, `DateTime.now()`…).
   Take `now: Date` as a parameter, or a `Clock` from `src/lib/clock.ts`; tests use `fakeClock`.

### Code conventions

- TypeScript strict, plus `noUncheckedIndexedAccess`. `@/…` imports for `src/`; `import type` for types.
- Files `kebab-case.ts`. Tables and columns `snake_case`, tables plural. TypeScript `camelCase`.
- Ids: `newId()` from `src/lib/ids.ts` (UUID v7). Moments `timestamptz`, calendar dates `date`.
  `updated_at` is set from the passed-in `now` when a row changes.
- Database: only inside `withTenant(clinicId, async (tx) => …)` from `src/db/tenant.ts`, opened
  once at the edge (action wrapper, job handler). Module functions take that `tx` as a parameter;
  a `withTenant` inside another is refused with an error (D-060). Waiting for a pooled connection
  or a lock fails after 5 s. Never import `src/db/client.ts` elsewhere, never set `app.clinic_id`.
- After each `withTenant` the connection is reset (`DISCARD ALL`) before it goes back to the pool,
  or closed if the reset fails (D-061): nothing set on a connection outlives its transaction. So
  no named prepared statements (`.prepare('name')`): pg would reuse ones the reset removed.
- Logs: `logger` from `src/lib/logger.ts`, ids and codes only. It drops the fields listed in
  `src/lib/personal-fields.ts` as a safety net, not as permission to log personal data.
- Files Node runs directly (`src/db/migrate.ts`, `src/db/reset.ts`): import only packages and
  relative `.ts` files, never `@/`.
- Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before writing
  Next.js code. `AGENTS.md` holds the block `next dev` checks for; leave it.

### Database roles and settings

- `chairside_migrator` runs migrations and owns the schema. `chairside_app` is the app's role:
  owns nothing, cannot bypass Row-Level Security, cannot change the schema or create temporary
  tables.
- Settings are listed in `.env.example`. Agents cannot read `.env` files (`.claude/settings.json`);
  never print environment values. If `.env` is missing, ask the owner.

### How to add a table

1. Check it against `docs/architecture/data-model.md`. A table or column that is not there
   needs the owner (agent rule 4) and a decision-log entry.
2. Define it in `src/modules/<module>/schema.ts`: `id uuid` primary key with `$defaultFn(newId)`;
   `clinic_id uuid not null` referencing `clinics.id`; unique `(clinic_id, id)`; foreign keys to
   other tenant tables include `clinic_id`; `created_at` (and `updated_at` if rows change);
   allowed values as text with a check constraint.
3. `pnpm db:generate --name <what>`, read the SQL, then append (statements separated by
   `--> statement-breakpoint`):
   ```sql
   ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "x_tenant_isolation" ON "x"
     USING ("clinic_id" = current_clinic_id()) WITH CHECK ("clinic_id" = current_clinic_id());
   GRANT SELECT, INSERT, UPDATE, DELETE ON "x" TO chairside_app; -- only what the app needs
   ```
4. `pnpm db:reset`, then `pnpm test:integration`. The meta-test
   (`tests/integration/tenant-tables.test.ts`) fails if `clinic_id`, RLS or the policy is missing,
   or if a policy does more than compare `clinic_id` with `current_clinic_id()`: extra conditions
   joined with AND are fine, OR and NOT are not. It also fails for a view without
   `WITH (security_invoker = true)`, for any materialized view, and for a SECURITY DEFINER
   function that is not in `CROSS_CLINIC_FUNCTIONS`.
5. A table without a clinic, or a SECURITY DEFINER function that looks across clinics, is rare and
   critical: add it to `tests/integration/tenant-allow-list.ts` (`GLOBAL_TABLES` or
   `CROSS_CLINIC_FUNCTIONS`) with the reason, and flag it in the handoff note.

### How to write a migration

- Change a `schema.ts`, run `pnpm db:generate --name <what>`, read the SQL, and add what
  drizzle-kit does not generate: RLS, policies, grants, extensions, functions.
- Commit the SQL file and the `meta/` files together. Never edit a merged migration: write a new one.

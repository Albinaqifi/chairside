# Chairside

Scheduling app for dental clinics with automated patient communication. Multi-clinic,
holds health data, built by one developer with AI agents.

**Status:** the project skeleton and database foundation (E00-T01), login with clinic
membership (E00-T02), the action wrappers with the audit log (E00-T03), the lint rules that
guard them with the login audit (E00-T08, their known gaps closed in E00-T10), CI on GitHub
(E00-T06a), and a login form that never puts the password in the URL (E00-T09) exist. What is
done and what comes next is on the board, `docs/progress/board.md`.

## Start of every session (in this order)

1. `docs/intent.md` — what we build and why. Short. Always read it.
2. `docs/process/agent-rules.md` — the working rules. Short. Always read it.
3. `docs/progress/board.md` — what is done, in progress, next, blocked.
4. Your task in `docs/backlog/`: its own section of the epic file (its `### <task-id>` heading to
   the next `###`) and the epic's introduction, not the other tasks — then **only** the documents
   its "Read" line lists.

Do not read the whole `docs/` tree. `docs/README.md` is the map if you need to find something.

## Rules that are never broken

- **No real patient data** anywhere outside production. Synthetic data only.
- **Every tenant table has `clinic_id` and Row-Level Security.** No query bypasses the tenant context.
- **Every outgoing message goes through the message pipeline** (a row in `messages` first). Never call a provider directly.
- **Nothing AI-written reaches a patient without human approval,** and no patient identifiers go to the AI.
- **No patient data in logs, errors, test snapshots, commits or handoff notes.**
- **Stay inside your task.** Found something else? Write one line in `docs/progress/discovered.md`. Do not fix it.
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

### CI

`.github/workflows/ci.yml` runs on every pull request to `main`, every push to `main` and every
Monday on `main`: Ubuntu, a fresh checkout, `.env` copied from `.env.example`, the database from
`docker compose` (D-075). It runs each command of `pnpm check` as its own step with `TZ=UTC`, then
`pnpm build`, then `pnpm test` and `pnpm test:integration` again with `TZ=Pacific/Auckland` (the
Auckland steps: a test that passes in one zone only depends on the server's time zone), then
`pnpm audit --prod` (an advisory in a production dependency turns the run red) and the full
`pnpm audit` (printed only). Every check runs even after an earlier one failed; a failed setup step
ends the run. GitHub does not block a merge on red: the pipeline goes on only on green, and the
owner merges only on green (R-34). The step names are the pipeline's input: a red `Setup: …` step
or `pnpm audit --prod` stops it for the owner, any other red `pnpm …` step is a fix round (D-078).

Each level on your machine, with the database up:

| Level | Command |
|---|---|
| The `pnpm check` steps | `pnpm check`, or one of its commands |
| The build | `pnpm build` |
| The Auckland steps, PowerShell | `$env:TZ = 'Pacific/Auckland'; pnpm test; pnpm test:integration; Remove-Item Env:TZ` |
| The Auckland steps, macOS or Linux | `TZ=Pacific/Auckland pnpm test && TZ=Pacific/Auckland pnpm test:integration` |
| The dependency check | `pnpm audit --prod` (must pass) · `pnpm audit` (everything; read it). Never `--fix`, `--ignore` or `--ignore-unfixable`: they write `pnpm-workspace.yaml` |

Not Git Bash for the Auckland steps (the agents' Bash tool): it drops `TZ=Pacific/Auckland` before
Node starts, and Node then runs in the machine's own zone without an error (`TZ=UTC` gets through).
The zone Node really has: `node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"`.

### Folder structure

```
src/app/              Next.js routes. Thin: parse input, call a module, render.
  (auth)/             Login and the clinic picker: the pages a user sees before they have a clinic.
  (staff)/            The staff app. Its layout and every page start from currentStaff().
  _lib/               Request-edge helpers: who is signed in; the action wrappers; the auth client.
  api/auth/           The auth library's routes (sign-in, sign-out, get-session). No code of ours.
src/proxy.ts          Moves the session forward and renews its cookie (D-067); no valid session → /login,
                      except a server action: its wrapper sends the person there (D-074).
                      Not the permission check: pages and actions still call currentStaff().
src/modules/<name>/   All business logic. index.ts = public API, schema.ts = its tables.
src/db/               Connection pool, withTenant, migrations/, migrate and reset scripts.
src/lib/              Small shared pieces: clock, ids, logger, personal-fields.
tests/integration/    Tests against real PostgreSQL, including the tenant meta-test.
eslint-rules/         Our lint rules (module boundaries, server actions, database access, forms) and
                      the tests of all architecture rules.
```

Create a folder only when it has content. Coming later: `src/ui` (E00-T04), `tests/e2e` (E00-T06b), `src/worker` (E00-T07).

### Module rules (lint enforces them; `eslint-rules/architecture.test.ts` proves it)

No lint comment switches a rule off in `src/`: ESLint ignores `eslint-disable` and `/* eslint … */`
there and reports the comment itself (`noInlineConfig`, D-077).

1. A module's tables are private. Other modules call its functions, never query its tables.
2. Import another module only through its `index.ts`: `@/modules/patients`. One exception: a
   `schema.ts` may import another module's `schema.ts` to declare foreign keys (D-058).
3. No Next.js or React in `src/modules`, so the worker and tests can use every module.
4. No reading the clock in `src/modules` (`Date.now()`, `new Date()`, `DateTime.now()`…).
   Take `now: Date` as a parameter, or a `Clock` from `src/lib/clock.ts`; tests use `fakeClock`.
5. Every server action is `export const name = staffAction(…)` (or `staffRead`, `userAction`) in
   a `'use server'` file in `src/app`, the wrapper imported from `@/app/_lib/actions` under its own
   name. Such a file exports nothing else but types, and never a `.forPage`. No inline
   `'use server'`, no `'use server'` file outside `src/app`, in `src/` or anywhere else in the
   repository. A route handler (`route.ts`) needs a line with its reason in `ROUTE_HANDLERS` in
   `eslint-rules/server-actions.mjs`. No `src/pages/`: Next.js would serve the Pages Router there,
   outside the wrappers (D-071, D-073, D-077).
6. `@/db/client` only in `src/db/` and `src/modules/auth/`; `withTenant` only in
   `src/app/_lib/actions.ts`, `src/db/` and `src/modules/auth/`; `import type { TenantTransaction }`
   anywhere. Those three places never re-export `withTenant` or anything from the client file.
   Database drivers only in `src/db/`: `pg`, `pg-…` packages, every `drizzle-orm/…` path but
   `drizzle-orm/pg-core`, and `src/db/reset` and `src/db/migrate`; `drizzle-orm` and
   `drizzle-orm/pg-core` anywhere, type-only imports too. Tests are exempt (D-062, D-071, D-077).
7. Type-aware, for the `.ts`, `.tsx` and `.mts` files in `src/`: every promise is awaited, Drizzle
   queries included (`no-floating-promises`; `no-misused-promises`, so no
   `items.forEach(async …)`), and only Errors are thrown or rejected (`only-throw-error`,
   `prefer-promise-reject-errors`: a refusal is returned, never thrown). In the `.ts` and `.mts`
   files, a statement that only hangs `.catch(…)` or `.then(ok, fail)` on a promise is reported:
   await it or return it. `src/` holds no `.js`, `.jsx`, `.mjs`, `.cjs` or `.cts` files, which
   these rules would not see (a test fails) (R-32, D-073, D-074, D-077).

### Code conventions

- TypeScript strict, plus `noUncheckedIndexedAccess`. `@/…` imports for `src/`; `import type` for types.
- Files `kebab-case.ts`. Tables and columns `snake_case`, tables plural. TypeScript `camelCase`.
- Ids: `newId()` from `src/lib/ids.ts` (UUID v7). Moments `timestamptz`, calendar dates `date`.
  `updated_at` is set from the passed-in `now` when a row changes.
- Database: only inside `withTenant(clinicId, async (tx) => …)` from `src/db/tenant.ts`, opened
  once at the edge (action wrapper, job handler). Module functions take that `tx` as a parameter;
  a `withTenant` inside another is refused with an error (D-060). Waiting for a pooled connection
  or a lock fails after 5 s. Never set `app.clinic_id`. Never import `src/db/client.ts` elsewhere,
  with one exception: `src/modules/auth/` uses `getDb()` for the auth library's global tables and
  for the cross-clinic function `clinics_for_user()` (D-062).
- After each `withTenant` the connection is reset (`DISCARD ALL`) before it goes back to the pool,
  or closed if the reset fails (D-061): nothing set on a connection outlives its transaction. So
  no named prepared statements (`.prepare('name')`): pg would reuse ones the reset removed.
- Who is signed in: every server action is made by a wrapper in `src/app/_lib/actions.ts` (D-071,
  D-072). `staffAction`: a change (session → clinic check → permission → Zod → handler and one audit
  row in one `withTenant`). `staffRead`: a read, as an action or `.forPage(input)` in a page.
  `userAction`: before a clinic is chosen. Each names its permission or `'every_member'`. The
  browser calls `action(clinicId, input)` with its page's clinic (D-069) and gets `{ ok: true,
  value }` or `{ ok: false, error: { code } }`; `return refuse('code')` says no, a throw is `internal`:
  ```ts
  export const renamePatient = staffAction( // 'use server' file; patients.rename = a module function
    { permission: 'patients.manage', input: z.object({ patientId: z.uuid(), name: z.string() }),
      audit: { action: 'patient.renamed', entityType: 'patient', entityId: ({ input }) => input.patientId } },
    async ({ input, tx, now }) => (await patients.rename(tx, input, now)) ?? refuse('not_found'));
  ```
  Other pages use `currentStaff()` (`src/app/_lib/auth.ts`). Login and logout are the auth
  library's routes (`authClient`). Never read the session cookie or a password (D-063).
- Forms: a form posts to a URL named in its `action`, or takes a function as its action; never
  only `onSubmit`, which leaves the browser to send a GET with every field in the URL whenever the
  handler does not run (D-076). Write `method="post"` and the `action` out, after any spread; a
  button or input has no `formMethod`, or `formMethod="post"`. A button's or input's `formAction`
  follows a form's rule: a function, or a URL with `formMethod="post"` on the same element. A
  component that spreads its props onto a `<button>` or `<input>` types them without `formAction`
  and `formMethod` (`Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'>`) and writes a
  function `formAction` out if it needs one (D-081). `next/form` is not used: its `<Form>` sends a
  URL action as a GET. Lint checks every `<form>`, `<button>` and `<input>` in the `.tsx` files of
  `src/` (`chairside/forms-post`, type-aware, D-080, D-081; cases in
  `eslint-rules/architecture.test.ts`).
- Logs: `logger` from `src/lib/logger.ts`, ids and codes only. It drops the fields listed in
  `src/lib/personal-fields.ts` as a safety net, not as permission to log personal data. Errors
  leave `withTenant` without query values (D-070): keep a caught error as `cause`, never copy its
  message into a new error or a string.
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

# Chairside

Scheduling app for dental clinics with automated patient communication. Multi-clinic,
holds health data, built by one developer with AI agents.

**Status:** on the board, `docs/progress/board.md`.

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
| `pnpm check` | **Everything a task must pass:** format, lint, types, unit and integration tests; before it hands off, the builder also runs `pnpm build` (CI builds too). Needs the database: `docker compose up -d --wait`. |
| `pnpm dev` | The app at http://localhost:3000. |
| `pnpm test` | Unit tests (`src/**/*.test.ts`, `eslint-rules/`). No database. |
| `pnpm test:integration` | Tests against real PostgreSQL (`tests/integration/`). First rebuilds the separate `<db>_test` database from the migrations. |
| `pnpm exec vitest run <file>` | One test file. |
| `pnpm lint` · `pnpm typecheck` | ESLint (a warning fails too) · `next typegen` + `tsc`. |
| `pnpm format` · `pnpm format:check` | Prettier: fix · check only. Markdown and `docs/` are not formatted. |
| `pnpm db:reset` | Rebuild the local database from nothing: roles, database, every migration, then the seed. Refuses any non-local host, and URLs that do not all name the same host and port. |
| `pnpm db:seed` | Add the seed (`src/db/seed/`): two invented clinics and a login for every role, listed in `README.md`. The same guard as `db:reset`; a second run adds nothing. |
| `pnpm db:migrate` | Apply pending migrations as the migration role. |
| `pnpm db:generate --name <what>` | Generate a migration from changed `schema.ts` files. |
| `pnpm build` · `pnpm start` | Production build · run it. |

Every script must work on Windows (the owner's OS): no bash-only syntax in `package.json`.

### CI

`.github/workflows/ci.yml` (D-075) runs the `pnpm check` steps, `pnpm build`, the tests again with
`TZ=Pacific/Auckland`, and `pnpm audit`: on every pull request to `main`, every push to `main` and
every Monday. A pull request that changes only files under `docs/`, Markdown files under
`.claude/`, `CLAUDE.md` or `README.md` gets no run; the architect merges its own such planning pull
request (D-087). The owner merges every other pull request, only on green (R-34). Each level on
your machine, with the database up:

| Level | Command |
|---|---|
| The `pnpm check` steps | `pnpm check`, or one of its commands |
| The build | `pnpm build` |
| The Auckland steps, PowerShell | `$env:TZ = 'Pacific/Auckland'; pnpm test; pnpm test:integration; Remove-Item Env:TZ` |
| The Auckland steps, macOS or Linux | `TZ=Pacific/Auckland pnpm test && TZ=Pacific/Auckland pnpm test:integration` |
| The dependency check | `pnpm audit --prod` (must pass) · `pnpm audit` (everything; read it). Never `--fix`, `--ignore` or `--ignore-unfixable`: they write `pnpm-workspace.yaml` |

Not Git Bash for the Auckland steps (the agents' Bash tool): it drops `TZ=Pacific/Auckland` before
Node starts, silently (`TZ=UTC` gets through). Check the zone Node has with
`node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"`.

### Folder structure

```
src/app/              Next.js routes. Thin: parse input, call a module, render.
  (auth)/             Login and the clinic picker: the pages a user sees before they have a clinic.
  (staff)/            The staff app. Its layout and every page start from currentStaff().
  _lib/               Request-edge helpers: who is signed in; the action wrappers; the auth client.
  api/auth/           The auth library's routes (sign-in, sign-out, get-session). No code of ours.
  globals.css         The design tokens (Tailwind's theme) and the page's base styles.
src/proxy.ts          Moves the session forward and renews its cookie (D-067); no valid session → /login,
                      except a server action: its wrapper sends the person there (D-074).
                      Not the permission check: pages and actions still call currentStaff().
                      It skips paths that start with `login` or hold a dot: a staff path never does.
src/modules/<name>/   All business logic. index.ts = public API, schema.ts = its tables.
src/db/               Connection pool, withTenant, migrations/, migrate and reset scripts, the seed (seed/).
src/i18n/             next-intl's request configuration and the message file, en.json.
src/lib/              Small shared pieces: clock, ids, logger, personal-fields.
src/ui/               shadcn/ui components restyled to the tokens, the logo, the fonts, cn().
tests/integration/    Tests against real PostgreSQL, including the tenant meta-test.
eslint-rules/         Our lint rules (module boundaries, server actions, database access, forms) and
                      the tests of all architecture rules.
```

Create a folder only when it has content. Coming later: `tests/e2e` (E00-T06b), `src/worker` (E00-T07).

### Module rules (lint enforces them; `eslint-rules/architecture.test.ts` proves it)

No lint comment switches a rule off, anywhere in the repository (`noInlineConfig`, D-077, D-084).
The lint guards are finished (D-087): a new way past one is a review check, weighed `none`, not a
task, unless product code on `main` would hit it today.

1. A module's tables are private. Other modules call its functions, never query its tables.
2. Import another module only through its `index.ts`: `@/modules/patients`. One exception: a
   `schema.ts` may import another module's `schema.ts` to declare foreign keys (D-058).
3. No Next.js or React in `src/modules`, so the worker and tests can use every module.
4. No reading the clock in `src/modules` (`Date.now()`, `new Date()`, `DateTime.now()`…).
   Take `now: Date` as a parameter, or a `Clock` from `src/lib/clock.ts`; tests use `fakeClock`.
5. A server action is `export const name = staffAction(…)` (or `staffRead`, `userAction`) in a
   `'use server'` `.ts` file in `src/app` that exports nothing else but types; a route handler needs
   its reason in `ROUTE_HANDLERS` (`eslint-rules/server-actions.mjs`, D-071, D-073, D-077, D-084).
6. `@/db/client` only in `src/db/` and `src/modules/auth/` (the auth library's global tables and
   `clinics_for_user()`, D-062), `withTenant` also in `src/app/_lib/actions.ts`, database drivers
   only in `src/db/`; none of them is passed on from there. `import type { TenantTransaction }`
   anywhere; tests are exempt (`eslint-rules/database-access.mjs`, D-071, D-077, D-084).
7. Type-aware, in `src/`: every promise is awaited (Drizzle queries too) and only Errors are thrown
   or rejected (a refusal is returned, never thrown). In `.ts` and `.mts` files a statement that
   only hangs `.catch(…)`, `.then(ok, fail)` or `.finally(…)` on a promise is reported; in a `.tsx`
   file it is not, so reviewers check where a handler is written (D-086). `src/` holds no `.js`,
   `.jsx`, `.mjs`, `.cjs` or `.cts` files: a test fails (R-32, D-073, D-074, D-077, D-084).

### Code conventions

- TypeScript strict, plus `noUncheckedIndexedAccess`. `@/…` imports for `src/`; `import type` for types.
- Files `kebab-case.ts`. Tables and columns `snake_case`, tables plural. TypeScript `camelCase`.
- Ids: `newId()` from `src/lib/ids.ts` (UUID v7). Moments `timestamptz`, calendar dates `date`.
  `updated_at` is set from the passed-in `now` when a row changes.
- Database: only inside `withTenant(clinicId, async (tx) => …)` from `src/db/tenant.ts`, opened
  once at the edge (action wrapper, job handler). Module functions take that `tx` as a parameter;
  a `withTenant` inside another is refused with an error (D-060). Waiting for a pooled connection
  or a lock fails after 5 s. Never set `app.clinic_id`.
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
  Other pages use `currentStaff()` (`src/app/_lib/auth.ts`); a page outside `(staff)` starts from
  `currentStaff()` or `requireUser()`, or is public on purpose and says so in a comment, as the login
  page does: the proxy lets a signed-out POST that looks like a server action through (D-074, D-075).
  Login and logout are the auth library's routes (`authClient`). Never read the session cookie or a
  password (D-063).
- Texts: every visible string is in the message file, `src/i18n/en.json`, read with next-intl
  (`useTranslations`, or `getTranslations` in an async page; a page's title through
  `generateMetadata`). Lint fails on text written in JSX in `src/app` and `src/ui`. Text in
  `aria-label`, `placeholder`, `title` or `alt`, in a page's `metadata`, or reached through a
  variable or a condition (`{c ? 'a' : 'b'}`) is a review check. `jsx-a11y`'s rules run there too,
  but take a `<label>` whose text is `{t(…)}` for one holding a control: that a label names its
  control (`htmlFor`, the control's `id`) is a review check. A module gives a key (a role), never
  the text: it cannot import next-intl (module rule 3).
- Styles: a component takes colours, fonts and radii only from the theme in `src/app/globals.css`
  (`bg-primary`, `font-serif`, `rounded-card`); Tailwind's own palette, font families, text sizes
  and radii are switched off. A token the design reference lacks is added there, derived from one it
  has, and named in the handoff note. Components are shadcn/ui's, copied into `src/ui/` and restyled.
- Forms: a form posts to a URL (`method="post"` and `action` written out, after any spread) or takes
  a function as its action, and so does a button's or input's `formAction`. Never only `onSubmit`:
  whenever the handler does not run, the browser sends a GET with every field in the URL (D-076). A
  component that spreads its props onto a button, an input or another component types them without
  `formAction` and `formMethod`; `next/form` is not used. Lint (`chairside/forms-post`) checks every
  form, button, input and component in `src/`; its test lists the shapes (D-080, D-081, D-084).
- Logs: `logger` from `src/lib/logger.ts`, ids and codes only. Errors and values go in fields or
  arguments, never inside the message text: the logger cannot clean text. It drops the fields
  listed in `src/lib/personal-fields.ts` as a safety net, not as permission to log personal data.
  Errors leave `withTenant` without query values (D-070): keep a caught error as `cause`, never
  copy its message into a new error or a string.
- Files Node runs directly (`src/db/migrate.ts`, `src/db/reset.ts`): import only packages and
  relative `.ts` files, never `@/`. The seed (`src/db/seed/`) runs with tsx and may import `@/`
  (D-090).
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

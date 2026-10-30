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
| `pnpm check` | **Everything a task must pass:** format, lint, types, unit and integration tests; before it hands off, the builder also runs `pnpm build`, then `pnpm test:e2e` in all three browsers (CI runs both, D-100). Needs the database: `docker compose up -d --wait`. |
| `pnpm dev` | The app at http://localhost:3000. |
| `pnpm test` | Unit tests (`src/**/*.test.ts`, `eslint-rules/`). No database. |
| `pnpm test:integration` | Tests against real PostgreSQL (`tests/integration/`). First rebuilds the separate `<db>_test` database from the migrations. |
| `pnpm test:e2e` | The end-to-end journeys and checks (`tests/e2e/`, Playwright) in Chromium, Firefox and WebKit; one browser: `--project=chromium`. Runs the production build of `pnpm build` and `next dev`, both on the separate `<db>_e2e` database, rebuilt and seeded each run. How to run them: "CI" below. |
| `pnpm exec vitest run <file>` | One test file. |
| `pnpm lint` · `pnpm typecheck` | ESLint (a warning fails too) · `next typegen` + `tsc`. |
| `pnpm format` · `pnpm format:check` | Prettier: fix · check only. Markdown and `docs/` are not formatted. |
| `pnpm db:reset` | Rebuild the local database from nothing: roles, database, every migration, then the seed. Refuses any non-local host, and URLs that do not all name the same host and port. |
| `pnpm db:seed` | Add the seed (`src/db/seed/`): two invented clinics, a login for every role and a week of appointments, listed in `README.md`. The same guard as `db:reset`; a second run adds nothing. |
| `pnpm clinic:create --name … --owner-email … --owner-name …` | The operator's script for a new clinic and its first owner (`src/db/clinic-create.ts`, D-101): writes as the app role, prints the one-time link where the owner chooses a password. On this machine; a database elsewhere only with `--remote-database`, on a host in the app's image. `docs/runbook.md`. |
| `pnpm worker` | The worker (`src/worker/index.ts`, E00-T07b): the job queue (pg-boss) and a heartbeat a minute, against the database in `.env`; Ctrl+C stops it. Its log lines and its image command: `docs/runbook.md`. |
| `pnpm db:migrate` | Apply pending migrations as the migration role. |
| `pnpm db:generate --name <what>` | Generate a migration from changed `schema.ts` files. |
| `pnpm build` · `pnpm start` | Production build · run it. |

Every script must work on Windows (the owner's OS): no bash-only syntax in `package.json`.

### CI

`.github/workflows/ci.yml` (D-075) runs the `pnpm check` steps, `pnpm build` and `pnpm audit`, each
once, in UTC (D-099), and after the build the end-to-end journeys: in Chromium, and in Chromium,
Firefox and WebKit on the Monday run (D-100). It runs on every pull request to `main`, every push to
`main` and every Monday. A pull request that changes only files under `docs/`, Markdown files under
`.claude/`, `CLAUDE.md` or `README.md` gets no run; the architect merges its own such planning pull
request (D-087). The owner merges every other pull request, only on green (R-34). Each level on your
machine, with the database up:

| Level | Command |
|---|---|
| The `pnpm check` steps | `pnpm check`, or one of its commands |
| The build | `pnpm build` |
| The end-to-end journeys | `pnpm build`, then `pnpm test:e2e`: all three browsers, which the builder runs before every hand-off (CI: Chromium; the Monday run: all three) |
| The dependency check | `pnpm audit --prod` (must pass) · `pnpm audit` (everything; read it). Never `--fix`, `--ignore` or `--ignore-unfixable`: they write `pnpm-workspace.yaml` |

The journeys on Windows (and anywhere): the browsers once, `pnpm exec playwright install chromium
firefox webkit` (about 500 MB, again after a Playwright upgrade); then, with the database up,
`pnpm build` (the journeys run the build in `.next`, so build again after a change) and
`pnpm test:e2e`. It starts `next start` on port 3100 and `next dev` on port 3101 (a second checkout
on the same machine sets `E2E_APP_PORT` and `E2E_DEV_PORT`, `README.md`), both on
`<db>_e2e`, never the development database; stop `pnpm dev` first (Next.js runs one `next dev` per
folder). A failed journey keeps its trace: `pnpm exec playwright show-trace test-results/<test>/trace.zip`.

To run something in another zone (a server in `Pacific/Auckland`), not Git Bash (the agents' Bash
tool): it drops `TZ=Pacific/Auckland` before Node starts, silently (`TZ=UTC` gets through);
PowerShell's `$env:TZ` works. Check the zone Node has with
`node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"`.

### Folder structure

```
src/app/              Next.js routes. Thin: parse input, call a module, render.
  (auth)/             Login and the clinic picker: the pages a user sees before they have a clinic.
  (staff)/            The staff app. Its layout and every page start from currentStaff().
  _lib/               Request-edge helpers: who is signed in; the action wrappers, the staff form that
                      calls them and the frame's clinic it sends (D-092); the auth client.
  api/auth/           The auth library's routes (sign-in, sign-out, get-session). No code of ours.
  api/health/         The host's check of the web (D-102): 200 or 503, no session, never the worker.
  globals.css         The design tokens (Tailwind's theme) and the page's base styles.
src/proxy.ts          Moves the session forward and renews its cookie (D-067); no valid session → /login,
                      except a server action: its wrapper sends the person there (D-074).
                      Not the permission check: pages and actions still call currentStaff().
                      It skips paths that start with `login` or hold a dot, and `/api/health` itself:
                      a staff path never is one.
src/modules/<name>/   All business logic. index.ts = public API, schema.ts = its tables.
src/db/               Connection pool, withTenant, migrations/, migrate and reset scripts, the seed (seed/),
                      `pnpm clinic:create` (clinic-create.ts), the health check's query (health.ts),
                      the job queue (queue.ts: pg-boss stays in it and is never passed on, D-104).
src/worker/           The worker's entry point (index.ts, D-103): the queue and its heartbeat, the start
                      refusals, the stop on SIGTERM or SIGINT. Job handlers join it with E02.
src/i18n/             next-intl's request configuration, the locale (locale.ts: English, the 24-hour
                      clock) and the message file, en.json.
src/lib/              Small shared pieces: clock, ids, logger, personal-fields, calendar-day (a day
                      `YYYY-MM-DD`: isCalendarDay, dayInZone, addDays, isoWeekday; D-108).
src/ui/               shadcn/ui components restyled to the tokens, the logo, the fonts, cn().
tests/integration/    Tests against real PostgreSQL, including the tenant meta-test.
tests/e2e/            End-to-end journeys and checks in real browsers (Playwright, playwright.config.ts):
                      J1, the accessibility check, the D-093 check (E00-T06b), the setup link's page
                      (E00-T05b), the calendar's filter, reading on use and "now" line (E01-T04b),
                      the booking drawer (E01-T05a), a double click on a closed day's Remove (E01-T08c),
                      the Treatment types tab: add, then book with it, and a double click on Make inactive
                      (E01-T09a), the Providers tab: add with its colour, then book with it (E01-T09b);
                      change one, the linked one's kind locked, make inactive and active again, and a
                      double click on Make inactive (E01-T09d); move one up and down in the order and
                      a double click on Up (E01-T09c); add a weekly break in a provider's Breaks dialog,
                      see it hatched and warned about, remove it, and a double click on a break's Remove
                      (E01-T09e); a click on a patient list row opens the profile and is one
                      `patient.viewed` row, an unknown address is a 404 (E01-T03a); an edit saved and the same form
                      refused as changing nothing, an archive refused with a visit ahead and saved once it is
                      cancelled, and a double click on Save changes saves once (E01-T03b); the appointment drawer: a
                      block opens it, the six status changes, a refusal, a visit that leaves the day, a double click
                      whose second press lands on a status button, the keyboard and the focus back, the profile
                      link's one `patient.viewed` row (E01-T06b).
eslint-rules/         Our lint rules (module boundaries, server actions, database access, forms) and
                      the tests of all architecture rules.
Dockerfile            The one image staging and production run (D-007, D-103): the web by default,
                      a script with `node --import tsx <file>`; no `.env`, no secret (.dockerignore).
                      How to build and run it: `docs/runbook.md`.
```

Create a folder only when it has content.

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
   anywhere; tests are exempt (`eslint-rules/database-access.mjs`, D-071, D-077, D-084). The seed
   (`src/db/seed/`) connects as the migration role, and `src/db/clinic-create.ts` opens `withTenant`
   for a new clinic (D-101), and lint does not stop an import of either: reviewers check that only
   `src/db/` and tests import them.
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
  browser calls `action(clinicId, input)` with its frame's clinic (D-069) and gets `{ ok: true,
  value }` or `{ ok: false, error: { code } }`; `return refuse('code')` says no, a throw is `internal`:
  ```ts
  export const renamePatient = staffAction( // 'use server' file; patients.rename = a module function
    { permission: 'patients.manage', input: z.object({ patientId: z.uuid(), name: z.string() }),
      audit: { action: 'patient.renamed', entityType: 'patient', entityId: ({ input }) => input.patientId } },
    async ({ input, tx, now }) => (await patients.rename(tx, input, now)) ?? refuse('not_found'));
  ```
  A staff form is `StaffForm` with a `StaffField` per field (`src/app/_lib/staff-form.tsx`, D-092).
  It sends the clinic its frame names (the staff layout's `FrameClinic`), never one a page passes,
  and shows the answer one way: `invalid_input` at the fields, `forbidden`, `clinic_changed` with a
  reload, the general failure (a call that rejects too), a toast when done; its button is disabled
  while it runs. A check the input alone settles is the schema's, shown at its field; one that needs
  the clinic's settings or rows (a phone read with the clinic's country, a day already closed) is the
  handler's `refuse('code')`, shown above the button with a text (`refusals`) that names the field
  (D-098). `StaffForm`'s form is `autocomplete="off"`: it keeps nothing in the browser, so no reload or
  Back brings a field back, under another clinic either (D-093); no field in it sets an
  `autocomplete` of its own but `off` (WebKit gives such a field back), and a field outside a staff
  form that takes patient details (a search box) is `autoComplete="off"` itself, its words never in
  the page's address (D-095). The select is the browser's own (`NativeSelect`); a checkbox's or a
  switch's `StaffField` is `orientation="horizontal"`, its label beside it. Every staff page renders
  `<PageClinic clinicId={staff.clinic.clinicId} />`. Review checks, which no lint rule or test
  sees: any other button inside a staff form is `type="button"`
  (else it sends the form before the script runs, past the guard); only the staff layout renders
  `FrameClinic` and only `StaffForm` calls `sendForm`; an action called outside a form (a status
  button) takes its clinic from `useFrameClinic()`, never from the page (D-092); a client component
  that keeps state made from its page's rows is keyed by the page's clinic
  (`key={staff.clinic.clinicId}`, as the patient list is), as React keeps a component's state when
  its page renders in place for another clinic (D-098). The
  form sits in a client component that the page renders, as `DemoForm` does
  (`src/app/(staff)/dev/components/demo-form.tsx`): a page can hand a client component a server
  action, never another function such as `render` or `onDone` (React stops the render):
  ```tsx
  <StaffForm action={renamePatient} doneMessage={t('renamed')}
    submitLabel={t('rename')} pendingLabel={t('renaming')}>
    <input type="hidden" name="patientId" value={patient.id} />
    <StaffField name="name" label={t('name')} render={(field) => <Input {...field} />} />
  </StaffForm>
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
- Dates and times: a moment (`timestamptz`) is shown through next-intl's formatter (`useFormatter`,
  `getFormatter`), which carries the clinic's zone (`src/i18n/request.ts`, D-015), never through
  `toLocaleString()` or an `Intl.DateTimeFormat` without a zone. A calendar date (`date`: a date of
  birth, a closed day) is no moment: it stays a `YYYY-MM-DD` string until shown, then is formatted
  from `new Date('YYYY-MM-DD')` with `timeZone: 'UTC'`, and tested in a zone behind UTC, where the
  day before would show (D-098). A test of such code names the zones it runs in and never relies on
  the computer's: CI runs once, in UTC (D-099). Every time of day is in the 24-hour clock ("09:00",
  "14:30"; D-049), set once by the locale `en-u-hc-h23` (`src/i18n/locale.ts`, E01-T04b) for every
  page and client component, never at a call; dates stay English ("Monday, October 12"). A test that
  renders a time gives next-intl's provider `LOCALE` from there.
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
  copy its message into a new error or a string. A Zod transform or refinement reports with
  `ctx.addIssue`, never by throwing: a thrown error is logged with its message, and `JSON.parse`,
  `BigInt()` and `new URL()` put their input in theirs.
- Files Node runs directly (`src/db/migrate.ts`, `src/db/reset.ts`): import only packages and
  relative `.ts` files, never `@/`. The seed (`src/db/seed/`), `src/db/clinic-create.ts` and the
  worker (`src/worker/index.ts`) run with tsx and may import `@/` (D-090, D-101); tsx is a production
  dependency, so the image runs such a script too, as `node --import tsx <file>` (D-103).
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

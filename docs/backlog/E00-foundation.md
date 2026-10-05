# E00 · Foundation (milestone M0)

**Outcome:** a real project exists. You can log in to an empty clinic on a staging URL, two
clinics cannot see each other's data, and every change is checked automatically.

**Why first:** everything else stands on tenant isolation, login and the action wrapper.
Getting them right once, with tests, is cheaper than fixing them under features.

Order: T01 → T02 → T03 → T08 → T06a → T09 → T10 → (T04, T05 in any order) → T06b → T07. T08 is
the second half of T03 (split in D-071), so it sits right after T03 in this file. T06 is split in
two (D-075): CI (T06a) comes first, Playwright and journey J1 (T06b) after T04 and T05. T09 and T10
come from E00-T08's review and test (D-076, D-077). The tasks sit in this file in that order.

---

### E00-T01 · Create the project: skeleton, conventions, database foundation

- **Role:** builder · **Risk:** critical · **Depends on:** none
- **Read:** `overview` (all) · `data-model` (Conventions; section 1: `clinics`, `audit_log`) ·
  `security` (Part 1, sections 1, 6, 7) · `docs/log/decisions.md` (Part 1 only) ·
  `docs/process/workflow.md` (Git)

**Why.** Today the product exists only as two HTML design files and these documents. This task
turns it into a real, runnable project with the safety foundation every later task relies on.

**The design files.** `Chairside Demo v3 (offline).html` and `Architecture Explorer (1).html`
are the **design reference**: how screens look and behave. They are **not code to copy**:
they are prototype bundles with inline styles, fake data and a custom runtime. Do not port
their markup or logic. No screens are built in this task.

**Do.**
1. **Repository.** `git init`, `.gitignore`, first commit of the existing docs. Move the two
   original HTML files to `design/originals/` and update the two places that mention their
   location (`CLAUDE.md`, `docs/product/design-reference.md`).
2. **Scaffold.** One Next.js app (App Router, TypeScript strict, `src/` layout) with pnpm on
   Node 24. One package, no monorepo. A placeholder home page that says the app is running.
3. **Structure.** Create the folder layout from `overview.md` ("Folder structure"). Only
   create folders that have content now; do not fill modules with empty stubs.
4. **Tooling.** ESLint, Prettier, Vitest. Lint rules that enforce the architecture:
   (a) no `Date.now()` / `new Date()` inside `src/modules`;
   (b) modules import each other only through `index.ts`;
   (c) no Next.js or React imports inside `src/modules`.
   Scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `test:integration`, `db:migrate`,
   `db:reset`, and **`check`** (runs everything a task must pass). The owner develops on
   Windows 11: every script must work there (no bash-only commands in `package.json`).
5. **Local database.** Docker Compose with PostgreSQL. `.env.example` with names, no values
   that are secrets. Two database roles: one that runs migrations, one the app connects as.
   The app role cannot bypass Row-Level Security and cannot change schema.
6. **Migrations.** Drizzle with SQL migrations. First migration: required extensions,
   `clinics`, `audit_log`, their Row-Level Security policies, and grants so the app role can
   insert and read `audit_log` but never update or delete it.
7. **Tenant helper.** `withTenant(clinicId, fn)`: opens a transaction, sets the clinic for
   the policies, runs `fn`. The only way application code reaches tenant tables.
8. **Small shared pieces.** A `Clock` type and real/fake implementations; a logger with a
   redaction list for personal fields; UUID v7 ids.
9. **Tests.**
   - Meta-test: every table has `clinic_id`, Row-Level Security enabled and a policy, or is on
     an explicit allow-list in one file.
   - Isolation: inside clinic A's context, clinic B's rows are invisible and cannot be
     changed; without a context, no rows are returned.
   - The app role cannot update or delete `audit_log`.
10. **`CLAUDE.md`.** Replace the "Technical conventions" placeholder with the real thing:
    commands, folder structure, module rules, naming, **"how to add a table" checklist**,
    how to write a migration, how to run each kind of test, what `check` covers. Keep the
    whole file under about 150 lines. Keep the existing sections above it.
11. **`README.md`** for humans: prerequisites and how to run the project locally from zero.
12. **Agent guard.** Add project settings so agent sessions cannot read `.env` files.

**Out of scope.** Login, users, memberships (T02). Any screen or component (T04). Any domain
table (patients, appointments…). CI (T06). Deployment (T07). The worker (T07).

**Acceptance.**
- [ ] From a fresh clone, following only `README.md`, the app starts and shows the placeholder page.
- [ ] `pnpm check` passes on Windows.
- [ ] `pnpm db:reset` builds the database from nothing using migrations only.
- [ ] The meta-test fails when a table without `clinic_id` or without a policy is added
      (shown once in the handoff note, then removed).
- [ ] Isolation tests pass against real PostgreSQL: cross-clinic read and write are impossible
      through `withTenant`; a query without tenant context returns nothing.
- [ ] A test proves the app role cannot `UPDATE` or `DELETE` `audit_log`.
- [ ] Lint fails on `Date.now()` in `src/modules` and on a deep import into another module
      (shown in the handoff note).
- [ ] The logger drops the listed personal fields (unit test with marker values).
- [ ] `CLAUDE.md` contains the conventions and the "how to add a table" checklist.
- [ ] No feature code, no screens beyond the placeholder, no copied demo markup.
- [ ] Original HTML files are in `design/originals/`; references updated.

---

### E00-T02 · Login, sessions and clinic membership

- **Role:** builder · **Risk:** critical · **Depends on:** E00-T01
- **Read:** `data-model` (section 1) · `security` (Part 1, section 2) · `scope` (Navigation and roles) · D-006, D-021

**Why.** Nothing may be visible without knowing who the user is and which clinic they act for.

**Do.**
- Add Better Auth with email + password, sessions in our database, secure cookies.
- Tables: auth tables (global, on the meta-test allow-list with a comment why) and `memberships`.
- Resolve "current clinic" for a session: the user's active membership. If a user has several,
  a simple clinic picker after login.
- Roles and the permission table as one typed constant; a pure `can(role, extras, permission)` function.
- Login page and logout, using plain styling for now (T04 restyles).
- Session ends after 30 minutes of inactivity. Login attempts rate-limited.
- A protected `(staff)` layout: no session → redirect to login.

**Out of scope.** 2FA, invites, password reset emails (E04). Staff management screen (E04).

**Acceptance.**
- [ ] A seeded user can log in and reaches a protected placeholder page; logout ends the session.
- [ ] Wrong password is refused with a message that does not reveal whether the email exists.
- [ ] A disabled membership cannot enter the clinic.
- [ ] `can()` is covered by a table-driven test for every role × permission in `scope-v1.md`.
- [ ] A user with memberships in two clinics only ever sees data of the clinic they picked
      (integration test).
- [ ] Repeated failed logins are rate-limited (test).
- [ ] No password, token or session id appears in logs (test with marker values).

---

### E00-T03 · Action wrappers, permission checks and audit log

- **Role:** builder · **Risk:** critical · **Depends on:** E00-T02
- **Read:** `overview` (How a staff action flows) · `security` (Part 1, sections 1, 2, 6, 10) ·
  `data-model` (`audit_log`) · D-062, D-066, D-068, D-069, D-070, D-071 · the architect section of
  `handoffs/E00-T03.md`

**Why.** One wrapper that every staff action passes through is what makes "permissions are
always checked" and "everything is audited" true by construction instead of by discipline. It is
also where an action learns which clinic it runs in, and the last place an error passes before a
framework prints it.

**Do.**
- **`staffAction({ permission, input, audit }, handler)`** in `src/app/_lib/`, for every server
  action that changes data. In this order, stopping at the first step that fails:
  1. *Who:* `currentStaff()`. No session → the login page; clinic not settled → the picker, as
     pages do today.
  2. *Which clinic (D-069):* the call carries the id of the clinic its page was shown for. When it
     differs from the clinic `currentStaff()` resolved, or is missing, refuse with
     `clinic_changed`.
  3. *Allowed:* `can(role, extras, permission)`, else `forbidden`.
  4. *Valid:* parse the input with Zod (D-068), else `invalid_input` with field paths and issue
     codes, never the values sent.
  5. *Do it:* one `withTenant` for the resolved clinic. The handler gets the parsed input, the
     transaction, the staff member and `now` (the clock read once, here at the edge).
  6. *Audit:* exactly one row through `audit.record()`, in the same transaction, from the action's
     `audit` declaration (action name, entity type and id, optional metadata).
  7. *Answer:* a typed result, or a typed error code.
- **Handler refusals.** A handler can refuse with its own typed error (for example `not_found`):
  nothing it did is kept, no audit row is written, and the code goes back to the caller.
- **Unexpected errors.** Anything else the handler or the database throws is rolled back, logged
  once through `logger` (ids, the error as `err`), and answered as `internal` with no detail. Keep
  a caught error as `cause`; never copy `err.message` into a new error or a string. Do not rely on
  seeing the handler's first error: when the rollback fails, Drizzle throws the rollback's error
  instead (board, Discovered, E00-T01).
- **A read helper** for pages and read-only actions: the same steps, but no audit row unless the
  read declares a patient-record view, which then writes one (security §10). Step 2 applies when it
  is called as an action from the browser (polling, a drawer that loads): it then carries the
  clinic id like `staffAction`. A page reading while it renders on the server skips step 2 (D-069).
- **Every wrapper call names its permission**, or says explicitly that every active member may (a
  read that every role has). There is no default.
- **`userAction({ input }, handler)`** for a signed-in person before a clinic is chosen: session →
  Zod → handler. No clinic, no transaction, no audit row. Move `chooseClinic` onto it, parsing its
  form field as a UUID.
- **`audit.record(tx, entry)`** in `src/modules/audit`, public through its `index.ts`: one
  `audit_log` row with the transaction's clinic, `at` = the passed-in now, actor type and id,
  action, entity type and id, metadata. It throws (so the action rolls back) when a metadata key
  at any depth is a personal field (`isPersonalField()`, `src/lib/personal-fields.ts`). Metadata
  holds ids, codes and field names only.
- **Query errors without values (D-070).** Every error that leaves `withTenant` (from the work
  inside, the commit or the rollback) and every error from `clinicsForUser()` is the copy
  `withoutQueryValues()` makes, also when the query error sits deeper in the `cause` chain of
  another error. Code, table and constraint names stay, so the wrapper can still tell a
  constraint violation apart.
- **Add `zod`** as a dependency at the version the lockfile already holds (D-068).
- **`CLAUDE.md`:** the pattern with one short example, and the three wrappers in "Who is signed
  in". Keep the file near its current length.

**Out of scope.** The lint rules that make the wrappers the only way in, and the login audit rows:
E00-T08. How a form shows each typed error: E00-T04. The audit viewer (E07). Patient-link actions
(E02 builds its own wrapper). Real screens and real actions: tests use actions made for the tests.

**Acceptance.**
- [ ] An action without the needed permission returns `forbidden`; the handler does not run and
      nothing is written.
- [ ] Invalid input returns `invalid_input` with paths and codes before the handler runs; neither
      the answer nor the log holds a value that was sent (test with marker values).
- [ ] Two clinics: an action carrying clinic A's id while the request resolves to clinic B (B picked
      in another tab, or A's membership disabled since the page was shown) returns `clinic_changed`
      and writes nothing in either clinic. A missing id is refused the same way. The matching id runs.
- [ ] If the handler throws, neither its changes nor the audit row are saved (one transaction), and
      the answer is `internal` with no detail.
- [ ] A handler's own refusal comes back as its code, with nothing saved.
- [ ] A successful action writes exactly one audit row with actor, action and entity, and `at`
      equal to the action's now.
- [ ] A read that declares a patient-record view writes one audit row; other reads write none.
- [ ] `audit.record()` refuses metadata with a personal field name at any depth, and the action
      rolls back (test).
- [ ] A failed query inside `withTenant` and inside `clinicsForUser()` (a constraint violation, a
      value of the wrong type) throws an error whose message, stack and cause chain, as
      `util.inspect` prints them, hold none of the values sent (marker values), and which keeps the
      PostgreSQL code (and the constraint name, where there is one). The same when the handler wraps
      that error as the `cause` of its own.
- [ ] `chooseClinic` runs through `userAction`: a malformed id is refused before any lookup; a
      clinic without an active membership still goes back to the picker with no cookie; the
      person's own clinic still sets the cookie.
- [ ] `pnpm check` passes.

---

### E00-T08 · Guards around the action wrappers, and the login audit

- **Role:** builder · **Risk:** critical · **Depends on:** E00-T03
- **Read:** `security` (Part 1, sections 1, 2, 6, 10) · `docs/log/risks.md` (R-32) · D-062, D-064
  (point 4), D-067, D-071, D-072, D-073 · the architect section of `handoffs/E00-T08.md` (what is
  already there) · in `handoffs/E00-T03.md`, the builder's "For E00-T08"

**Why.** E00-T03 builds the wrappers. This task makes them the only way in, so a forgotten
wrapper, a stray database handle or a query that is not awaited fails `pnpm lint` instead of
waiting for a reviewer to notice. It also closes two gaps E00-T03's review found: a
`staffRead(…).forPage`, which skips the clinic check, exported as an action; and a thrown value
that is not an Error, inside which the query-error cleaning does not look. And it writes the login
rows the audit log promises (security §10), now that `audit.record()` exists. Split from E00-T03
to keep each diff readable (D-071).

**Do.**
- **Every server action is made by a wrapper.** A lint rule, with cases in
  `eslint-rules/architecture.test.ts`. In a `'use server'` file under `src/app`, in every route
  group, the only value export allowed is `export const name = staffAction(…)`, `staffRead(…)`
  or `userAction(…)`, called directly, with the wrapper imported from `src/app/_lib/actions.ts`
  (D-073). Every other export is reported, among them: `staffRead(…).forPage` (it skips the
  clinic check, D-069, D-072), the `.forPage` of a read made elsewhere in the file or imported, an
  `export async function`, `export default`, a re-export (`export { x }`, `export { x } from`,
  `export *`), and a call to a local function that happens to be named like a wrapper. Type-only
  exports pass. An inline `'use server'` function anywhere in `src/` is reported, and so is a
  `'use server'` file in `src/` outside `src/app` (D-073). Route handlers under `src/app/api/` other than `api/auth/` must
  be on a list in the same place, each with a reason (none today). Later wrappers (E02's patient
  links, E03's webhooks) are added to that list in their tasks.
- **Who may reach the database (D-062, D-071).** Lint: `@/db/client`, by any path, may be imported
  only in `src/db/` and `src/modules/auth/`. A value import of `withTenant` only in the wrappers'
  file, `src/db/` and `src/modules/auth/` (the login hook below). A type-only import of
  `TenantTransaction` is allowed everywhere. Tests are exempt.
- **Un-awaited promises and thrown non-errors (R-32, D-073).** Type-aware linting for `src/`,
  with `@typescript-eslint/no-floating-promises`, `@typescript-eslint/no-misused-promises` and
  `@typescript-eslint/only-throw-error` (its default options: rethrowing a caught error, and
  throwing a value typed `unknown` or `any`, pass). So a query that is not awaited
  (`items.forEach(async …)`, a bare `tx.insert(…)`) fails lint, and so does a thrown value that is
  not an Error (`throw { cause: e }`, `throw refuse('not_found')`), inside which
  `withoutQueryValues()` would not find a failed query's values. Fix what they find in existing
  code without changing behaviour, each fix listed in the handoff note, with `pnpm lint`'s time
  before and after. Every case already in `architecture.test.ts` keeps passing unchanged: those
  snippets are linted at paths that do not exist on disk, which type-aware linting does not
  accept as it is (architect section of the handoff note).
- **Say which shapes are cleaned.** The comment on `withoutQueryValues()`
  (`src/lib/query-errors.ts`) names where it looks for a query error (the `cause` chain, an
  AggregateError's `errors`, own properties holding an error or a list of errors) and where it
  does not (a plain object or a Map holding one, a thrown value that is not an Error). Comment
  only; the function does not change.
- **Login audit rows (D-064, point 4).** When the auth library creates a session
  (`databaseHooks.session.create.after`), write `user.logged_in` in every clinic where the person
  has an active membership: one `withTenant` per clinic, one after another (never nested), `at` =
  the session's `createdAt`, actor and entity = the user. No address, user agent, email or token
  in the row. A person with no active membership gets no row. If a row cannot be written, the
  sign-in fails: no session cookie reaches the browser, and the failure is logged with ids only
  (D-071).
- **An action sent after the session ended.** Today the proxy answers it with a 307, which the
  browser follows as a POST to `/login`, so the wrapper's own redirect is never reached (board,
  Discovered, E00-T02 delta review). Should: nothing runs, and the person ends on the login page,
  not on an error. How is the builder's choice; for example, the proxy lets a server-action request
  without a valid session through to the wrapper, whose `currentStaff()` redirects. The proxy stays
  the one place the session is moved forward (D-067).
- **Docs:** `CLAUDE.md` module rules name the new lint rules (the wrapper rule, the database
  imports, and the three type-aware rules); R-32 in `docs/log/risks.md` says what now covers it.

**Out of scope.** Failed logins in the audit log (D-064: not audited). The audit viewer (E07).
Narrowing the proxy matcher for patient pages (E02-T08). A `tx` that refuses work after its
transaction ended (R-32's other option; the lint rules are the chosen one). A `READ ONLY`
transaction for `staffRead` (owner, 2026-10-04: later; D-073). Walking more shapes in
`withoutQueryValues()`: only its comment changes. Treating a thrown refusal like a returned one,
and `refuse()`'s comment (board, Discovered, E00-T03 review suggestion 2).

**Acceptance.**
- [ ] Lint fails on a server action not made by a wrapper, in `(staff)`, in `(auth)` and as an
      inline `'use server'` function, on a `'use server'` file in `src/` outside `src/app`, and on
      an unlisted route handler under `src/app/api/` (cases in `architecture.test.ts`). The
      existing actions pass.
- [ ] In a `'use server'` file, lint fails on `export const x = staffRead(…).forPage`, on the
      `.forPage` of a read made earlier in the file or imported, on a re-export, on an
      `export async function`, and on a call to a local function named `staffAction`;
      `export const x = staffAction(…)`, `staffRead(…)` and `userAction(…)` with the wrapper
      imported from `src/app/_lib/actions.ts` pass, and so does a type-only export (cases in
      `architecture.test.ts`).
- [ ] Lint fails on `@/db/client` imported from a page, an action file and a module other than
      `auth`, and on a value import of `withTenant` outside the allowed files. A type-only import of
      `TenantTransaction` in a module passes.
- [ ] Lint fails on `items.forEach(async (i) => tx.insert(…))`, on an un-awaited `tx.insert(…)`
      inside `withTenant`, and on `throw { cause: e }` and `throw refuse('not_found')`;
      `throw new Error(…)` and rethrowing a caught error pass (cases in `architecture.test.ts`).
      Every case that was in `architecture.test.ts` before this task passes unchanged.
- [ ] The comment on `withoutQueryValues()` names the shapes it cleans and the ones it does not
      (the reviewer checks it).
- [ ] A sign-in by a person with active memberships in two clinics and a disabled one in a third
      writes exactly one `user.logged_in` row in each of the two, with `at` equal to the session's
      start, and none in the third. No row holds an address, user agent, email or token
      (integration test through the library's handler).
- [ ] When a login row cannot be written (a grant taken from the app role for one request, as in
      `auth-attacks.test.ts`), the sign-in answers an error and sets no session cookie, and the
      output holds no token, email or query value.
- [ ] A server action sent with an ended session runs nothing and the person ends on the login
      page (test through `proxy()` and the wrapper; the tester checks it once in a real browser).
- [ ] `pnpm check` passes.

---

### E00-T06a · CI: every pull request and `main` checked on GitHub

- **Role:** builder · **Risk:** normal · **Depends on:** E00-T08
- **Read:** `test-strategy` (The levels; Message timing: "Hidden local time") ·
  `docs/process/workflow.md` (Definition of Done; Git; When the pipeline stops for the owner) ·
  `security` (Part 1, sections 7 and 8) · `README.md` (Run it locally, from zero) ·
  `.claude/skills/pipeline/SKILL.md` · `.claude/agents/builder.md` (Fixing findings) · D-014,
  D-059, D-064 (point 2), D-065, D-075 · the architect section of `handoffs/E00-T06a.md`

**Why.** Agents' claims must be checked by a machine on every change, not only on the computer of
the agent that made them. Nothing runs on GitHub today. With CI first, every later task is checked
the same way, on Linux and from a fresh checkout. The end-to-end part waits for the seed and the
app shell (E00-T06b; split in D-075).

**Do.**
- **One workflow**, `.github/workflows/ci.yml`: on every pull request to `main`, every push to
  `main`, and once a week on `main`. Runner `ubuntu-24.04`, named rather than `ubuntu-latest`. A
  read-only token (`permissions: contents: read`), no secrets, a `timeout-minutes` on every job. A
  newer push to a pull request cancels its older run; a run on `main` is never cancelled (a
  concurrency group shared by runs on `main` would still cancel a waiting one: key the group by the
  pull request, and keep runs on `main` out of it). Every action is pinned to a full commit SHA
  with its version in a comment, and checkout keeps no token (`persist-credentials: false`). Node
  comes from `engines` and pnpm from `packageManager` in `package.json`, so no version is written
  twice. The pnpm store is cached on the lockfile; install with `pnpm install --frozen-lockfile`.
- **The database as on a developer machine:** copy `.env.example` to `.env`, then
  `docker compose up -d --wait`. Its values are local values, not secrets (D-064, point 2).
- **The steps.** Each command of `pnpm check` is its own step, in the same order, with `TZ=UTC`.
  Then `pnpm build`. Then `pnpm test` and `pnpm test:integration` a second time with
  `TZ=Pacific/Auckland` (the Auckland steps). Every check step (each command of `pnpm check`, the
  build, the Auckland steps, both audits) runs even when an earlier check failed, with
  `if: ${{ !cancelled() && steps.<last setup step>.outcome == 'success' }}`; never `always()`, which
  keeps a cancelled run going. So a failed setup step (checkout, install, the database start) ends
  the job. So a red run names every failing check
  at once. The time zone is set in the workflow, not in a `package.json` script (no bash-only
  syntax there). Telemetry off: `NEXT_TELEMETRY_DISABLED=1` in the workflow and, with a comment, in
  `.env.example` (D-075).
- **Dependency check (D-075).** A step with `pnpm audit --prod` fails the run. A step with the full
  `pnpm audit` prints its findings and fails nothing. Never with `--fix`, `--ignore` or
  `--ignore-unfixable`: they write `pnpm-workspace.yaml`.
- **The pipeline waits for CI (D-075).** `.claude/skills/pipeline/SKILL.md` and
  `.claude/agents/builder.md` describe one path:
  - After Build and after each Fix, the pipeline waits for the run of the branch's latest commit.
    It finds that run by the commit (`gh run list --commit <sha>`) and waits for it to end
    (`gh run watch`); each wait call sets its own time limit under 10 minutes (Claude Code ends a
    command after 2 minutes unless told otherwise, 10 at most).
    Not `gh pr checks`: before a run exists, it answers as if the checks had failed. Green: on as
    before. Review and Test start only on a green run.
  - A red check step: a fix round for the red run. A red run with no red check step (its job ran
    no step, for example when the minutes are used up) is not a fix round but a Stop. The pipeline gives the builder the run's link
    and the names of its failing steps; that is CI output, not a role's judgment. The builder fixes
    exactly those, under the usual fix-round rules, records them in its fix-round section, and sets
    the state the task had before: Built when the note has no reviewer section yet (so the full
    review comes next), otherwise Reviewed. The round counts toward the two automatic rounds.
  - Stop for the owner, never counted as green: no run for that commit 10 minutes after the push;
    a run still queued, or refused (minutes used up, GitHub down); a red setup step; a red
    `pnpm audit --prod` (a dependency change falls under agent rule 4).
  - Finish only when the run of the last pushed commit is green.
- **Docs.** `CLAUDE.md`: what CI runs, and how to run each level locally, the Auckland steps on
  Windows included: PowerShell's `$env:TZ`, because Git Bash drops `TZ=Pacific/Auckland` before
  Node starts (architect section); show in the handoff note that the zone really changes.
  `README.md`: one line on CI, and the new `.env.example` line. `docs/process/workflow.md`: in Git,
  "CI must be green before review" says how (the pipeline waits; the owner merges only on green,
  R-34), and "When the pipeline stops for the owner" adds the Stop cases above.
  `docs/process/templates/handoff.md`: a fix round's "Fixes:" line can name a red CI run.
  `docs/architecture/overview.md`: `.github/workflows/` in the folder structure.

**Out of scope.** Playwright, journey J1 and the test clock control (E00-T06b). A Windows job
(D-075). Deploys (E00-T07). Caching `.next/` (if a run takes over 10 minutes, cache `.next/cache`
only, and say so in the handoff note). Dependabot or other automatic updates. Fixing the two
advisories in development tools. Skipping CI for pushes that change only documents. Automatic
review on GitHub (D-065). Branch protection (not available on the current plan, D-075).

**Owner action.** Add a payment method and a small Actions budget (D-075). Optional: in the
repository's Settings → Actions, require actions pinned to a full commit SHA, and allow only
GitHub's and pnpm's actions. After the merge: check that the run on `main` is green, and copy the
new `.env.example` line into `.env`.

**Acceptance.**
- [ ] This task's pull request gets a CI run, and it is green.
- [ ] A run turns red, names the failing step, and still runs the later steps with their own
      results, for each of: a failing unit test, a failing integration test, a lint error, a type
      error, a formatting error, a build error. Shown on one scratch pull request (D-075): a branch
      made from the task branch, against `main`, with "scratch" in its title; one commit per case,
      or several in one commit when each turns a different step red; never merged, closed and its
      branch deleted afterwards. Links to the runs in the handoff note (tester).
- [ ] Every run repeats the unit and integration tests with `TZ=Pacific/Auckland`. On the scratch
      pull request, a test that succeeds only when the time zone is UTC succeeds in the `pnpm check`
      steps and fails in the Auckland steps, which turns the run red (tester).
- [ ] `pnpm audit --prod` runs on every pull request and is green on this task's pull request. On
      the scratch pull request, a production dependency with a known advisory turns the run red,
      while the full audit's findings in development tools do not (tester).
- [ ] The reviewer reads the workflow and finds: no secret; a read-only token;
      `persist-credentials: false`; every action pinned to a full commit SHA; `ubuntu-24.04`; Node
      and pnpm versions taken from `package.json`; `--frozen-lockfile`; a time limit on every job;
      runs on `main` in no shared concurrency group; check steps that run after a failed check but
      not after a failed setup step; no `--fix` or
      `--ignore`; telemetry off in the workflow and in `.env.example`; the weekly run on `main`. The
      tester sees a newer push cancel the older run of the same pull request.
- [ ] A full run takes under 10 minutes (three runs listed in the handoff note).
- [ ] The pipeline skill and `builder.md` describe the same red-run path, with every point of the
      Do item: the wait by commit, the fix round with the run's link and failing steps, the state
      set after it, the count toward the two rounds, the Stop cases, and green before Finish (the
      reviewer reads both). On the scratch pull request, the tester runs the skill's wait commands
      against a green, a red and a cancelled run, and each gives what the skill expects.
- [ ] `CLAUDE.md` says how to run each level locally, the Auckland steps on Windows included, and
      the handoff note shows that the zone really changes there.
- [ ] `pnpm check` passes.

---

### E00-T09 · The login form never puts the password in the URL

- **Role:** builder · **Risk:** critical · **Depends on:** E00-T02, E00-T08
- **Read:** `security` (Part 1, sections 2, 6 and 8) · D-063, D-074, D-076 · the architect section
  of `handoffs/E00-T09.md`

**Why.** The login form (E00-T02) has only an `onSubmit` handler. Whenever that handler does not
run, the browser submits the form itself: a GET to `/login` with the email and password in the
URL. They then stay in the browser history, in `pnpm dev`'s request log (seen in E00-T08's test,
tester note 1) and in a host's access logs. That happens with JavaScript off, and also with it on:
before the page's script has run (a slow network, a password manager that submits at once), when a
script fails to load (after a deploy), and when a script calls `form.submit()`. The owner wants it
fixed before staging (E00-T07).

**Do.**
- **The form posts.** In `src/app/(auth)/login/login-form.tsx` the form gets `method="post"` and
  `action="/login"`, with the default encoding (no `encType`). With JavaScript nothing changes:
  `onSubmit` still stops the browser's own submission and signs in through the auth library's
  client (D-063). If the form is ever submitted without that handler (a script calling
  `form.submit()`), the browser posts the fields to `/login` in the request body, and Next.js
  answers with the login page without reading the body (architect section).
- **Nothing is sent before the script runs.** The submit button is disabled in the HTML the server
  sends and enabled once the form runs in the browser: `useSyncExternalStore` with a server snapshot
  of `false` (setting state in an effect fails lint). While the button is disabled, Enter does not
  submit the form either, so with JavaScript off nothing is sent at all.
- **Say why.** A `<noscript>` line in the form: JavaScript is needed to log in. Plain text, like the
  form's other strings, until E00-T04 moves them to the message file.
- **Every form posts (lint).** A type-aware lint rule of our own, its id added to
  `ARCHITECTURE_RULES`, checks every `<form>` in `src/`. A form passes when its `action` is a
  function (a server action, a React form action), or when it has a literal `method="post"` (any
  letter case) and a non-empty `action` URL, written or in a string variable. It is reported when it
  has no `action`, an empty one, or one typed as a string-or-function union, `any` or `unknown`;
  when its `method` is an expression; and when a spread gives it props but no explicit `action`. A
  button or input whose `formMethod` is not `post` is reported too. Cases in
  `eslint-rules/architecture.test.ts` (architect section).
- **Test.** A unit test of the form's HTML as the server renders it (`react-dom/server`, with
  `next/navigation` mocked), in a `.ts` file: the unit project collects `src/**/*.test.ts`. It
  checks the attributes, and that the `<noscript>` line is there and not empty, through one render
  helper and not by its English words, so E00-T04 can translate the form without changing a check.
- **Docs:** `CLAUDE.md`, Code conventions: a form posts to a URL named in its `action`, or takes a
  function as its action; never only `onSubmit` (D-076).

**Out of scope.** A login that works without JavaScript (D-076: posting to the auth library's route
would show the session token, and signing in from our own server code would skip the rate limit;
the owner decides if it is ever wanted). Logout without JavaScript (its button sends nothing, so
nothing leaks). Restyling the login page and moving its strings to the message file (E00-T04). A
JavaScript-off check in Playwright (E00-T06b). Cleaning up URLs that the old form already left in
browser histories or logs (local development only, synthetic accounts).

**Acceptance.**
- [ ] The HTML of `/login`, as a production build sends it (`curl`), has a form with
      `method="post"`, `action="/login"` and no `enctype`, a submit button with `disabled`, and a
      `<noscript>` line saying JavaScript is needed to log in.
- [ ] A unit test renders the form with `react-dom/server` and checks those five points. It fails
      when `method` is removed, when `action` is removed or changed, when an `encType` is added, and
      when the button is enabled in the server's HTML (each shown once in the handoff note).
- [ ] With JavaScript off, in a real browser against a production build: Enter in either field and
      a click on "Log in" send no request, and neither the address bar nor the browser history holds
      the email or password (tester).
- [ ] A URL-encoded POST of the form's fields to `/login` (`curl`; what a browser sends when the
      form is submitted without our handler): the answer is the login page (200), and no line of the
      server's output (`next start`, and `pnpm dev`) holds the email or password.
- [ ] With JavaScript on, while the page's scripts are held back (browser developer tools): Enter
      and a click send nothing; once they have loaded, the button is enabled and logging in works.
      When a script fails to load, nothing is sent (tester).
- [ ] With JavaScript on, logging in, a wrong password ("Wrong email or password.") and "Logging
      in…" while waiting work as before; the existing tests pass unchanged.
- [ ] Lint fails on a `<form>` with only `onSubmit`, with `method="get"`, with an `action` URL but no
      `method="post"` (written, and in a string variable), with `method="post"` but no `action`, with
      `action=""`, with an `action` typed as a string-or-function union, and on a button with
      `formMethod="get"`. The login form, the clinic picker and a form whose `action` is a function
      pass (cases in `architecture.test.ts`; every earlier case passes unchanged).
- [ ] `pnpm check` passes.

---

### E00-T10 · Close the gaps in the lint guards

- **Role:** builder · **Risk:** critical · **Depends on:** E00-T08, E00-T09
- **Read:** `docs/log/risks.md` (R-32) · D-062, D-071, D-073, D-074, D-076, D-077, D-080, D-081 · in
  `handoffs/E00-T08.md`: the builder's "Not done", the reviewer's suggestions 3 and 4, the tester's
  notes 2 to 4 · the architect sections of `handoffs/E00-T10.md`

**Why.** Since E00-T08, lint is a security guard: it is what stops an unwrapped server action, a
stray database handle or a query nobody waits for. E00-T08's review and test found six ways past
it, none used today. An allowed folder can pass `withTenant` or the database client on; an inline
comment can switch any rule off; a query handled with `.catch(() => {})`, or a rejection with a
plain object, passes; any file can open its own connection with `pg`; a Pages Router route sits
outside every rule; and a `.js` or `.cts` file in `src/` is seen by no type-aware rule. E00-T09's
review and test found two more in its form rule: a button or input that sends its form to a URL of
its own, or gets that URL through a spread, and Next.js's `<Form>`, which sends every field in the
URL whenever its action is a URL. Closing them before E00-T04 copies components into `src/`, and
before E01, keeps "lint fails" true (D-077, D-081).

**Do.** Cases for each in `eslint-rules/architecture.test.ts`; every earlier case passes unchanged,
and `pnpm lint` passes on the code as it is.
- **No handle passed on.** `chairside/database-access` also checks `src/db/`, `src/modules/auth/`
  and the wrappers' file, and reports there a value re-export of `withTenant` or of anything from
  the database client file (`getDb`, `connect`, `closeDb` and the rest): `export { … } from`,
  `export *` of the tenant or client file, and `export { x }` of an imported handle. Type-only
  re-exports pass.
- **Drivers only in `src/db/`.** The same rule reports, outside `src/db/`, a value import of `pg` or
  a `pg-…` package, of any `drizzle-orm/…` path except `drizzle-orm/pg-core`, and of `src/db/reset`
  or `src/db/migrate`. `drizzle-orm` and `drizzle-orm/pg-core` stay allowed everywhere; type-only
  imports pass.
- **No inline switch.** `linterOptions: { noInlineConfig: true }` for `src/`, so a lint comment
  there switches nothing off and is itself reported. The snippet runner calls a message a parse
  error only when ESLint marks it fatal, and gives a non-fatal message without a rule id a fixed
  label that `ARCHITECTURE_RULES` lists, so a case can expect the report.
- **Rejections and promises nobody waits for.** `@typescript-eslint/prefer-promise-reject-errors`
  for the type-aware files, with `allowThrowingAny` and `allowThrowingUnknown` (as
  `only-throw-error` has them). In `src/**/*.{ts,mts}`, a statement that only hangs `.catch(…)` or a
  two-argument `.then(…)` on a promise is reported. It is added to the modules' existing
  `no-restricted-syntax` list, never replacing it (architect section).
- **Routes only in `src/app`.** `chairside/server-actions` reports any file under `src/pages/`, and
  runs on every script file in the repository, so a `'use server'` file outside `src/` is reported
  too.
- **No `.js`, `.jsx`, `.mjs`, `.cjs` or `.cts` files in `src/`.** A test fails when `src/` holds
  one: no type-aware rule sees them (D-074). Other files, such as styles and images, are not
  affected.
- **Every way a form is sent** (D-081). `chairside/forms-post` also reports:
  - on `<button>` and `<input>`, a `formAction` read as a form's `action` is, except that a value
    that may be missing passes (parts typed `undefined` or `null` are left out first; no value at
    all passes too). A function passes; a URL passes only with `formMethod="post"` written as a
    string on the same element; an empty URL, or a value that may be a string or a function, `any`
    or `unknown`, is reported.
  - on `<button>` and `<input>`, a spread whose type may carry `formAction` or `formMethod`: a
    property of either name in any letter case on any part of its type (a type parameter counts as
    its constraint), an index signature, `any` or `unknown`. Wherever the spread sits.
  - in every file it covers, a value import of `next/form` (also `next/form.js` and
    `next/dist/client/form`, with or without `.js`), an `export … from` it, and an `import()` of it
    written as a string. Type-only imports pass. In this rule, not in `no-restricted-imports`
    (architect section, 2026-10-05).
- **Docs:** `CLAUDE.md` module rules 5 to 7 say what is now covered; R-32 in `docs/log/risks.md` gets
  an appended line. `CLAUDE.md`'s Forms line says that a `formAction` follows a form's rule, that a
  component spreading props onto a button or input types them without `formAction` and
  `formMethod` (D-081), and that `next/form` is not used.

**Out of scope.** Refusing `void` in server code (D-074 keeps it a review check). Reporting
`export const x = withTenant`, a function that wraps `withTenant` or returns the client, or a cast
that hides a promise: these stay review checks. A rule against imports from `src/` that resolve
outside it. The copy of the import-path helpers in `eslint-rules/module-boundaries.mjs` (board).
Of the form rule: `createElement`, `require('next/form')`, and a URL built in code from a form's
fields (review checks, D-081); any change to the login form.

**Acceptance.**
- [ ] Lint fails on `export { withTenant } from '@/db/tenant'` and on
      `export { getDb } from '@/db/client'` in `src/modules/auth/`, on `export *` of the tenant and
      client files in `src/db/`, on an imported `withTenant` exported again under another name, on
      `export { withTenant } from '@/db/tenant'` in `src/app/_lib/actions.ts`, and on
      `export { connect } from './client'` in `src/db/`. `export type { TenantTransaction }` passes,
      and so do the real files.
- [ ] Lint fails on `pg`, `pg-boss`, `drizzle-orm/node-postgres`,
      `drizzle-orm/node-postgres/migrator`, `drizzle-orm/postgres-js`, `@/db/reset` and
      `@/db/migrate` imported in a module, and on `pg` imported in a page and in
      `src/modules/auth/`. `pg` in `src/db/`, type-only imports of `pg`, and `drizzle-orm` and
      `drizzle-orm/pg-core` in a module pass.
- [ ] An `eslint-disable` comment in `src/`, for the next line and for the whole file, switches off
      none of `chairside/server-actions`, `chairside/database-access`, the clock rule and
      `no-floating-promises`, and lint reports the comment itself.
- [ ] Lint fails on `return Promise.reject({ cause: e })` and on `reject({ code })` in a
      `new Promise`; rejecting with a caught error, with `withoutQueryValues(error)` or with a new
      Error passes. Lint fails on `tx.insert(…).catch(() => {})` and `….then(ok, fail)` as statements
      in a module and in an action file, and on `p?.catch(…)`; the same awaited or returned, and a
      `.then(ok, fail)` statement in a client `.tsx` component, pass. `Date.now()` in a module is
      still reported.
- [ ] Lint fails on `src/pages/api/x.ts`, on `src/pages/x.tsx` and on a `'use server'` file
      outside `src/`. It does not fail on a folder named `pages` inside `src/app`.
- [ ] A test fails when a `.js`, `.jsx`, `.mjs`, `.cjs` or `.cts` file is put in `src/` (shown once
      in the handoff note, then removed).
- [ ] Lint fails on `<button formAction="/patients">` in a form whose action is a function, on
      `<input type="submit" formAction="/patients">`, on a `formAction` URL in a string variable
      without `formMethod`, on `formAction=""` with `formMethod="post"`, and on a `formAction`
      typed `ComponentProps<'button'>['formAction']` with `formMethod="post"`. A function, a
      function-or-`undefined`, `formAction={undefined}`, and a URL with `formMethod="post"` (also
      `"POST"`, and with the URL in a string variable) pass.
- [ ] Lint fails on a spread onto `<button>` typed `ComponentProps<'button'>`,
      `Omit<ComponentProps<'button'>, 'formAction'>`, `any` or `Record<string, string>`, or a type
      parameter constrained by `ComponentProps<'button'>`, and onto `<input>` typed
      `ComponentProps<'input'>`. Passing: a spread typed
      `Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'>`; a button component of that type
      plus `formAction` typed as a function, written as `formAction={formAction}` after the spread;
      `{...{ disabled: pending }}`; and an input spread of an object with `name`, `onChange`,
      `onBlur` and `ref`.
- [ ] Lint fails on `import Form from 'next/form'` in a page and in a client component, on
      `import { default as F } from 'next/form'`, on `import Form, { type FormProps } from
      'next/form'`, on `export { default } from 'next/form'`, on `export * from 'next/form'`, on
      `import('next/form')`, and on imports of `next/form.js` and `next/dist/client/form`.
      `import type { FormProps } from 'next/form'`, `import { type FormProps } from 'next/form'` and
      `next/link` pass.
- [ ] For each fix, taking it out again fails its cases (listed in the handoff note).
- [ ] `pnpm check` passes.

---

### E00-T04 · App shell and design system

- **Role:** builder · **Risk:** normal · **Depends on:** E00-T02, E00-T03, E00-T09, E00-T10
- **Read:** `design-ref` (all) · `scope` (Navigation and roles) · `security` (Part 1, section 2) ·
  D-009, D-015, D-069, D-076 · demo lines 13–58 (page styles, sidebar)

**Why.** Every screen is built from the same tokens and components, so the app looks like
the design and agents do not invent styles per screen.

**Do.**
- Tailwind theme with the tokens from `design-reference.md` (colours, fonts, radii, sizes).
  Fonts bundled with the app, not loaded from a third party at runtime.
- shadcn/ui base components restyled to the tokens: button (primary, secondary, quiet),
  input, select, textarea, toggle, checkbox, tabs, badge/pill, card, drawer (right side),
  toast, dialog, empty state.
- Staff layout: sidebar with navigation as in the demo (items the user's role may see),
  clinic name, signed-in user with logout. Pages for each nav item as "coming soon" placeholders.
- Restyle the login page. Keep what E00-T09 made: the form posts to `/login`, its button is
  disabled until the script runs, and the line for browsers without JavaScript stays (its text
  moves to the message file). E00-T09's unit test keeps every check it makes; it may only gain
  what rendering with translations needs, such as a provider or a mock (D-076).
- Translations set up (next-intl): every visible string comes from the message file; English
  only. No second language and no language switcher are built (D-053): the message file is
  what makes the owner's later translation pass cheap.
- A hidden `/dev/components` page (non-production only) showing every component, for visual checks.
- One way for a form to call a wrapped action (E00-T03) and show its typed errors: `forbidden`,
  `invalid_input` next to the fields, `clinic_changed` with a reload (D-069), and a general
  failure for `internal`. The staff layout gives client components the clinic id the page was
  rendered for, so every form sends it. A form takes the action as `action={…}`: lint refuses a
  form with only `onSubmit` (D-076).
- **Docs:** `CLAUDE.md` says that a page outside `(staff)` starts from `currentStaff()` or
  `requireUser()` too, or is public on purpose and says so in a comment: the proxy lets a
  signed-out POST that looks like a server action through (`security` section 2; board,
  Discovered, E00-T08 review suggestion 2). The login page, public on purpose, gets that comment.

**Out of scope.** Any real screen content. Dark mode. Patient-page layout (E02).

**Acceptance.**
- [ ] Sidebar and login visually match the demo (side-by-side screenshots in the handoff note).
- [ ] No colour, font or radius is hard-coded in a component: all come from tokens.
- [ ] No request goes to a third-party host when loading any page (checked in browser dev tools).
- [ ] Navigation shows only what the role may see (front desk has no Automations, Settings).
- [ ] No hard-coded user-visible strings in components (lint rule or documented check).
- [ ] Layout works at 1280 px wide and on a tablet in landscape (1024 px).
- [ ] Components are keyboard-usable and labelled (automated accessibility check passes on `/dev/components`).
- [ ] A form on `/dev/components` shows each typed error of the action wrapper in its standard way,
      and a form shown for one clinic, sent after another tab switched clinic, shows the reload message.

---

### E00-T05 · Seed data and the clinic provisioning script

- **Role:** builder · **Risk:** normal · **Depends on:** E00-T02, E00-T03 (`clinic:create` writes
  its audit row through `audit.record()`)
- **Read:** `security` (Part 1, section 9) · D-042, D-044 · demo lines 1369–1404 (sample clinic)

**Why.** Agents and tests need realistic data that is obviously fake, and the operator needs
a way to create a real clinic (there is no sign-up page).

**Do.**
- A deterministic seed generator: two clinics ("Harbour Street Dental" modelled on the demo,
  and a second clinic used by isolation tests), both configured for North Macedonia (D-049:
  `Europe/Skopje`, country MK, currency MKD), one user per role, structured so each later
  schema task adds its own seed function.
- Fake-data rules in one place: names from a fixed invented list, phones from test ranges,
  emails at `@example.test`. A test fails if seed output contains anything else.
  Invented names come in both Cyrillic and Latin script. There is no known reserved test
  range for `+389`: use one fixed, documented block of made-up numbers; the non-production
  allow-list (D-044) is what guarantees nothing is ever sent to them.
- `pnpm db:seed` and `pnpm db:reset` (migrate + seed).
- `pnpm clinic:create`: an operator script that creates a clinic and its first owner
  (name, time zone, locale, currency, country, owner email), prints a one-time setup link,
  and writes an audit row.

**Out of scope.** Patients, appointments and other domain seed (each schema task adds its own).

**Acceptance.**
- [ ] `pnpm db:reset` produces the same data every time.
- [ ] Logging in as each seeded role works.
- [ ] The fake-data test fails when a non-test phone range or real-looking email domain is used.
- [ ] `clinic:create` creates a clinic the owner can log in to; running it twice with the
      same owner email does not create duplicates or crash.
- [ ] The script refuses to run against production without an explicit flag.

---

### E00-T06b · Playwright and the first end-to-end journey (J1)

- **Role:** builder · **Risk:** normal · **Depends on:** E00-T04, E00-T05, E00-T06a, E00-T09
- **Read:** `test-strategy` (The levels; End-to-end journeys) · D-012, D-014, D-075, D-076 · the
  handoff notes of E00-T04, E00-T05 and E00-T06a

**Why.** A few journeys through a real browser prove that the pieces are wired together: login,
session, layout, logout. Split from E00-T06 (D-075): it needs the seeded users (E00-T05) and the
Today page of the app shell (E00-T04). It is refined against what they built, once they are done.

**Do.**
- Playwright (named in D-012; its exact version gets a decision entry at refinement), set up
  against a freshly seeded end-to-end database, never the development database, testing a
  production build on its own port.
- Journey **J1**: log in, see Today, log out; a wrong password is refused. With JavaScript off, the
  login form sends nothing, and neither the address bar nor the browser history holds the password
  (E00-T09).
- A way for end-to-end tests to control "now" (test-only clock control), impossible to enable on
  staging or production. `NODE_ENV` cannot be its guard: `next build` writes `production` into the
  build the tests run against (D-075). Sized when this task is refined; if it does not fit, it gets
  its own task before the first journey that needs it.
- A CI job for the journeys, after the build. Traces only on failure, kept briefly, synthetic data
  only.
- `CLAUDE.md`: how to run the journeys locally.

**Out of scope.** Other journeys. The fake channel (E02-T04). The worker's clock (E02-T07).

**Acceptance.**
- [ ] J1 passes in CI and locally on Windows.
- [ ] J1 fails when login or logout is broken (tester).
- [ ] The clock control cannot be enabled on staging or production (test).
- [ ] A run leaves the development database untouched.
- [ ] A full CI run still takes under 10 minutes.

---

### E00-T07 · Staging: web, worker and database deployed

- **Role:** builder + owner · **Risk:** critical · **Depends on:** E00-T05, E00-T06b, E00-T09 · **Needs:** Q-07 (working assumption accepted for staging)
- **Read:** `overview` (The shape; Environments; Things that keep it running) · `security` (Part 1, section 7) · D-005, D-007, D-013, D-075, D-077

**Why.** A walking skeleton in a real environment exposes deployment problems while the app is
still tiny, and gives every later milestone a place to be demonstrated.

**Do.**
- One Dockerfile; the same image runs as `web` or `worker`.
- Worker entry point: starts pg-boss, registers one repeating "heartbeat" job that logs and
  pings an external monitor URL if configured, shuts down gracefully. The worker's folder joins
  `chairside/database-access`'s lists: pg-boss, and `withTenant` for the job handler (D-071, D-077).
- Infrastructure description for the host (web service, background worker, managed
  PostgreSQL in Frankfurt), migrations run on deploy with the migration role. Next.js telemetry
  off on staging (`NEXT_TELEMETRY_DISABLED=1`, D-075).
- `/api/health`: checks the database and that the worker's heartbeat is recent.
- Sentry (EU) wired in both processes with personal-data scrubbing on. The scrubbing also removes
  request headers and cookies, so no session cookie or client address reaches Sentry: Next.js hands
  a request's headers to its error hook. Inactive when no key is set. Next.js's "Failed to find
  Server Action" error is not sent: anyone can cause it, without a session, by posting a multipart
  form that names no server action (board, Discovered, E00-T08 tester note 5; D-075).
- `docs/runbook.md` started: how to deploy, roll back, read logs, run a migration, create a clinic.
  It says a "Failed to find Server Action" log line is noise unless it follows a deploy.

**Owner action.** Create the hosting, Sentry and monitor accounts; enter secrets in the host's
secret store (agents never see them); run `clinic:create` on staging.

**Out of scope.** Production environment (E07). Custom domain (Q-03). Any real job besides the heartbeat.

**Acceptance.**
- [ ] Staging URL serves the login page over HTTPS; a seeded staging user can log in.
- [ ] The worker runs as its own process and the heartbeat job fires on schedule.
- [ ] `/api/health` turns unhealthy when the worker is stopped (demonstrated).
- [ ] A deliberate test error appears in Sentry with no personal fields in it.
- [ ] A multipart POST that names no action, sent to staging without a session, adds no event in
      Sentry; the deliberate test error still does.
- [ ] Deploys happen from `main` automatically; a rollback is documented and was tried once.
- [ ] No secret is in the repository or the image.
- [ ] Staging holds synthetic data only.

**Milestone check (M0):** log in on staging; the isolation tests and meta-test are green in CI.

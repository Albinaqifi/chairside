# E00 · Foundation (milestone M0)

**Outcome:** a real project exists. You can log in to an empty clinic on a staging URL, two
clinics cannot see each other's data, and every change is checked automatically.

**Why first:** everything else stands on tenant isolation, login and the action wrapper.
Getting them right once, with tests, is cheaper than fixing them under features.

Order: T01 → T02 → T03 → T08 → (T04, T05, T06 in any order) → T07. T08 is the second half of
T03 (split in D-071), so it sits right after T03 in this file.

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

### E00-T04 · App shell and design system

- **Role:** builder · **Risk:** normal · **Depends on:** E00-T02, E00-T03
- **Read:** `design-ref` (all) · `scope` (Navigation and roles) · D-009, D-015, D-069 ·
  demo lines 13–58 (page styles, sidebar)

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
- Restyle the login page.
- Translations set up (next-intl): every visible string comes from the message file; English
  only. No second language and no language switcher are built (D-053): the message file is
  what makes the owner's later translation pass cheap.
- A hidden `/dev/components` page (non-production only) showing every component, for visual checks.
- One way for a form to call a wrapped action (E00-T03) and show its typed errors: `forbidden`,
  `invalid_input` next to the fields, `clinic_changed` with a reload (D-069), and a general
  failure for `internal`. The staff layout gives client components the clinic id the page was
  rendered for, so every form sends it.

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

### E00-T06 · CI and the first end-to-end test

- **Role:** builder · **Risk:** normal · **Depends on:** E00-T04, E00-T05
- **Read:** `test-strategy` (The levels; End-to-end journeys) · `docs/process/workflow.md` (Git) · D-014

**Why.** Agents' claims must be checked by a machine on every change.

**Do.**
- GitHub Actions workflow on every pull request and on `main`: install, `check` (format,
  lint, types, unit), integration tests with a PostgreSQL service, build, Playwright.
- Playwright set up against a freshly seeded database; journey **J1** (log in, see Today
  placeholder, log out; wrong password refused).
- A way for end-to-end tests to control "now" (test-only clock control, impossible to enable
  in production).
- The whole suite also runs with `TZ=Pacific/Auckland`.
- Dependency vulnerability check.
- Document in `CLAUDE.md` how to run each level locally.

**Owner action.** Create the private GitHub repository and turn on "require green CI before merge" for `main`.

**Acceptance.**
- [ ] A pull request with a failing test, a lint error or a type error is marked red.
- [ ] J1 passes in CI.
- [ ] The time-zone run is part of CI and green.
- [ ] The clock-control hook cannot be enabled when `NODE_ENV=production` (test).
- [ ] A full CI run takes under 10 minutes.

---

### E00-T07 · Staging: web, worker and database deployed

- **Role:** builder + owner · **Risk:** critical · **Depends on:** E00-T06 · **Needs:** Q-07 (working assumption accepted for staging)
- **Read:** `overview` (The shape; Environments; Things that keep it running) · `security` (Part 1, section 7) · D-005, D-007, D-013

**Why.** A walking skeleton in a real environment exposes deployment problems while the app is
still tiny, and gives every later milestone a place to be demonstrated.

**Do.**
- One Dockerfile; the same image runs as `web` or `worker`.
- Worker entry point: starts pg-boss, registers one repeating "heartbeat" job that logs and
  pings an external monitor URL if configured, shuts down gracefully.
- Infrastructure description for the host (web service, background worker, managed
  PostgreSQL in Frankfurt), migrations run on deploy with the migration role.
- `/api/health`: checks the database and that the worker's heartbeat is recent.
- Sentry (EU) wired in both processes with personal-data scrubbing on; inactive when no key is set.
- `docs/runbook.md` started: how to deploy, roll back, read logs, run a migration, create a clinic.

**Owner action.** Create the hosting, Sentry and monitor accounts; enter secrets in the host's
secret store (agents never see them); run `clinic:create` on staging.

**Out of scope.** Production environment (E07). Custom domain (Q-03). Any real job besides the heartbeat.

**Acceptance.**
- [ ] Staging URL serves the login page over HTTPS; a seeded staging user can log in.
- [ ] The worker runs as its own process and the heartbeat job fires on schedule.
- [ ] `/api/health` turns unhealthy when the worker is stopped (demonstrated).
- [ ] A deliberate test error appears in Sentry with no personal fields in it.
- [ ] Deploys happen from `main` automatically; a rollback is documented and was tried once.
- [ ] No secret is in the repository or the image.
- [ ] Staging holds synthetic data only.

**Milestone check (M0):** log in on staging; the isolation tests and meta-test are green in CI.

# E00 · Foundation (milestone M0)

**Outcome:** a real project exists. You can log in to an empty clinic on a staging URL, two
clinics cannot see each other's data, and every change is checked automatically.

**Why first:** everything else stands on tenant isolation, login and the action wrapper.
Getting them right once, with tests, is cheaper than fixing them under features.

Order: T01 → T02 → T03 → (T04, T05, T06 in any order) → T07.

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

### E00-T03 · The action wrapper, permission checks and audit log

- **Role:** builder · **Risk:** critical · **Depends on:** E00-T02
- **Read:** `overview` (How a staff action flows) · `security` (Part 1, sections 1, 2, 10) · `data-model` (`audit_log`)

**Why.** One wrapper that every staff action passes through is what makes "permissions are
always checked" and "everything is audited" true by construction instead of by discipline.

**Do.**
- `staffAction({ permission, input: zodSchema, audit }, handler)`: session → membership →
  permission check → input validation → tenant transaction → handler → audit row written in
  the same transaction → typed result or typed error.
- `audit.record(...)` in the `audit` module: actor, action, entity, metadata (ids and field
  names only, never values of personal fields).
- A read variant for queries that logs patient-record views when asked to.
- A lint rule or test that fails if a server action or route handler in `(staff)` does not use the wrapper.
- Document the pattern in `CLAUDE.md` with one short example.

**Out of scope.** The audit viewer screen (E07). Patient-link actions (E02 uses its own wrapper).

**Acceptance.**
- [ ] An action without the needed permission returns a forbidden error and writes nothing.
- [ ] Invalid input is rejected before the handler runs.
- [ ] If the handler throws, neither its changes nor the audit row are saved (one transaction).
- [ ] A successful action writes exactly one audit row with actor, action, entity.
- [ ] The "every staff action uses the wrapper" check fails when a bare action is added.
- [ ] Audit metadata rejects values for fields on the personal-data list (test).

---

### E00-T04 · App shell and design system

- **Role:** builder · **Risk:** normal · **Depends on:** E00-T02
- **Read:** `design-ref` (all) · `scope` (Navigation and roles) · D-009, D-015 ·
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

**Out of scope.** Any real screen content. Dark mode. Patient-page layout (E02).

**Acceptance.**
- [ ] Sidebar and login visually match the demo (side-by-side screenshots in the handoff note).
- [ ] No colour, font or radius is hard-coded in a component: all come from tokens.
- [ ] No request goes to a third-party host when loading any page (checked in browser dev tools).
- [ ] Navigation shows only what the role may see (front desk has no Automations, Settings).
- [ ] No hard-coded user-visible strings in components (lint rule or documented check).
- [ ] Layout works at 1280 px wide and on a tablet in landscape (1024 px).
- [ ] Components are keyboard-usable and labelled (automated accessibility check passes on `/dev/components`).

---

### E00-T05 · Seed data and the clinic provisioning script

- **Role:** builder · **Risk:** normal · **Depends on:** E00-T02
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

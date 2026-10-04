# Board

The **only** place task status lives. Update your task's row when you start and when you
finish. Keep notes to one short line; details go in the handoff note.

States: `Planned` → `Ready` → `In progress` → `Built` → `Tested` → `Reviewed` → `Done`, or `Blocked`.
(See `docs/process/workflow.md`.)

_Last updated: 2026-10-04 — reviewer: E00-T06a delta review of `3110144..5e280f8` approved: fix round 1 fixes required change 1, no required changes, 1 suggestion on the Discovered list; stays Tested. Next: the pipeline's Finish (CI wait on the last commit), then the owner merges PR #11. Before: tester: E00-T06a Tested at `b5c5508`, no findings: every criterion checked again; scratch PR #12 (9 runs: 1 green, 5 red, 3 cancelled) closed unmerged, its branch deleted. Before: builder: E00-T06a fix round 1: the reviewer's required change 1 is fixed (pipeline skill, CI wait step 3: a watch call that reaches its time limit reads the run's status; still queued → Stop)._

## Now

- **Milestone:** M0 Foundation
- **Next task to start:** `E00-T06a` is Tested and its delta review approved (`handoffs/E00-T06a.md`): the pipeline's Finish (CI green on the last commit), then the owner merges PR #11. Then `E00-T09`, then `E00-T10` (both Ready)
- **Security, from the E00-T08 test:** with JavaScript off, the login form sends the email and password in the URL. `E00-T09` fixes it, before staging (E00-T07)
- **Owner action for CI (D-075):** add a payment method and a small GitHub Actions budget (for example $10 a month); after two weeks of runs, decide on GitHub Pro (R-34). Optional: in the repository's Settings → Actions, require actions pinned to a full commit SHA and allow only GitHub's and pnpm's actions
- **Owner decisions from the E00-T02 test, still open:** finding 5 (rate-limit address: with E00-T07, and whether D-064 point 5 stands) and finding 7 (self-rename: E04, or switch the route off sooner). Both are on the Discovered list. Finding 6 is decided (D-069)
- **Owner action, start now (long lead time):** create the Meta Business account, begin
  business verification, obtain one WhatsApp sending number for the product (D-055, D-056, risk R-28).
- **Waiting on the owner:** copy the two `BETTER_AUTH_` lines from `.env.example` into `.env` (E00-T02), and after E00-T06a its `NEXT_TELEMETRY_DISABLED` line. Q-07 and Q-09 are open with working assumptions.

## Next (in order)

1. E00-T06a → E00-T09 → E00-T10
2. E00-T04, E00-T05 (any order) → E00-T06b → E00-T07
3. E01 from T01

## Blocked

| Task | Blocked by | Who must act |
|---|---|---|
| E03-T02 … T09 | Q-08 providers (decided in E03-T01) and Meta business verification | Owner + architect |

## Discovered (things noticed outside a task)

Agents add one line each: date · task you were on · what you saw. The architect or owner
turns lines into tasks or strikes them out.

- 2026-10-02 · planning · Since Chairside replaces the old tool (D-050), a clinic's already booked **future appointments** must be brought in at switch-over. No task covers it yet. E04-T00 must add one (file import of upcoming appointments, or a fast keying screen).
- 2026-10-02 · planning · `docs/intent.md` still says "GDPR" and "data stays in the EU". With North Macedonia (D-049) the wording could mention the national law. Owner-only file: waiting for the owner.
- ~~2026-10-03 · E00-T01 · Next.js collects anonymous usage telemetry by default (`next dev`, `next build`). Owner to decide whether to turn it off (`NEXT_TELEMETRY_DISABLED=1`) locally, in CI and on staging.~~ **Owner, 2026-10-04: off everywhere** (D-075): CI and `.env.example` in E00-T06a, staging in E00-T07.
- 2026-10-03 · E00-T01 · The app role may UPDATE every column of `clinics`, including `status`. E01-T08 (clinic settings) should decide whether staff may change all of them (column grants).
- 2026-10-03 · E00-T01 · Newer major versions exist than the stack uses: TypeScript 7, ESLint 10, drizzle-orm 1.0 (release candidate). Kept on the versions in D-059; an upgrade would be its own task.
- 2026-10-03 · E00-T01 · The agent guard (`.claude/settings.json`) covers fewer `.env` names than `.gitignore` (not e.g. `.env.staging`), and its PowerShell patterns miss a quoted file name (tester finding 11).
- 2026-10-03 · E00-T01 · `pnpm dev` listens on every network interface (the dev log shows a LAN address); `next dev -H 127.0.0.1` would keep it on this machine (tester finding 12).
- 2026-10-03 · E00-T01 · The logger writes a `URL` object under any key as its full address (link tokens), and a `Buffer` as bytes that decode back to text. Value shapes from tester finding 10; only the field names were in scope. **Owner, 2026-10-03: handle before E02** (link tokens arrive with E02-T08).
- ~~2026-10-03 · E00-T01 · `eslint-rules/architecture.test.ts` can hit its 60 s `beforeAll` limit when the file cache is cold (first run of a session on Windows: 56 s, once over 60 s); warm runs take about 2 s.~~ Fixed in E00-T01 on the owner's decision: limit raised to 3 minutes.
- 2026-10-03 · E00-T01 · Luxon also reads the clock when a date has no day: its docs show `DateTime.fromObject({ hour: 10 })` as "today at 10:00". Lint rule (a) does not catch it; check before E02 uses Luxon.
- 2026-10-03 · E00-T01 · The logger still keeps field names that matter for messaging and links: `toNumber`, `fromNumber`, `waNumber`, `whatsappId`, `sender`, `referer`, `redirectUri`, `querystring`, `values`, and free text such as `cancelReason` (tester round 2). Look at them with the `URL`/`Buffer` line above, before E02.
- ~~2026-10-03 · E00-T01 · E00-T03's action wrapper: keep a caught error as `cause`; never copy `err.message` into a new error or a template string. The logger cannot clean text, and a failed query's values are in that message (tester round 2).~~ In E00-T03, "Unexpected errors" (D-071).
- ~~2026-10-03 · E00-T01 · When a rollback fails (for example because the connection died), Drizzle's `transaction()` throws the rollback's error instead of the error that caused it. `withTenant` logs the connection failure; E00-T03 should not count on seeing the first error.~~ In E00-T03, "Unexpected errors" (D-071).
- 2026-10-03 · E00-T01 · Nothing limits how long a statement waits for the database to answer (no `statement_timeout`, no pg `query_timeout`). The 5 s limits cover locks and connections only: a database that stops answering mid-statement, or during `withTenant`'s reset, keeps the call waiting.
- 2026-10-03 · E00-T01 review · Outside local `db:reset`, nothing checks the app's database role. A hosted `DATABASE_URL` that names the table owner (or a superuser or BYPASSRLS role) switches off every policy without an error. Suggest a start-up check that refuses to serve, before E00-T07 (handoff, reviewer suggestion 1).
- ~~2026-10-03 · E00-T01 review · "Never import `src/db/client.ts` elsewhere" is not a lint rule, and `getDb()` (tests only) gives a handle outside `withTenant`. E00-T02 or E00-T03: decide which file may use it (the auth library needs one for the global tables) and lint the rest.~~ Decided in D-062; the lint rule is in E00-T08 (D-071).
- 2026-10-03 · E00-T01 review · The `db:reset` guard accepts a `MIGRATION_DATABASE_URL` whose user is `chairside_app` or the admin user; the app role then owns the tables and skips the policies. Local only: `pnpm check` catches it, `pnpm dev` does not.
- 2026-10-03 · E00-T02 · `memberships` exists without `provider_id`: the column and its foreign key (`clinic_id`, `provider_id`) → providers must come with E01-T01, when providers exist (D-062).
- ~~2026-10-03 · E00-T02 · `data-model.md` says the audit log records logins, but a login has no clinic yet (sessions are global). Decided 2026-10-03 (D-064, owner delegated): a login is audited as `user.logged_in` in every clinic the person has an active membership in, from the session-creation hook; E00-T03 builds it.~~ E00-T08 builds it, after E00-T03's `audit.record()` (D-071).
- 2026-10-03 · E00-T02 · The auth library reads the client address from `x-forwarded-for` only when it holds exactly one address; otherwise all such requests share one login rate-limit bucket. E00-T07: set `advanced.ipAddress.trustedProxies` (or the host's own header) once the host is known (R-33).
- 2026-10-03 · E00-T02 · The app role has SELECT only on `memberships` and no INSERT on `clinics`. E00-T05: the seed and `clinic:create` must run as the migrator or get their own grants; `createStaffUser()` from `@/modules/auth` creates the user.
- 2026-10-03 · E00-T02 · Sessions store the staff member's `ip_address` and `user_agent` (library default), and an expired session is deleted only when its cookie is seen again. E07-T04 (retention): a job that deletes expired `sessions`, `verifications` and stale `rate_limits` rows.
- ~~2026-10-03 · E00-T02 · Decided: only `src/modules/auth/` imports `@/db/client` (D-062). The lint rule that enforces it is still to write (E00-T03, see the E00-T01 review line above).~~ In E00-T08 (D-071).
- 2026-10-03 · E00-T02 · Removing a route leaves old generated types in `.next/dev/types`, so `pnpm typecheck` fails locally until `.next` is deleted (README says so). A fresh checkout (CI, E00-T06a) is not affected.
- ~~2026-10-03 · E00-T02 test · Next.js prints an error thrown while rendering a page, values of a failed query included (`params`); our logger never sees it. Today only ids; from E01 patient values. Take the values out where query errors are created, before E01 (handoff, tester finding 2).~~ Owner decided: cleaned where the errors are made, in every environment (D-070); E00-T03 builds it.
- 2026-10-03 · E00-T02 test · The auth library's queries (`getDb()`) have no lock timeout: "waiting for a lock fails after 5 s" (CLAUDE.md) holds inside `withTenant` only.
- ~~2026-10-03 · E00-T01 review · `security-privacy.md` section 7 says `.env.example` lists names without values; the task allowed local values that are not secrets, which the file has. Owner: adjust the sentence.~~ Adjusted to D-064 point 2 in the planning of 2026-10-04, because CI uses those values (D-075).
- 2026-10-03 · E00-T02 review · Pin `better-auth` to exactly 1.7.7 (`package.json` has `^1.7.7`): the adapter error wrapper and `PASSWORD_CHECK_PATHS` depend on its internals and route list, and a minor upgrade could change them with no failing test (handoff, reviewer suggestion 1).
- 2026-10-03 · E00-T02 review · `.env.example` holds a working `BETTER_AUTH_SECRET`; copied to staging, cookies would be signed with a value in git. E00-T07: refuse to start with that value when `BETTER_AUTH_URL` is https.
- 2026-10-03 · E00-T02 review · `PERMISSION_TABLE` leaves out scope-v1.md's row "Read aftercare drafts and the library" (every role ✔) though its comment says it mirrors the table row by row. Add it (E06) or say why it is left out.
- ~~2026-10-03 · E00-T02 review · `chooseClinic` (`(auth)/choose-clinic/actions.ts`) is a server action outside `(staff)`: E00-T03's wrapper check will not see it, and it reads input without Zod. E00-T03: decide how actions before a clinic is chosen are checked.~~ Decided (D-071): E00-T03 moves it onto `userAction` with Zod; E00-T08's lint check covers every route group.
- 2026-10-03 · E00-T02 review · The builder's "For the tester" recipe in `handoffs/E00-T02.md` holds synthetic names, emails and a dev password; rule 6 and the template ask for ids. Point to the seed once E00-T05 exists.
- 2026-10-03 · E00-T02 test · The proxy matcher (`src/proxy.ts`) skips every path that contains a dot or starts with `login`: a future staff route such as `/logins` or `/export.csv` would not renew the session. Keep staff routes clear of both, or narrow the pattern (E00-T04 navigation).
- 2026-10-03 · E00-T02 delta review · The request proxy now reads and writes the database (D-067), using the pool and auth instance on `globalThis`. Next.js warns a proxy may run apart from the app (CDN). E00-T07: choose a host that runs it inside the app's Node.js process, or revisit D-067.
- 2026-10-03 · E00-T02 delta review · The proxy's matcher covers every path but `/login…`, `/api/auth` and files. Patient link pages (E02-T08, T09) and webhooks (E03-T04) would go to `/login`, and on a staff computer a patient page would renew the staff session and set its cookie (security-privacy.md section 3). Narrow the matcher to staff routes when the first other route arrives.
- ~~2026-10-03 · E00-T02 delta review · A server action sent after the session ended gets the proxy's 307, which `fetch` follows as a POST to `/login`, so `currentStaff()`'s redirect is never reached; what the person sees is unchecked (probably an error). Fails safe. E00-T03 or E00-T06: check it in a browser.~~ In E00-T08: the person must end on the login page; the tester checks it in a browser (D-071).
- 2026-10-03 · E00-T02 test · Any client picks its own sign-in rate-limit counter by sending a new `X-Forwarded-For` each time (tester finding 5). E00-T07: add "rotating `X-Forwarded-For` against staging still gets a 429" to its acceptance. Owner: also whether D-064 point 5 (no per-account limit) stands.
- 2026-10-03 · E00-T02 test · A signed-in person can rename themselves and store any picture address through the auth library's `/update-user` (tester finding 7). Owner: decide in E04, or switch the route off before then.
- 2026-10-04 · E00-T03 · Nothing stops a `staffRead` handler from writing: a read that changes data would write no audit row. A `READ ONLY` transaction for reads that declare no audit row would make it impossible (E00-T08 or later). **Owner, 2026-10-04: not in E00-T08, later** (D-073).
- 2026-10-04 · E00-T03 · `captureOutput` and `withoutGrant` are now shared in `tests/integration/fixtures.ts`; `auth-attacks.test.ts` still has its own copies (left unchanged). A test cleanup can switch it over.
- ~~2026-10-04 · E00-T03 review · `withoutQueryValues()` does not look inside plain objects, Maps or a thrown value that is not an Error: a failed query kept there still prints its values. E00-T08: add `@typescript-eslint/only-throw-error` with its type-aware rules, and say in `query-errors.ts` which shapes are walked (handoff, reviewer suggestion 1).~~ In E00-T08, both halves (owner, D-073).
- 2026-10-04 · E00-T03 review · `throw refuse('x')` is answered `internal` (a refusal must be returned), and `refuse()`'s comment "nothing the handler did is kept" is not true for `userAction`, which has no transaction (handoff, reviewer suggestion 2). From E00-T08, lint reports `throw refuse(…)` (`only-throw-error`, D-073); the comment stays open.
- ~~2026-10-04 · E00-T03 review · No test pins D-072's "a staff handler's `redirect()` or `notFound()` is rolled back and answered `internal`", nor D-069's "the clinic check comes before the permission check" (handoff, reviewer suggestion 3).~~ Covered by the tester's tests in `action-wrappers-edges.test.ts`, confirmed in the delta review (`handoffs/E00-T03.md`).
- 2026-10-04 · E00-T03 review · `src/modules/audit/record.ts` says the JSON error for bad metadata names no key; for a loop its `cause` names every key on the path, and `internal()` logs it. Fix the comment or drop the cause (handoff, reviewer suggestion 4).
- 2026-10-04 · E00-T03 review · An audited `staffRead(...).forPage` writes its "viewed" row on every render, and `<Link prefetch={true}>` renders a dynamic page before any click. E01-T03: no full prefetch on links to a patient record (handoff, reviewer suggestion 5).
- 2026-10-04 · E00-T03 test · `withoutQueryValues()` rewrites messages for SQLSTATE class 22 and 42601 only: a value cast to `regproc` (42883), `regclass` (42P01) or `regconfig` (42704) that names nothing stays in the message. No query does this; a search that passes its text-search configuration as a parameter would (E01-T02) (handoff, tester note 1).
- 2026-10-04 · E00-T03 test · A schema transform or refinement that throws is logged with its message, and `JSON.parse` and `BigInt()` put the input in theirs (`new URL()` in an `input` field the logger keeps); handlers have the same trap. Zod: transforms use `ctx.addIssue`, never throw. Say so in `CLAUDE.md` before E01; E07-T07's log canary could include one (handoff, tester note 2).
- 2026-10-04 · E00-T03 test · A double submit runs an action twice, each with its own audit row: the wrapper does not make actions idempotent. E00-T04: forms disable submit while pending; E01-T02 and E01-T05: create actions need a client-made id or a duplicate check (handoff, tester note 3).
- ~~2026-10-04 · E00-T08 · `.js`, `.jsx`, `.mjs`, `.cjs` and `.cts` files in `src/` are outside tsconfig.json's `include`, so neither `tsc` nor the type-aware lint rules check them (none exist). A lint rule refusing them in `src/`, or adding them to tsconfig.json, would close it (D-074).~~ In E00-T10: a test fails on such a file in `src/` (D-077).
- 2026-10-04 · E00-T08 · A password change with `revokeOtherSessions` starts a new session and so writes `user.logged_in` rows; if they cannot be written, the change fails after the other sessions are already deleted. E04-T02: decide whether a password change should count as a login (D-074).
- 2026-10-04 · E00-T08 · Login rows are written one clinic at a time: when a later clinic's row fails, the sign-in fails but the earlier clinics keep a `user.logged_in` row for it. E07-T01 (audit viewer): a login row does not prove the sign-in completed (D-074).
- 2026-10-04 · E00-T08 · `eslint-rules/module-boundaries.mjs` keeps its own copy of the import-path helpers that the new `eslint-rules/import-paths.mjs` holds; a cleanup can switch it over (left untouched to keep the diff to the task).
- ~~2026-10-04 · E00-T08 review · No test pins that the proxy's server-action exception holds for POST only (`isServerAction()`, `src/proxy.ts`): a GET with a `Next-Action` header or a multipart content type should still be redirected; deleting the method check fails nothing (handoff, reviewer suggestion 1).~~ Covered by the tester's tests in `action-session-ended.test.ts`; the delta review removed the check and saw exactly those two fail (`handoffs/E00-T08.md`).
- ~~2026-10-04 · E00-T08 review · A signed-out multipart POST now reaches any page in the proxy's matcher (Next.js renders the page when the form names no action). Every page today checks the session itself; say in `CLAUDE.md` that a page outside `(staff)` must too, or be public on purpose, before E00-T04 adds pages (handoff, reviewer suggestion 2). **Delta review:** not so on Next.js 16.3.8, which answers such a post 500 without rendering the page (`areAllActionIdsValid()`, tester note 5); the sentence is defence in depth against a later version.~~ In `security-privacy.md` section 2 (planning, 2026-10-04) and, as a `CLAUDE.md` sentence, in E00-T04 (D-075).
- ~~2026-10-04 · E00-T08 review · `chairside/database-access` skips `src/db/` and `src/modules/auth/` whole, so a re-export of `withTenant` or `getDb` from a file there (the auth module's `index.ts`, say) would let every file import them unreported. Report such re-exports in those folders too (handoff, reviewer suggestion 3).~~ In E00-T10 (D-077).
- ~~2026-10-04 · E00-T08 review · An inline `eslint-disable` comment switches off any architecture rule, and nothing forbids one (none in `src/` today). `linterOptions.noInlineConfig` for `src/`, or a test that fails on `eslint-disable` in `src/`, would keep the guards on (handoff, reviewer suggestion 4).~~ In E00-T10: `noInlineConfig` for `src/` (D-077).
- ~~2026-10-04 · E00-T08 test · **Security, owner:** the login form (E00-T02) has only an `onSubmit` handler, so with JavaScript off the browser submits it as a GET with the email and password in the address: browser history, `pnpm dev`'s request log (seen), a host's access logs. Fix before staging (E00-T07), not with E00-T04 (handoff, tester note 1).~~ **Owner, 2026-10-04: its own task:** E00-T09, Ready (D-076).
- ~~2026-10-04 · E00-T08 test · The type-aware rules pass `tx.insert(…).catch(() => {})` and `.then(ok, fail)` (handled, like `void`) and `return Promise.reject({ cause: e })` (not a throw; its values would print). R-32's review check could name the first two; `@typescript-eslint/prefer-promise-reject-errors` (installed) reports the third (tester note 2).~~ In E00-T10, with a lint check for the first two (D-077).
- ~~2026-10-04 · E00-T08 test · `chairside/database-access` covers `@/db/client` and `withTenant` only: a file in `src/` can import `pg` or `drizzle-orm/node-postgres` and open its own connection, or import `@/db/reset` or `@/db/migrate`, unreported. Allow them only in `src/db/` (tester note 3).~~ In E00-T10 (D-077).
- ~~2026-10-04 · E00-T08 test · `chairside/server-actions` looks at `src/app` only: a Pages Router API route (`src/pages/api/…`), which Next.js 16 serves next to `src/app`, is not reported, and a `'use server'` file outside `src/` is not linted at all (tester note 4).~~ In E00-T10 (D-077).
- ~~2026-10-04 · E00-T08 test · Any client can make the server log "Failed to find Server Action" with a stack (answer 500) by posting multipart/form-data that names no action: at `/login` since E00-T02, and without a session at every path in the proxy's matcher since E00-T08. No page content is sent. E07-T03: do not alert on it, or answer such posts without an error (tester note 5).~~ In E00-T07 (not sent to Sentry; a runbook line) and E07-T03 (never an alert on its own); D-075.
- 2026-10-04 · planning · In Git Bash (the agents' Bash tool) on the owner's machine, `TZ=Pacific/Auckland` never reaches Node, which then runs in the machine's own zone; `TZ=UTC` does, and so does PowerShell's `$env:TZ`. Earlier "Auckland" or "Chatham" runs made from Git Bash (E00-T02, E00-T03 and E00-T08 tests) may not have used those zones. E00-T06a's CI runs the Auckland steps for real, and its `CLAUDE.md` gives the PowerShell form.
- 2026-10-04 · E00-T06a · `pnpm audit --prod` is green only because pnpm does not count `drizzle-kit` as production: it is our development dependency and also an optional peer of `better-auth`, and the full audit lists the esbuild advisory through both paths. If pnpm or better-auth changes that, `--prod` turns red over a tool's advisory and the pipeline stops for the owner.
- 2026-10-04 · E00-T06a · The "States:" line at the top of this board still reads `Built` → `Tested` → `Reviewed`, the order before D-065; `workflow.md` and the pipeline use `Built` → `Reviewed` → `Tested`.
- 2026-10-04 · E00-T06a review · Pipeline skill, CI wait step 4: "every name in `failed` starts with `pnpm `" is also true of an empty `failed`, which the next rule makes a Stop. Write "`failed` is not empty, and every name in it starts with `pnpm `" (handoff, reviewer suggestion 1).
- 2026-10-04 · E00-T06a review · Pipeline skill, CI wait step 2: the loop sends `gh`'s errors to `/dev/null`, so a `gh` that is not found in that shell or is logged out waits the full 10 minutes and stops as "no run"; and a pull request closed and reopened has two runs for one commit and branch, with no rule for which counts (take the newest, the first `gh run list` prints) (handoff, reviewer suggestion 2).
- 2026-10-04 · E00-T06a review · GitHub starts no `pull_request` run while the pull request has a merge conflict with `main`. Every role edits this board's "Last updated" line, so a planning branch merged during a task makes one likely, and the pipeline then stops with "no run 10 minutes after the push". Name a merge conflict as the first thing to check there (skill step 2, `workflow.md`) (handoff, reviewer suggestion 3).
- 2026-10-04 · E00-T06a review · `CLAUDE.md`'s Commands table still calls `pnpm check` "Everything a task must pass", and `builder.md`'s "When done" runs only that; CI also fails on `pnpm build`, the Auckland steps and `pnpm audit --prod`, so such a failure shows only in CI and costs a fix round. Point the row to "CI", or have builders also run `pnpm build` (handoff, reviewer suggestion 4).
- 2026-10-04 · E00-T06a review · `README.md`'s prerequisites say agents use `gh` "to open pull requests"; the pipeline now also needs it logged in to wait for CI (handoff, reviewer suggestion 5).
- 2026-10-04 · E00-T06a test · Pipeline skill, CI wait: a command that reaches its tool time limit is moved to the background and the call returns (Claude Code on the owner's machine); it is not ended, as the section says. Step 3 still works. A job cut off by `timeout-minutes` arrives as `cancelled`, the same answer as a newer push: only the run's annotation tells them apart (handoff, tester notes 1 and 2).
- 2026-10-04 · E00-T06a delta review · Pipeline skill, CI wait step 3: after its Stop for a queued run, the watch call that reached its limit keeps running in the background (line above) and reports to the stopped pipeline when GitHub completes the run, maybe hours later; the skill does not say what to do with that report. Run the watch in the background with a 600000 ms limit, as step 2's loop is, or say under "Stop" that a later report from an earlier command changes nothing (handoff, delta review suggestion 1).

---

## E00 · Foundation (M0)

Fully specified. A task becomes Ready when its dependencies are Done, except E00-T04 (to be split) and E00-T06b (an outline), which an architect refines first.

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E00-T01 | Create the project: skeleton, conventions, database foundation | builder | critical | **Reviewed** | Merged early (PR #1), reviewed after: no required changes, 4 suggestions (Discovered). Owner: the builder's 5 questions, then Done. See `handoffs/E00-T01.md` |
| E00-T02 | Login, sessions and clinic membership | builder | critical | **Done** | Merged by the owner (PR #5). Tester finding 6 → D-069, finding 2's page side → D-070; findings 5 and 7 on the Discovered list. See `handoffs/E00-T02.md` |
| E00-T03 | Action wrappers, permission checks, audit log | builder | critical | **Done** | Merged by the owner (PR #7). `staffAction`, `staffRead`, `userAction` in `src/app/_lib/actions.ts`; `audit.record()`; D-070 at the source; D-072. Review suggestions and tester notes on the Discovered list. See `handoffs/E00-T03.md` |
| E00-T08 | Guards around the action wrappers, and the login audit | builder | critical | **Done** | Merged by the owner (PR #9). Lint rules `chairside/server-actions`, `chairside/database-access` and three type-aware ones; login rows; an action after the session ended reaches its wrapper (D-074). Review suggestions and tester notes on the Discovered list. See `handoffs/E00-T08.md` |
| E00-T06a | CI: every pull request and `main` checked on GitHub | builder | normal | **Tested** | Branch `task/E00-T06a-ci`, PR #11: `.github/workflows/ci.yml`, green on the PR (about 4.5 minutes a run); the pipeline skill and `builder.md` wait for CI (D-075, D-078). Reviewed at `3110144`: 1 required change (skill, CI wait step 3: a run that stays queued never stops it), fixed in fix round 1; 5 suggestions (Discovered). Tested at `b5c5508`: no findings; scratch PR #12 (red, cancelled and Auckland-only runs) closed unmerged. Delta review of `3110144..5e280f8`: approved, 1 suggestion (Discovered). Next: CI wait (Finish), then the owner merges PR #11. Owner: Actions budget. See `handoffs/E00-T06a.md` |
| E00-T09 | The login form never puts the password in the URL | builder | critical | **Ready** | From E00-T08's test, note 1 (owner: its own task, before staging). Form posts, button disabled until the script runs, lint for every form (D-076). See `handoffs/E00-T09.md` |
| E00-T10 | Close the gaps in the lint guards | builder | critical | **Ready** | From E00-T08's review (suggestions 3, 4), test (notes 2–4) and builder (`.js` files) (D-077). See `handoffs/E00-T10.md` |
| E00-T04 | App shell and design system | builder | normal | Planned | After E00-T09 and E00-T10. Too big for one session as written (D-075): split when it is refined |
| E00-T05 | Seed data and clinic provisioning script | builder | normal | Planned | After E00-T10 (D-075). Refined before it starts |
| E00-T06b | Playwright and the first end-to-end journey (J1) | builder | normal | Planned | Split from E00-T06 (D-075); after E00-T04 and E00-T05 |
| E00-T07 | Staging: web, worker, database deployed | builder + owner | critical | Planned | Owner: hosting accounts (Q-07). After E00-T05, E00-T06b and E00-T09 |

## E01 · Scheduling (M1)

Fully specified.

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E01-T01 | Schema: providers, treatment types, patients, appointments, hours | builder | critical | Planned | |
| E01-T02 | Patients: list, search, create, edit | builder | normal | Planned | |
| E01-T03 | Patient profile | builder | normal | Planned | |
| E01-T04 | Calendar: day view | builder | normal | Planned | |
| E01-T05 | Book an appointment (drawer) | builder | normal | Planned | |
| E01-T06 | Appointment drawer: details, move, status changes | builder | critical | Planned | |
| E01-T07 | Calendar: week view | builder | low | Planned | |
| E01-T08 | Settings: clinic details, opening hours, closed days | builder | normal | Planned | |
| E01-T09 | Settings: providers and treatment types | builder | normal | Planned | |
| E01-T10 | Today screen, first version | builder | normal | Planned | |
| E01-T11 | Journey J2 and a hard look at scheduling | tester | normal | Planned | Owner: receptionist trial if possible (Q-09) |

## E02 · Reminder loop (M2)

Fully specified.

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E02-T01 | Schema: rules, templates, messages, links, consents, tasks | builder | critical | Planned | |
| E02-T02 | Send-time calculation (pure functions) | builder | critical | Planned | |
| E02-T03 | Template rendering | builder | normal | Planned | Channel-aware (D-055) |
| E02-T04 | Channel adapter interface, fake adapter, outbox viewer | builder | normal | Planned | |
| E02-T05 | Consent, objections, contact checks | builder | critical | Planned | |
| E02-T06 | Planner: reminders planned, re-planned, cancelled | builder | critical | Planned | |
| E02-T07 | Dispatcher: send what is due, safely | builder | critical | Planned | |
| E02-T08 | Patient link tokens | builder | critical | Planned | Q-03 (temporary domain ok) |
| E02-T09 | Patient appointment page: confirm and cancel | builder | critical | Planned | Q-14 assumption |
| E02-T10 | "Ask for another time" and the tasks module | builder | normal | Planned | |
| E02-T11 | Booking confirmation message | builder | normal | Planned | |
| E02-T12 | Messages on the staff side | builder | normal | Planned | |
| E02-T13 | Today: "Needs a call" and "Needs attention" | builder | normal | Planned | |
| E02-T14 | Journeys J3, J4 and trying to break messaging | tester | critical | Planned | |

## E03 · Real channels (M3)

Outline. WhatsApp + email (D-055). Needs E03-T00 (refinement), Q-08, Meta verification.

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E03-T00 | Refine this epic | architect | low | Planned | |
| E03-T01 | Choose the WhatsApp route and the email provider | architect + owner | normal | Ready | Can run any time; owner starts Meta verification in parallel |
| E03-T02 | Email adapter and email layout | builder | critical | Planned | |
| E03-T03 | WhatsApp adapter and template registry | builder | critical | Planned | |
| E03-T04 | Webhooks: delivery status and replies | builder | critical | Planned | |
| E03-T05 | Sending caps, usage, non-production allow-list | builder | critical | Planned | Q-04 assumption |
| E03-T06 | Settings: message channels and quiet hours | builder | normal | Planned | |
| E03-T07 | Opt-out by link | builder | critical | Planned | |
| E03-T08 | Unreachable patients, invalid contacts, failed messages (staff side) | builder | normal | Planned | |
| E03-T09 | Live test on staging | tester + owner | critical | Planned | |
| E03-T10 | SMS adapter | builder | critical | Planned | **Deferred to v1.1**: do not start; exists so SMS can be added any time (D-055) |

## E04 · Clinic onboarding (M4)

Outline. Needs E04-T00. Can run in parallel with E02/E03 (different modules).

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E04-T00 | Refine this epic | architect | low | Planned | Must add the future-appointments task (D-050) |
| E04-T01 | Schema: invites and import staging | builder | critical | Planned | |
| E04-T02 | Staff: invite, roles, deactivate, password reset | builder | critical | Planned | |
| E04-T03 | Two-factor authentication | builder | critical | Planned | |
| E04-T04 | Import: upload and parse | builder | normal | Planned | |
| E04-T05 | Import: match columns | builder | normal | Planned | |
| E04-T06 | Import: clean, validate, find duplicates | builder | critical | Planned | |
| E04-T07 | Import: review problems | builder | normal | Planned | |
| E04-T08 | Import: confirm, commit, undo | builder | critical | Planned | |
| E04-T09 | Fast manual entry | builder | low | Planned | |
| E04-T10 | Journeys J5, J6 and a messy-file bash | tester | normal | Planned | |

## E05 · Recalls and follow-ups (M5)

Outline. Needs E05-T00.

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E05-T00 | Refine this epic | architect | low | Planned | Builds on D-052 assumptions |
| E05-T01 | Schema: care plans | builder | critical | Planned | |
| E05-T02 | Due dates and recall eligibility (pure functions) | builder | critical | Planned | |
| E05-T03 | Care plans screen and the profile card | builder | normal | Planned | |
| E05-T04 | Planner: recalls, nudge, frequency cap, priority | builder | critical | Planned | |
| E05-T05 | Recall start gate and batch release | builder | critical | Planned | Needs E04-T08 |
| E05-T06 | Patient page "Ask for a visit" and attribution | builder | normal | Planned | |
| E05-T07 | Missed-visit follow-up | builder | normal | Planned | |
| E05-T08 | Automations screen: rule list and editor | builder | normal | Planned | |
| E05-T09 | Today: "Due for a visit" and manual nudge | builder | normal | Planned | |
| E05-T10 | Results panel: measured numbers | builder | normal | Planned | |
| E05-T11 | Journey J7 and recall edge cases | tester | critical | Planned | |

## E06 · Treatment plans and aftercare (M6)

Outline. Needs E06-T00, Q-13. Only dentists approve (D-051). May ship after go-live (cut line).

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E06-T00 | Refine this epic | architect | low | Planned | |
| E06-T01 | Schema: treatment plans, visit treatments, aftercare | builder | critical | Planned | |
| E06-T02 | Treatment plan on the patient profile | builder | normal | Planned | |
| E06-T03 | Visit wrap-up ("In the chair", light) | builder | normal | Planned | |
| E06-T04 | Aftercare library | builder | normal | Planned | |
| E06-T05 | AI drafting module | builder | critical | Planned | |
| E06-T06 | AI evals | tester | critical | Planned | |
| E06-T07 | Drafts created when a visit is finished | builder | critical | Planned | |
| E06-T08 | Review, approve, send | builder | critical | Planned | |
| E06-T09 | Patient aftercare page and email | builder | normal | Planned | |
| E06-T10 | Journey J8 and aftercare edge cases | tester | critical | Planned | |

## E07 · Pilot readiness (M7)

Outline. Needs E07-T00.

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E07-T00 | Refine this epic | architect | low | Planned | |
| E07-T01 | Audit log viewer and coverage check | builder | normal | Planned | |
| E07-T02 | Backups and a real restore drill | owner + builder | critical | Planned | |
| E07-T03 | Canary, alerts and operator numbers | builder | critical | Planned | |
| E07-T04 | Retention jobs | builder | critical | Planned | |
| E07-T05 | Patient export and anonymise | builder | critical | Planned | |
| E07-T06 | Security review pass | reviewer | critical | Planned | |
| E07-T07 | No personal data leaves through logs | tester | critical | Planned | |
| E07-T08 | Size check | tester | normal | Planned | |
| E07-T09 | Production environment and the go-live gate | owner + builder | critical | Planned | Q-03, Q-07 |
| E07-T10 | Legal pack | owner | critical | Planned | Deferred by owner (D-052); decide at go-live |

## Done

- E00-T02 · Login, sessions and clinic membership · merged 2026-10-03 (PR #5)
- E00-T03 · Action wrappers, permission checks and audit log · merged 2026-10-04 (PR #7)
- E00-T08 · Guards around the action wrappers, and the login audit · merged 2026-10-04 (PR #9)

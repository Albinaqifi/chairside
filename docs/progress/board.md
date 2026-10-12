# Board

The **only** place task status lives. Update your task's row when you start and when you
finish. Keep notes to one short line; details go in the handoff note.

States: `Planned` → `Ready` → `In progress` → `Built` → `Reviewed` → `Tested` → `Done`, or `Blocked`.
(See `docs/process/workflow.md`.) Things noticed outside a task: `discovered.md`, next to this file.

## Now

- **Milestone:** M0 Foundation, with M1's first tasks (D-087)
- **Next task to start:** `E01-T04a` (Ready): `/pipeline E01-T04a`. E00-T07f (Ready) and E00-T07c wait for the Render and monitor accounts (owner, D-109)
- **Decisions it waits on:** none
- **The first Monday run with the journeys** (2026-10-12) is the first in Firefox and WebKit on Linux, with the D-093 check's WebKit Back control (E00-T06b, `data`): the next architect pass reads it (D-100's "Revisit if")

## Next (in order)

1. E00-T07f, then E00-T07c, once the owner has the Render and monitor accounts ("Owner actions"; not yet on 2026-10-11): E00-T07f needs no account but goes right before staging (owner, D-109); until then the rest of E01 goes first
2. The rest of E01, in the epic's own order (D-087): E01-T04a (Ready), then E01-T04b (refined in E01-T04a's Done pass, D-108); E00-T06c before the first journey that sets "now" (D-100)
3. E00-T12, before E02 (owner, 2026-10-03; D-102)

## Blocked

| Task | Blocked by | Who must act |
|---|---|---|
| E03-T02 … T09 | Q-08 providers (decided in E03-T01) and Meta business verification | Owner + architect |

## E00 · Foundation (M0)

Fully specified. A task becomes Ready when its dependencies are Done, except the outlines, refined before they start: E00-T06c with the first journey that sets "now" (D-100); E00-T07c, once the owner has its accounts (D-105), and E00-T12 (D-102).

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E00-T01 | Create the project: skeleton, conventions, database foundation | builder | critical | **Done** | Merged early (PR #1), reviewed after: no required changes, 4 suggestions (Discovered). The owner accepted the builder's 5 answers (D-087). See `handoffs/E00-T01.md` |
| E00-T02 | Login, sessions and clinic membership | builder | critical | **Done** | Merged by the owner (PR #5). Tester finding 6 → D-069, finding 2's page side → D-070; findings 5 and 7 on the Discovered list. See `handoffs/E00-T02.md` |
| E00-T03 | Action wrappers, permission checks, audit log | builder | critical | **Done** | Merged by the owner (PR #7). `staffAction`, `staffRead`, `userAction` in `src/app/_lib/actions.ts`; `audit.record()`; D-070 at the source; D-072. Review suggestions and tester notes on the Discovered list. See `handoffs/E00-T03.md` |
| E00-T08 | Guards around the action wrappers, and the login audit | builder | critical | **Done** | Merged by the owner (PR #9). Lint rules `chairside/server-actions`, `chairside/database-access` and three type-aware ones; login rows; an action after the session ended reaches its wrapper (D-074). Review suggestions and tester notes on the Discovered list. See `handoffs/E00-T08.md` |
| E00-T06a | CI: every pull request and `main` checked on GitHub | builder | normal | **Done** | Merged by the owner (PR #11). `.github/workflows/ci.yml` checks every pull request, every push to `main` and every Monday; the pipeline skill and `builder.md` wait for green (D-075, D-078). Review suggestions and tester notes in `discovered.md`. See `handoffs/E00-T06a.md` |
| E00-T09 | The login form never puts the password in the URL | builder | critical | **Done** | Merged by the owner (PR #15). The form posts to `/login`, its button is disabled until the script runs, a `<noscript>` line; lint `chairside/forms-post` for every form (D-076, D-080). The review suggestion and the tester's `next/form` line → E00-T10 (D-081). See `handoffs/E00-T09.md` |
| E00-T10 | Close the gaps in the lint guards | builder | critical | **Done** | Merged by the owner (PR #17). Re-exports and drivers, lint comments, rejections and `.catch`/`.finally` statements, `src/pages`, script files in `src/`, `formAction`, spreads and `next/form` (D-077, D-081, D-082). Its leftovers → E00-T11 (D-084); four struck. See `handoffs/E00-T10.md` |
| E00-T11 | Components in the form lint, and the gaps E00-T10 left | builder | critical | **Done** | Merged by the owner (PR #20). Components and generic spreads in the form lint, `export default` of a handle, drivers passed on from `src/db/`, `'use server'` `.tsx` files, lint comments everywhere, whole case names (D-084, D-085). Its blind spots stay review checks (owner, D-086); two comments → E00-T04a; `CLAUDE.md` rule 7 and R-32 corrected. See `handoffs/E00-T11.md` |
| E00-T04 | App shell and design system | builder | normal | split (D-086) | Into E00-T04a … E00-T04e, the next five rows (E00-T04d split again, D-093) |
| E00-T04a | Tokens, fonts, texts and the login page | builder | normal | **Done** | Merged by the owner (PR #23). Tokens in `globals.css`, local fonts, next-intl, Button, Input, Label, both pages restyled, favicon, text and accessibility lint (D-088). Fonts with Cyrillic → E00-T04b (owner, D-089); other leftovers → E00-T04b, E00-T04c, E01-T02, E01-T04, `CLAUDE.md`; six struck. See `handoffs/E00-T04a.md` |
| E00-T04b | The staff shell: sidebar, navigation by role, placeholder pages | builder | normal | **Done** | Merged by the owner (PR #25). The staff layout, the sidebar by permission, Today and six placeholder pages, Card, Badge, the empty state, Onest and Source Serif 4 (D-089). Leftovers → E00-T04c (the clinic a form sends), E01-T01 (the provider link); five struck. See `handoffs/E00-T04b.md` |
| E00-T04c | The form pattern, the toast and the components page | builder | critical | **Done** | Merged by the owner (PR #33). `StaffForm` and `StaffField` send the frame's clinic and show each answer one way, Send once and only after the script (D-092); the toast; `/dev/components`. Leftovers → E00-T04d (the browser's memory off, owner, D-093; one submit button), E01-T02 (every action × every role; a form cleared after done), E01-T05, E01-T09, `CLAUDE.md`'s review checks; two done by its tester, eight struck. See `handoffs/E00-T04c.md` |
| E00-T04d | The form fields: textarea, select, checkbox and switch | builder | critical | **Done** | Merged by the owner (PR #35). Textarea, the browser's own select, Radix's checkbox and switch, `StaffForm`'s form `autocomplete="off"` (D-093), one submit button, `lucide-react` (D-094). Leftovers → E01-T02, E01-T05, E00-T06b, `CLAUDE.md`, `security-privacy.md` (nothing typed about a patient stays in the browser, D-095); the controls' light edges kept (owner); one done by its tester, six struck. See `handoffs/E00-T04d.md` |
| E00-T04e | Tabs, the drawer and the dialog | builder | normal | **Done** | Merged by the owner (PR #37). `Tabs`, the drawer (`Sheet`) and `Dialog` in `src/ui/`, on `/dev/components`, a title always; the owner tried it. Leftovers → E01-T05 (a double click keeps the drawer open; a form in a drawer or dialog sends only itself, `message`), E01-T06, E00-T06b (one login per role and browser); one done by its tester, seven struck. See `handoffs/E00-T04e.md` |
| E00-T05 | Seed data and clinic provisioning script | builder | normal | split (D-090) | Into E00-T05a and E00-T05b, the next two rows |
| E00-T05a | Seed data: two clinics and a login for every role | builder | normal | **Done** | Merged by the owner (PR #27). `pnpm db:seed` and `db:reset` seed two clinics and a login for every role, under fixed ids (owner's answer (a)). Leftovers → E01-T01b, E03-T00 (`message`), `CLAUDE.md`, agent rule 5; six struck. See `handoffs/E00-T05a.md` |
| E00-T05b | `clinic:create`: the operator's script for a new clinic | builder | critical | **Done** | Merged by the owner (PR #46). `main` green (run 38048731658). `pnpm clinic:create` writes as the app role (migration 0004) and prints a one-time link to `/login/set-password`, where the first owner chooses a password (D-101); the logger's plurals; the owner tried it. Leftovers → E00-T07c (the link out of the host's logs), E01-T08 (`message`: a zone stored as Intl names it), E00-T12 (new: the logger's net before E02), `security-privacy.md` (who may call `addMembership()` and `createSetupLink()`); two `data` lines → E04-T00; eight struck. See `handoffs/E00-T05b.md` |
| E00-T06b | Playwright and the first end-to-end journey (J1) | builder | normal | **Done** | Merged by the owner (PR #44). `main` green (run 37931330789). `pnpm test:e2e`: J1 with the keyboard alone and without JavaScript, axe-core, the D-093 check with its controls, in three browsers on `<db>_e2e`; CI runs Chromium after the build, the Monday run all three (D-100); four fix rounds, all for runs red without a fault. Leftovers: the `data` line → the first Monday run (Now) and E07-T00 (Safari by hand); three `none` lines → `README.md` and `test-strategy.md`; the owner's PATH, optional; nine struck. E00-T05b refined on the same branch (D-101). See `handoffs/E00-T06b.md` |
| E00-T06c | A clock the end-to-end journeys set | builder | critical | Planned | Split from E00-T06b (D-100). Before the first journey that sets "now" (E01-T11's J2 or E02-T14's J3), refined with it |
| E00-T07 | Staging: web, worker, database deployed | builder + owner | critical | split (D-102) | Into E00-T07a … E00-T07c, the next rows, with E00-T07d and E00-T07e added in E00-T07b's Done pass (D-105) and E00-T07f in E00-T07e's (D-109); Sentry → E07-T03 (owner, not now) |
| E00-T07a | The image, the health check and the start-up refusals | builder | critical | **Done** | Merged by the owner (PR #48). `main` green (run 38071390166). One image for the web and `clinic:create`, tsx in it (D-103); `/api/health` for the host, never waiting on the worker; a login past the policies, or over https as the auth library reads it the example secret, a short one or `BETTER_AUTH_SECRETS`, fails it; three fix rounds. Leftovers → E00-T07c (`data` ×3: the login check by the session's login, `BETTER_AUTH_TRUSTED_ORIGINS` refused, the clinic cookie's Secure; four `none` facts for its Ready pass), E00-T07b (a trap in the builder's notes); eight struck. See `handoffs/E00-T07a.md` |
| E00-T07b | The worker and its job queue | builder | critical | **Done** | Merged by the owner (PR #50). `main` **red** on one timing-dependent test of this task, fixed by E00-T07d (run 38138989218; the pull request's head was green, run 38093609496, same tree; D-105). pg-boss 12.37.1 in `src/db/queue.ts`: its schema by migration 0005 with fixed table names, never changed while it runs; a failed job keeps a code; the worker refuses a login past the policies; a heartbeat once a minute; SIGTERM stops it. Leftovers → E00-T07d (the red test), E02-T06 and E02-T07 (`message` ×3: the job's signal, `expireInSeconds`, the queue's warnings), E00-T07c (the monitor's timings, the host's stop wait), `docs/runbook.md` (two `none` corrections); one struck. See `handoffs/E00-T07b.md` |
| E00-T07d | The job-past-its-time test does not depend on timing | builder | normal | **Done** | Merged by the owner (PR #52). `main` green again (run 38169317311). Every case of `queue.test.ts` follows the job its handler got, by id, so a minute boundary's second job cannot turn it red (D-106; the owner widened it to the whole file, D-107); a test only, two fix rounds for CI. Leftovers → D-107 (D-106's wording; the convention in `test-strategy.md`), the epic section's "As built" line; `worker.test.ts`'s two stop cases a review check (D-107's "Revisit if"); four struck. See `handoffs/E00-T07d.md` |
| E00-T07e | The start-up refusals' last gaps | builder | critical | **Done** | Merged by the owner (PR #54). `main` green (run 38190640837). The health check and the worker judge the session's login too, so a role set when it connects no longer passes; `BETTER_AUTH_TRUSTED_ORIGINS` refused over http and https; the clinic cookie Secure exactly when the library's are (`readAsHttps()`); no fix round. Leftovers → E00-T07f (new, `data`: `TEST` switches the library's origin check off; owner: right before staging, D-109); three struck. See `handoffs/E00-T07e.md` |
| E00-T07f | The auth library's origin check stays on | builder | critical | **Ready** | From E00-T07e's review (`data`, D-109): `TEST` or `NODE_ENV=test` switch the library's origin and CSRF checks off, on a host too; two settings in `createAuth()` keep them on, in every test as well. Runs right before E00-T07c, once the owner has the accounts (owner, 2026-10-12). See `handoffs/E00-T07f.md` |
| E00-T07c | Staging on Render | builder + owner | critical | Planned | From E00-T07 (D-102). The smallest paid plans for the web, the worker and the database (owner, 2026-10-11, D-105); owner: the Render and monitor accounts next ("Owner actions", Q-07). A database that lowers Cyrillic (E01-T02a); the sign-in limit's client address (E00-T02); the setup link out of the host's logs (E00-T05b); the heartbeat's monitor and its timings, and the host's wait against the worker's 20 s (E00-T07b). The refusals' last gaps were E00-T07e; the library's origin check is E00-T07f, right before it (D-109). Refined when the owner has the accounts |
| E00-T12 | The logger's net before messaging | builder | normal | Planned | Before E02 (owner, 2026-10-03): `URL` and `Buffer` values, the messaging and link names, the plurals of whole names (E00-T01, E00-T05b; D-102) |

## E01 · Scheduling (M1)

Fully specified.

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E01-T01 | Schema: providers, treatment types, patients, appointments, hours | builder | critical | split (D-091) | Into E01-T01a and E01-T01b, the next two rows |
| E01-T01a | Schema: providers, treatment types, patients, appointments, hours | builder | critical | **Done** | Merged by the owner (PR #29). Seven scheduling tables with their policies and the no-double-booking constraint (migration 0002); the provider kind through `clinics_for_user()`. Leftovers → E01-T02, E01-T04, E01-T05, E01-T10, E02-T01; the appointments indexes → E07-T00; one done by its tester, five struck. See `handoffs/E01-T01a.md` |
| E01-T01b | The scheduling seed: providers, patients and a week of appointments | builder | normal | **Done** | Merged by the owner (PR #31). `02-scheduling.ts`: three providers, 40 patients and a week of appointments for the seed's day; dentist and hygienist linked. Leftovers: the aftercare flags on the Discovered list (→ E06-T00), the fake-data check's two blind spots a review check in `security-privacy.md`; six struck. See `handoffs/E01-T01b.md` |
| E01-T02 | Patients: list, search, create, edit | builder | critical | split (D-096) | Into E01-T02a and E01-T02b, the next two rows; editing moved to E01-T03 |
| E01-T02a | Patients: the list and the search | builder | critical | **Done** | Merged by the owner (PR #39). `main` green (run 37747287624). The list and its search at `/patients`, the clinic's zone for every page, every action tested as every member, migration 0003 (the trigram indexes gone), the logger's net (D-096, D-097). Leftovers → E01-T02b, E00-T05b, E00-T07, E01-T04, E01-T08, `CLAUDE.md` and `security-privacy.md` (D-098); two search lines and the owner's Latin/Cyrillic request on the Discovered list for later, a `data` line → E04-T00, E07-T00; the search's input to be renamed `text` in E01-T02b (owner); nine struck. See `handoffs/E01-T02a.md` |
| E01-T02b | Patients: add a patient | builder | normal | **Done** | Merged by the owner (PR #41). `main` green (run 37806088255). `/patients/new` and `patients.create`: the phone read with the clinic's country, a likely duplicate named before Send, `patient.created`; the list's New patient and each render's rows; the logger's net, the search's input `text`; the owner tried it. Leftovers: four kept on the Discovered list (→ E01-T09, E01-T11, E04-T00), three related lines folded into two of them, two into tasks (E00-T05b: the logger's net, `data`; E00-T07: a noise line), four struck. See `handoffs/E01-T02b.md` |
| E01-T03 | Patient profile, and editing a patient's details | builder | normal | Planned | Editing from E01-T02 (D-096) |
| E01-T04 | Calendar: day view | builder | normal | split (D-108) | Into E01-T04a and E01-T04b, the next two rows |
| E01-T04a | Calendar: the day view | builder | normal | **Ready** | From E01-T04 (D-108). The day from four modules in the clinic's zone (DST tested, a zone behind UTC), the grid with breaks, overlaps side by side, hours and closed days, % booked, Previous / Today / Next by `?day=`; the day helpers moved to `src/lib/` (no third copy). See `handoffs/E01-T04a.md` |
| E01-T04b | Calendar: the filter, a provider's own column, the "now" line and a fresh day | builder | normal | Planned | From E01-T04 (D-108): read again when used, never on a timer, so the 30-minute sign-out holds (owner, 2026-10-11). Refined in E01-T04a's Done pass |
| E01-T05 | Book an appointment (drawer) | builder | normal | Planned | The patient search keeps nothing in the browser (D-095); a double click keeps the drawer open; a form in a drawer or dialog sends only itself (E00-T04e) |
| E01-T06 | Appointment drawer: details, move, status changes | builder | critical | Planned | The cancel dialog sends the cancel only (E00-T04e) |
| E01-T07 | Calendar: week view | builder | low | Planned | |
| E01-T08 | Settings: clinic details, opening hours, closed days | builder | normal | Planned | A time zone and a phone country the code knows (E01-T02a); a zone stored as Intl names it, never an offset, in `clinic:create` too (E00-T05b review, `message`) |
| E01-T09 | Settings: providers and treatment types | builder | normal | Planned | |
| E01-T10 | Today screen, first version | builder | normal | Planned | |
| E01-T11 | Journey J2 and a hard look at scheduling | tester | normal | Planned | Owner: receptionist trial if possible (Q-09). E00-T06c first if J2 sets "now" (D-100) |

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
| E02-T14 | Journeys J3, J4 and trying to break messaging | tester | critical | Planned | The clock from E00-T06c (D-100) |

## E03 · Real channels (M3)

Outline. WhatsApp + email (D-055). Needs E03-T00 (refinement), Q-08, Meta verification.

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E03-T00 | Refine this epic | architect | low | Planned | Puts the non-production allow-list before the first real adapter (E00-T05a review) |
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
| E07-T03 | Canary, alerts and operator numbers | builder | critical | Planned | Sentry (EU), moved from E00-T07 (owner, not now; D-102) |
| E07-T04 | Retention jobs | builder | critical | Planned | |
| E07-T05 | Patient export and anonymise | builder | critical | Planned | |
| E07-T06 | Security review pass | reviewer | critical | Planned | |
| E07-T07 | No personal data leaves through logs | tester | critical | Planned | |
| E07-T08 | Size check | tester | normal | Planned | |
| E07-T09 | Production environment and the go-live gate | owner + builder | critical | Planned | Q-03, Q-07 |
| E07-T10 | Legal pack | owner | critical | Planned | Deferred by owner (D-052); decide at go-live |

## Done

- E00-T01 · Create the project: skeleton, conventions, database foundation · merged 2026-10-03 (PR #1)
- E00-T02 · Login, sessions and clinic membership · merged 2026-10-03 (PR #5)
- E00-T03 · Action wrappers, permission checks and audit log · merged 2026-10-04 (PR #7)
- E00-T08 · Guards around the action wrappers, and the login audit · merged 2026-10-04 (PR #9)
- E00-T06a · CI: every pull request and `main` checked on GitHub · merged 2026-10-04 (PR #11)
- E00-T09 · The login form never puts the password in the URL · merged 2026-10-05 (PR #15)
- E00-T10 · Close the gaps in the lint guards · merged 2026-10-05 (PR #17)
- E00-T11 · Components in the form lint, and the gaps E00-T10 left · merged 2026-10-05 (PR #20)
- E00-T04a · Tokens, fonts, texts and the login page · merged 2026-10-06 (PR #23)
- E00-T04b · The staff shell: sidebar, navigation by role, placeholder pages · merged 2026-10-06 (PR #25)
- E00-T05a · Seed data: two clinics and a login for every role · merged 2026-10-06 (PR #27)
- E01-T01a · Schema: providers, treatment types, patients, appointments, hours · merged 2026-10-06 (PR #29)
- E01-T01b · The scheduling seed: providers, patients and a week of appointments · merged 2026-10-06 (PR #31)
- E00-T04c · The form pattern, the toast and the components page · merged 2026-10-07 (PR #33)
- E00-T04d · The form fields: textarea, select, checkbox and switch · merged 2026-10-07 (PR #35)
- E00-T04e · Tabs, the drawer and the dialog · merged 2026-10-07 (PR #37)
- E01-T02a · Patients: the list and the search · merged 2026-10-08 (PR #39)
- E01-T02b · Patients: add a patient · merged 2026-10-08 (PR #41)
- E00-T06b · Playwright and the first end-to-end journey (J1) · merged 2026-10-09 (PR #44)
- E00-T05b · `clinic:create`: the operator's script for a new clinic · merged 2026-10-10 (PR #46)
- E00-T07a · The image, the health check and the start-up refusals · merged 2026-10-10 (PR #48)
- E00-T07b · The worker and its job queue · merged 2026-10-11 (PR #50)
- E00-T07d · The job-past-its-time test does not depend on timing · merged 2026-10-11 (PR #52)
- E00-T07e · The start-up refusals' last gaps · merged 2026-10-12 (PR #54)

## Owner actions (standing)

- **GitHub Actions budget (D-075):** when the free minutes run out, add a payment method and a small budget (for example $10 a month), then decide on GitHub Pro (R-34). Optional: in the repository's Settings → Actions, require actions pinned to a full commit SHA and allow only GitHub's and pnpm's actions
- **Meta Business account, start now (long lead time):** create it, begin business verification, obtain one WhatsApp sending number for the product (D-055, D-056, R-28)
- **Owner, before E00-T07f and E00-T07c: the accounts (D-105, D-109).** The cost is decided: the smallest paid plan for the web, the worker and the database (owner, 2026-10-11). Still to do: create the Render account with those three services in Frankfurt, and the heartbeat monitor's account (Q-07). Once they exist, E00-T07f runs and E00-T07c is refined
- **E00-T02 test findings 5 and 7, still open:** finding 5 (the sign-in limit's client address is in E00-T07c; whether D-064 point 5, no per-account limit, stands: before E00-T07c) and finding 7 (self-rename: E04, or switch the route off sooner; on the Discovered list)

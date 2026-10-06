# Board

The **only** place task status lives. Update your task's row when you start and when you
finish. Keep notes to one short line; details go in the handoff note.

States: `Planned` → `Ready` → `In progress` → `Built` → `Reviewed` → `Tested` → `Done`, or `Blocked`.
(See `docs/process/workflow.md`.) Things noticed outside a task: `discovered.md`, next to this file.

## Now

- **Milestone:** M0 Foundation
- **Next task to start:** `E00-T04a` is Ready (`handoffs/E00-T04a.md`): `/pipeline E00-T04a`
- **Decisions it waits on:** none. Nothing blocks E00-T04a

## Next (in order)

1. E00-T04a
2. E00-T04b
3. E00-T05
4. E01-T01
5. E00-T04c
6. E00-T04d
7. E01-T02
8. E00-T06b
9. E00-T07
10. The rest of E01, in the epic's own order (D-087)

## Blocked

| Task | Blocked by | Who must act |
|---|---|---|
| E03-T02 … T09 | Q-08 providers (decided in E03-T01) and Meta business verification | Owner + architect |

## E00 · Foundation (M0)

Fully specified. A task becomes Ready when its dependencies are Done, except E00-T06b (an outline), which an architect refines first, and each part of E00-T04 after the first, refined in the Done pass of the task before it in the order (D-086, D-087).

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
| E00-T04 | App shell and design system | builder | normal | split (D-086) | Into E00-T04a … E00-T04d, the next four rows |
| E00-T04a | Tokens, fonts, texts and the login page | builder | normal | **Tested** | From E00-T04's split (D-086). Tokens in `globals.css`, local fonts, next-intl, Button, Input, Label, both pages restyled, favicon, text and accessibility lint; packages D-088. PR #23. Review: no required changes, 3 suggestions (Discovered). Test: no findings, 3 notes (Discovered). See `handoffs/E00-T04a.md` |
| E00-T04b | The staff shell: sidebar, navigation by role, placeholder pages | builder | normal | Planned | After E00-T04a, refined in its Done pass (D-086) |
| E00-T04c | The form pattern, the toast and the components page | builder | normal | Planned | After E01-T01 in the order (D-087), refined in its Done pass; depends on E00-T04b (D-086) |
| E00-T04d | The other components: fields, tabs, drawer and dialog | builder | normal | Planned | After E00-T04c, refined in its Done pass (D-086) |
| E00-T05 | Seed data and clinic provisioning script | builder | normal | Planned | After E00-T04b, before E01-T01 (D-087). Refined before it starts |
| E00-T06b | Playwright and the first end-to-end journey (J1) | builder | normal | Planned | Split from E00-T06 (D-075); needs E00-T04a … E00-T04d and E00-T05, comes after E01-T02 (D-087); takes E00-T04's automated accessibility check, its tool chosen with the owner (D-086) |
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

- E00-T01 · Create the project: skeleton, conventions, database foundation · merged 2026-10-03 (PR #1)
- E00-T02 · Login, sessions and clinic membership · merged 2026-10-03 (PR #5)
- E00-T03 · Action wrappers, permission checks and audit log · merged 2026-10-04 (PR #7)
- E00-T08 · Guards around the action wrappers, and the login audit · merged 2026-10-04 (PR #9)
- E00-T06a · CI: every pull request and `main` checked on GitHub · merged 2026-10-04 (PR #11)
- E00-T09 · The login form never puts the password in the URL · merged 2026-10-05 (PR #15)
- E00-T10 · Close the gaps in the lint guards · merged 2026-10-05 (PR #17)
- E00-T11 · Components in the form lint, and the gaps E00-T10 left · merged 2026-10-05 (PR #20)

## Owner actions (standing)

- **GitHub Actions budget (D-075):** when the free minutes run out, add a payment method and a small budget (for example $10 a month), then decide on GitHub Pro (R-34). Optional: in the repository's Settings → Actions, require actions pinned to a full commit SHA and allow only GitHub's and pnpm's actions
- **Meta Business account, start now (long lead time):** create it, begin business verification, obtain one WhatsApp sending number for the product (D-055, D-056, R-28)
- **E00-T02 test findings 5 and 7, still open:** finding 5 (rate-limit address: with E00-T07, and whether D-064 point 5 stands) and finding 7 (self-rename: E04, or switch the route off sooner). Both are on the Discovered list

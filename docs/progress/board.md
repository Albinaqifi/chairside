# Board

The **only** place task status lives. Update your task's row when you start and when you
finish. Keep notes to one short line; details go in the handoff note.

States: `Planned` → `Ready` → `In progress` → `Built` → `Tested` → `Reviewed` → `Done`, or `Blocked`.
(See `docs/process/workflow.md`.)

_Last updated: 2026-10-02 — planning complete, no code yet. Owner answered Q-01, Q-02, Q-05, Q-10, Q-17, deferred Q-06, chose WhatsApp first with one product number (D-049 to D-056)._

## Now

- **Milestone:** M0 Foundation
- **Next task to start:** `E00-T01` (builder, critical)
- **Owner action, start now (long lead time):** create the Meta Business account, begin
  business verification, obtain one WhatsApp sending number for the product (D-055, D-056, risk R-28).
- **Waiting on the owner:** nothing. Q-07 and Q-09 are open with working assumptions.

## Next (in order)

1. E00-T01 → E00-T02 → E00-T03
2. E00-T04, E00-T05, E00-T06 (any order) → E00-T07
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
- 2026-10-03 · E00-T01 · Next.js collects anonymous usage telemetry by default (`next dev`, `next build`). Owner to decide whether to turn it off (`NEXT_TELEMETRY_DISABLED=1`) locally, in CI and on staging.
- 2026-10-03 · E00-T01 · The app role may UPDATE every column of `clinics`, including `status`. E01-T08 (clinic settings) should decide whether staff may change all of them (column grants).
- 2026-10-03 · E00-T01 · Newer major versions exist than the stack uses: TypeScript 7, ESLint 10, drizzle-orm 1.0 (release candidate). Kept on the versions in D-059; an upgrade would be its own task.
- 2026-10-03 · E00-T01 · The agent guard (`.claude/settings.json`) covers fewer `.env` names than `.gitignore` (not e.g. `.env.staging`), and its PowerShell patterns miss a quoted file name (tester finding 11).
- 2026-10-03 · E00-T01 · `pnpm dev` listens on every network interface (the dev log shows a LAN address); `next dev -H 127.0.0.1` would keep it on this machine (tester finding 12).
- 2026-10-03 · E00-T01 · The logger writes a `URL` object under any key as its full address (link tokens), and a `Buffer` as bytes that decode back to text. Value shapes from tester finding 10; only the field names were in scope. **Owner, 2026-10-03: handle before E02** (link tokens arrive with E02-T08).
- ~~2026-10-03 · E00-T01 · `eslint-rules/architecture.test.ts` can hit its 60 s `beforeAll` limit when the file cache is cold (first run of a session on Windows: 56 s, once over 60 s); warm runs take about 2 s.~~ Fixed in E00-T01 on the owner's decision: limit raised to 3 minutes.
- 2026-10-03 · E00-T01 · Luxon also reads the clock when a date has no day: its docs show `DateTime.fromObject({ hour: 10 })` as "today at 10:00". Lint rule (a) does not catch it; check before E02 uses Luxon.

---

## E00 · Foundation (M0)

Fully specified. A task becomes Ready when its dependencies are Done.

| Task | Title | Role | Risk | Status | Notes |
|---|---|---|---|---|---|
| E00-T01 | Create the project: skeleton, conventions, database foundation | builder | critical | **Built** | Round 2: findings 1–5 and 8–10 fixed as the owner decided; 6, 7, 11, 12 recorded. Ready for the tester again. See `handoffs/E00-T01.md` |
| E00-T02 | Login, sessions and clinic membership | builder | critical | Planned | |
| E00-T03 | Action wrapper, permission checks, audit log | builder | critical | Planned | |
| E00-T04 | App shell and design system | builder | normal | Planned | |
| E00-T05 | Seed data and clinic provisioning script | builder | normal | Planned | |
| E00-T06 | CI and the first end-to-end test | builder | normal | Planned | Owner: create GitHub repo |
| E00-T07 | Staging: web, worker, database deployed | builder + owner | critical | Planned | Owner: hosting accounts (Q-07) |

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

_Nothing yet._

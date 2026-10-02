# Test strategy

Written from the quality lead's seat. The bugs that matter most here are **silent**: nothing
crashes, a patient simply does not get a reminder, or gets someone else's. So the strategy is:
make the dangerous logic easy to test, test it very hard, and put a human on the few places
where a mistake is unacceptable.

## Principles

1. **Test at the lowest level that can prove the thing.** Timing rules as pure functions, not
   through the browser.
2. **Real database in integration tests.** Constraints, Row-Level Security and `SKIP LOCKED`
   cannot be mocked honestly.
3. **Time is an input.** Tests set "now"; nothing waits for a real clock.
4. **Every bug gets a test first.** Reproduce it in a failing test, then fix.
5. **A test that was weakened to pass is worse than no test.** (Agent rule 8.)
6. **Synthetic data only**, from the seed generator.

## The levels

| Level | Tool | What belongs here | Runs |
|---|---|---|---|
| **Unit** | Vitest | Pure functions: send-time calculation, state machines, template rendering, channel fallback order, phone and date normalising, duplicate matching, recall due dates, permission table, prompt building | Every commit, seconds |
| **Property** | fast-check | Rules that must hold for *any* input (see below) | Every commit |
| **Integration** | Vitest + real Postgres (Docker) | Module functions with the database: tenant isolation, constraints, planner and dispatcher, webhooks, import commit and undo, the action wrapper | Every commit, about a minute |
| **End to end** | Playwright | A few complete user journeys through the real UI with the fake channel and a controllable clock | Every pull request |
| **AI evals** | Script + fixtures | Quality and safety of AI-drafted text | When a prompt or model changes, and before release |
| **Production checks** | Canary job, heartbeat | "Did what should have happened, happen?" | Continuously |

Keep the pyramid: many unit tests, fewer integration tests, a handful of end-to-end journeys.
End-to-end tests are slow and fragile; they prove the pieces are wired together, nothing more.

## What must be covered, by area

### Tenant isolation (critical)
- Meta-test: every table has `clinic_id` and a policy, or is on the allow-list.
- For each module: a user of clinic A tries to read, update, delete and **link to** clinic B's
  rows through the module's public functions. Every attempt fails or returns nothing.
- A query run without a tenant context returns no rows.
- The app's database role cannot update or delete `audit_log`.

### Permissions (critical)
- One table-driven test: for every action and every role, allowed or refused, matching the
  table in `scope-v1.md`. A new action without an entry fails the test.

### Message timing (critical)
Pure-function tables for `computeSendTime` and friends:
- Daylight-saving changes (last Sunday of March and October in the EU): a reminder around
  02:00–03:00; "day before" across the change.
- Appointments at 00:30 and 23:30; Monday 08:00 with a quiet Sunday; the day after a closed day.
- Booked after its reminder time: sent late, replaced by the confirmation, or skipped as too late.
- Quiet hours: reminders move earlier, everything else later.
- Recall month arithmetic: 31 August + 6 months; 29 February.
- **Hidden local time:** the whole suite runs with `TZ=UTC` and again with
  `TZ=Pacific/Auckland`. A difference means code used the server's time zone.

Property tests:
- A reminder is never scheduled after its appointment starts.
- No message is ever scheduled inside quiet hours.
- The next recall date is always after the last visit.
- Rendering a valid template with complete data never leaves a `{` in the output.

### Duplicates, retries, states (critical)
- Run the planner twice, and twice in parallel: the number of message rows does not change.
- Move an appointment: the old reminder is cancelled, exactly one new one exists.
- Two dispatchers at once: no row is sent twice.
- Temporary failure retries with growing delays; permanent failure stops; five failures end in `failed`.
- Same webhook event twice: status changes once.
- Appointment and message state machines: every invalid transition is rejected.
- Caps: at the limit, messages wait and an attention item appears; nothing is dropped.
- Channel fallback: a permanent failure on the first channel creates exactly one row on the next; disabling a channel re-plans without loss or duplicates.
- Non-production: a recipient off the allow-list is skipped.

### Patient links (critical)
- Expired, revoked, tampered and unknown tokens all show the same page.
- GET changes nothing (asserted by comparing database state).
- Confirm twice = confirmed once. Cancel after the cut-off is refused.
- A link for patient A cannot act on patient B's appointment.
- Rate limit triggers.

### Consent
- Marketing without a recorded yes is never sent. An opt-out between planning and sending
  stops the message. Consent rows are never updated, only added.

### AI boundary (critical)
- **Canary test:** build prompts for a patient whose every field is a unique marker string
  ("ZZNAME", "ZZPHONE"…). No marker may appear in the prompt. Run it as a property test over
  generated patients.
- A response that does not match the schema is rejected.
- A draft cannot become a message without an approval by a permitted role.
- Expired drafts cannot be approved.

### Import
- Fixture files that are deliberately messy: mixed encodings (Windows-1250), `;` and `,`
  delimiters, ambiguous dates, duplicates inside the file and against existing patients,
  siblings sharing a phone, missing contacts, a 20,000-row file.
- Nothing reaches `patients` before commit. Undo removes exactly what the import created.

### Logging
- Canary test: run a journey with marker values in patient fields, capture all log output and
  error-tracker payloads, assert no marker appears.

## End-to-end journeys (Playwright)

Keep this list short. Each runs against a fresh seeded database, the fake channel and a clock
the test controls.

| # | Journey | Added in |
|---|---|---|
| J1 | Log in, see Today, log out. Wrong password refused. | E00 |
| J2 | Front-desk day: add a patient, book, move, mark arrived, complete, cancel another, mark a no-show. | E01 |
| J3 | **The core loop:** book for tomorrow → advance the clock → planner and dispatcher run → open the patient link → confirm → the calendar shows Confirmed. Then the same with cancel. | E02 |
| J4 | Change request from the patient page appears in Needs attention; staff resolve it. | E02 |
| J5 | Import a messy file: map, review, commit, find a patient, undo. | E04 |
| J6 | Invite a staff member, they accept, set up 2FA, and see only what their role allows. | E04 |
| J7 | Recall: a patient becomes due → message → asks for a visit → staff book → counted as "recall became booking". | E05 |
| J8 | Aftercare: complete a visit → draft from template → approve → patient opens the page. And the AI path with the fake AI, approved by a dentist, refused for front desk. | E06 |

Patient pages are also checked at phone width and for basic accessibility (labels, contrast,
keyboard) with automated checks in the same runs.

## AI evals

AI output cannot be tested with exact matches. It is evaluated.

**What is evaluated:** the aftercare draft (structured: SMS text, intro, do, avoid,
call-us-if) and the rewrite actions (shorter, simpler, warmer).

**The set:** about 25 treatment types (common ones, rare ones, vague ones like "consultation",
and odd inputs such as an empty or nonsense name) × each supported language.

**Checks that are plain code (must all pass):**
- Valid against the schema; list lengths within limits.
- SMS starts with the greeting placeholder, ends with the link placeholder, within the length limit.
- Only allowed placeholders; none invented, none removed by a rewrite.
- Written in the requested language.
- At least two "call us if" warning signs.
- No patient-specific claims, no invented clinic facts (phone numbers, prices, names).
- No specific drug doses.

**Checks by a model acting as a strict reviewer (scored against a written rubric):**
- Plain words a nervous patient understands; no jargon.
- Advice is standard and cautious for that treatment; nothing dangerous or contradictory.
- Rewrites keep the medical meaning.
A minimum average score and **zero safety failures** are required.

**Human check:** before the pilot, a dentist reads the outputs for the ten most common
treatments once. Their corrections become reference examples in the set.

**When evals run:** on every change to a prompt, the model setting or the output schema;
before each release; never on every commit (they cost money and time). Results are saved with
the prompt version so two versions can be compared.

Unit and end-to-end tests use a **fake AI** that returns fixed, valid output. Evals are the
only tests that call the real model.

## What the owner reviews personally

Agents test and review everything. These areas additionally get the owner's own eyes on the
diff, because a mistake is unacceptable or cannot be undone:

| Area | Why |
|---|---|
| Every migration and every Row-Level Security policy | A wrong policy leaks another clinic's patients; a wrong migration loses data. |
| The tenant and action wrappers; login, sessions, 2FA, permissions | Everything else relies on them. |
| Send-time calculation, planner, dispatcher, retry logic | Silent failures and duplicate messages. |
| Patient link creation and lookup | The only thing protecting no-login pages. |
| Consent checks and opt-out handling | Legal exposure and trust. |
| The AI prompt builder, output validation, approval rule | Patient identity and unsafe advice. |
| Real provider adapters, webhook verification, caps and the kill switch | Real messages and real money. |
| Import commit, merge and undo | Bulk changes to patient records. |
| Retention, anonymise and delete jobs | Irreversible. |
| Anything touching production configuration or secrets | — |
| Every test that an agent proposes to change or remove | Rule 8. |

Your QA background is most valuable in exactly these places: read the tests first and ask
"what case is missing?" before reading the code.

## Before a release

- All checks green on `main`.
- End-to-end journeys green against staging.
- Evals green if anything AI-related changed.
- Manual smoke on staging with a real phone: reminder WhatsApp message and email arrive, links work.
- Migrations rehearsed against a copy of the staging database.
- For the first release: the full go-live gate in `security-privacy.md`.

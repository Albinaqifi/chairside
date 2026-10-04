# Decisions log

Append-only. A decision is never edited away: if it changes, add a new entry that says
"replaces D-0xx" and mark the old one **Superseded**. Anyone (agent or owner) who makes a
decision that affects more than their own task adds an entry here in the same change.

Format: **what** was decided, **why**, and what would make us **revisit** it.
"Origin" says where it came from: `stack` (new choice), `kept` (taken from the original
architecture), `changed` (differs from the original files), `process`.

---

## Part 1 — Technology stack

### D-001 · TypeScript everywhere, Node 24 LTS, pnpm, one repository, one package
- **Origin:** kept
- **Why:** One language for UI, server and worker means one set of types, one test runner and
  one thing for a solo developer (and agents) to know. One package avoids monorepo tooling.
- **Revisit if:** the worker needs a different runtime, or build times become painful.

### D-002 · Next.js (App Router) as a single app, plus a separate worker process from the same code
- **Origin:** kept
- **Why:** React is required for the frontend. Next.js gives the staff app, the public patient
  pages and the webhook endpoints in one deployable, and agents know it well. Time-based work
  (planning and sending messages, imports, AI calls) runs in a second process so a slow
  provider never slows the calendar. Business logic lives in plain TypeScript modules that
  both processes import; Next.js routes stay thin.
- **Revisit if:** the app must run as static files only, or the patient pages need to scale
  very differently from the staff app.

### D-003 · PostgreSQL, one database, shared tables, `clinic_id` on every row, Row-Level Security
- **Origin:** kept
- **Why:** Relational data with real constraints (unique keys, exclusion constraints, foreign
  keys) does safety work for us. One database means one migration path and one backup.
  Row-Level Security makes Postgres itself refuse to return another clinic's rows even if
  application code forgets a filter.
- **Revisit if:** a large clinic chain contractually demands a separate database.

### D-004 · Drizzle ORM with SQL migrations that are read and reviewed
- **Origin:** kept
- **Why:** Stays close to SQL, which makes Row-Level Security policies, exclusion constraints
  and `SKIP LOCKED` straightforward. Migrations are plain SQL files a human can review.
- **Revisit if:** agents repeatedly produce wrong queries with it.

### D-005 · Background jobs with pg-boss inside PostgreSQL, no Redis
- **Origin:** kept
- **Why:** One less service to run and back up. A job can be written in the same transaction
  as the data change that caused it, so the two can never get out of sync. Enough for tens of
  thousands of jobs a day.
- **Note:** pg-boss only *triggers* work (ticks, imports, AI drafts). The `messages` table is
  the source of truth for what is sent, not the job queue.
- **Revisit if:** job volume makes the queue a bottleneck.

### D-006 · Better Auth for login, sessions and two-factor; our own tables for clinics, memberships and roles
- **Origin:** kept, clarified
- **Why:** Password handling and sessions must not be home-made. Better Auth stores everything
  in our own EU database, so no extra company processes staff identities. Roles and clinic
  membership are our own tables because they are tied to tenant isolation.
- **Revisit if:** the library is abandoned or cannot do mandatory 2FA for owners.

### D-007 · Hosting on Render, Frankfurt region: one web service, one worker, managed PostgreSQL with point-in-time recovery. Everything runs from one Docker image.
- **Origin:** stack (the original recommended this as option A)
- **Why:** Least operations work for one person: deploys from git, managed database with
  backups, EU region. The Docker image keeps us portable to another host.
- **Trade-off:** Render is a US company (EU region, data processing agreement available).
  Some clinics or countries may prefer an EU-owned host. See Q-07.
- **Revisit if:** Q-07 says EU-owned only, or cost grows beyond a small VPS setup by a lot.

### D-008 · No file/object storage service in v1
- **Origin:** changed (the original had an S3-compatible bucket)
- **Why:** The only files in v1 are import spreadsheets of at most 10 MB. They are stored in
  PostgreSQL for the life of the import and deleted automatically. One less service, one less
  sub-processor, one less place for patient lists to leak from.
- **Revisit if:** X-rays, documents or large exports enter scope.

### D-009 · UI built with Tailwind CSS and shadcn/ui, using the demo's design tokens; fonts self-hosted; calendar grid is our own component
- **Origin:** kept, clarified
- **Why:** Fast, consistent UI with accessible primitives. The demo's colours, fonts and radii
  become design tokens so every screen matches it. Fonts are bundled at build time, because
  loading them from Google at runtime sends visitor IP addresses to a third party. The demo's
  day grid is simple absolute positioning; a paid calendar library is not needed.
- **Revisit if:** drag-and-drop scheduling becomes a must-have and is expensive to build.

### D-010 · Email and SMS behind small adapters; a fake adapter comes first; the real providers are chosen in epic E03
- **Status:** Amended by D-055 on 2026-10-02: the first real channels are WhatsApp and email; SMS is added later through the same adapter interface.
- **Origin:** kept, re-ordered
- **Why:** The right SMS provider depends on the first country (price, sender-name rules).
  That is the owner's decision (Q-01, Q-08). Building against a fake adapter first means the
  whole reminder loop is working and tested before any provider is chosen.
- **Default candidates:** an EU-based email service (for example Brevo) or Amazon SES in an EU
  region; for SMS, Infobip or Twilio. To be confirmed in task E03-T01.

### D-011 · AI drafting through the Anthropic (Claude) API, called only from the worker, model chosen by configuration, output validated
- **Origin:** kept, clarified
- **Why:** Good at short, careful instructional text and structured output. Calling only from
  the worker keeps the API key off the browser and makes the data boundary enforceable in one
  place. The model name lives in configuration so it can be changed without code changes. The
  response must match a strict schema or it is rejected.
- **Revisit if:** the provider's data terms are not acceptable (Q-13).

### D-012 · Tests: Vitest (unit and integration), real PostgreSQL in tests (Docker), Playwright (end to end), fast-check (property tests), a small eval harness for AI output
- **Origin:** kept, extended
- **Why:** Constraints and Row-Level Security can only be tested against a real database.
  See `docs/process/test-strategy.md`.

### D-013 · Sentry (EU region) for errors with patient data stripped; structured logs with pino; an external heartbeat check
- **Origin:** kept, extended
- **Why:** A solo operator must be told when something breaks. The heartbeat catches the case
  where the worker is dead and therefore cannot report its own failure.

### D-014 · GitHub private repository and GitHub Actions for CI
- **Origin:** stack
- **Why:** Standard, free at this size, well known to agents. See Q-16 if another host is preferred.

### D-015 · Translation-ready from day one (next-intl); each clinic has a locale, currency, time zone and default phone country
- **Origin:** changed (the demo is English with US formats only)
- **Why:** The first market is not decided (Q-01) and is unlikely to be US-English. Retrofitting
  translations and date/phone formats later touches every screen; doing it from the start is cheap.
  English is the first locale.

### D-016 · The schema is designed up front in `data-model.md` but created slice by slice; a meta-test enforces tenant rules on every table
- **Origin:** process
- **Why:** A reviewed target model keeps agents consistent. Creating each table together with
  the code and tests that use it avoids weeks of untested, speculative tables, and lets the
  owner review schema changes in small pieces. A test fails the build if any table lacks
  `clinic_id` and a Row-Level Security policy (unless it is on a short, explicit allow-list).

---

## Part 2 — Changes and clarifications to the original plan and design

### D-017 · Version 1 is scheduling plus patient communication. No dental chart, clinical notes, medical alerts or billing. The "In the chair" screen becomes a light "visit wrap-up".
- **Origin:** changed (demo v3 added a full clinical visit screen; the architecture has no
  tables for it and explicitly warned against that scope)
- **Why:** Storing clinical findings makes Chairside a legal medical record with long retention
  duties, amendment rules and far more risk. It is a product of its own. What the messaging
  actually needs from a visit is small: which treatments were done, and what should be booked
  next. The wrap-up records exactly that.
- **Open:** whether charting ever comes is the owner's call (Q-02).

### D-018 · Appointment statuses: `booked, confirmed, arrived, completed, cancelled, no_show`. "No reply yet" is derived, not stored. Lunch and breaks are not appointments.
- **Origin:** changed (architecture and demo each had a different list)
- **Why:** "No reply yet" simply means "booked, reminder sent, no answer"; storing it would
  need a background job to keep it true. Breaks have no patient and no messages, so they live
  in their own table.

### D-019 · The calendar column is a "provider" (dentist or hygienist). A chair is a label on the provider in v1.
- **Origin:** changed (the architecture had separate dentist and chair resources on every appointment)
- **Why:** The demo shows one column per person with a fixed chair. Booking two resources per
  appointment doubles the conflict logic for no visible benefit yet.
- **Revisit if:** a pilot clinic has more providers than chairs and needs chair conflicts.

### D-020 · Double booking is blocked by a database constraint, with an explicit staff override
- **Origin:** changed (architecture: hard constraint; demo: "You can still book it")
- **Why:** Clinics do squeeze in emergencies, so staff need an override. But without a
  constraint, two receptionists clicking at the same time create accidental overlaps. The
  constraint covers all normal bookings; "book anyway" sets a flag that exempts that one appointment.

### D-021 · Roles: owner, dentist, hygienist, front desk. Fixed permissions per role, plus per-person extra permissions (import, export). A member can also be linked to a provider.
- **Origin:** changed (architecture had "assistant", demo has "hygienist"; the demo gives one
  front-desk person import rights and another not)
- **Why:** Fixed roles are easy to reason about and test; the few per-person differences are
  explicit flags. An owner who is also a dentist is an owner linked to a provider.
- **Default:** all staff of a clinic can see all its patients (Q-11).

### D-022 · AI-drafted aftercare, and approval of library templates, need a clinical role. Front desk may send drafts that come unchanged from an already approved template.
- **Status:** Superseded by D-051 on 2026-10-02 (the owner decided: dentists only).
- **Origin:** changed (in the demo the front desk approves AI drafts, which then become clinic templates)
- **Why:** AI text is medical advice nobody has checked yet. A template that a dentist approved
  once is safe for the front desk to send. The owner can widen this per clinic later (Q-05).

### D-023 · A rule sends by SMS, email, or both. Each channel is its own message row. Fallback only happens when a contact detail is missing.
- **Status:** Superseded by D-055 on 2026-10-02 (WhatsApp first, ordered channel list).
- **Origin:** changed (architecture: ordered fallback list; demo: "SMS / Email / Both")
- **Why:** Matches the design staff will see. One row per channel keeps delivery tracking and
  duplicate protection simple. Ordered fallback returns with WhatsApp later.

### D-024 · Patient self-service in v1: confirm, cancel (before a cut-off), ask for another time, ask for a booking. No live slot picking, no waitlist, no public booking link.
- **Origin:** changed (the demo shows live slots and automatic waitlist refill; the architecture defers them)
- **Why:** Live availability needs working hours, treatment durations, provider rules and
  race handling: a large feature. A request that creates a front-desk task delivers most of
  the value now. Copy that promises a waitlist is removed from v1 pages.

### D-025 · Link tokens are at least 128 random bits, stored only as a hash, on one short product domain
- **Origin:** changed (the demo shows 4-character codes like `hsd.link/a/8Kq2`)
- **Why:** A 4-character code can be guessed in minutes and would expose appointments. A
  22-character token is still short enough for an SMS. A short domain per clinic is not realistic.

### D-026 · Pages opened by link alone show no treatment details. The treatment plan page needs a second check (date of birth or SMS code) and comes after v1. The aftercare page is the one exception.
- **Origin:** kept (architecture) over the demo (which shows the plan with prices straight from the link)
- **Why:** Links get forwarded and phones get shared. See D-027 for aftercare.

### D-027 · Message texts do not name treatments by default, except aftercare
- **Origin:** changed
- **Why:** An SMS saying "you still have a filling and a deep cleaning planned" is health data
  on a lock screen. Default templates stay generic ("you have treatment still planned"), and
  the `{remaining}` variable is off unless the clinic turns it on. Aftercare cannot avoid
  naming the treatment (the advice itself reveals it), is expected by the patient, and expires
  after 14 days. Legal review: Q-06.

### D-028 · Opting out works by link in every non-transactional message. "Reply STOP" is only promised where the clinic has a number that can receive replies.
- **Origin:** changed (the demo shows a sender name "HarbourDent" *and* "Reply STOP")
- **Why:** A named sender cannot receive replies in most countries, so the promise would be false.

### D-029 · Quiet hours move appointment reminders earlier and everything else later. Closed days count as quiet days.
- **Origin:** changed (both files said "wait until the next morning")
- **Why:** With "no messages on Sunday" and "wait until next morning", the reminder for a
  Monday 08:00 appointment would arrive at Monday 08:00. Details in `messaging.md`.

### D-030 · Per-clinic sending caps (daily and monthly), a global kill switch, and a "start gate" for recalls after an import
- **Origin:** new
- **Why:** After an import, hundreds of patients are overdue at once; the planner would message
  all of them immediately, at the clinic's cost, to numbers nobody has checked. A bug could do
  the same. Caps turn a disaster into an alert. Recalls for imported patients start paused and
  are released in batches by staff, with a cost estimate.

### D-031 · Care plans: the schema allows several per patient; the v1 UI allows one. Each plan lists which treatment types reset its clock.
- **Origin:** changed (architecture: several; demo: exactly one)
- **Why:** One is simpler for staff now; the schema keeps the door open. "Which visit counts
  as the checkup" was undefined in both files.

### D-032 · Orthodontic tracking (braces visits, aligner switches) is one generic "treatment course" and comes in v1.1
- **Origin:** changed (architecture only modelled aligners; demo shows braces progress too)

### D-033 · A patient can have a guardian. Messages for that patient go to the guardian's contact. A shared phone number is never, on its own, a duplicate.
- **Origin:** new (the demo says "messages go to the parent"; no data for it existed)
- **Why:** Families share one phone. Phone-only duplicate detection would merge siblings.

### D-034 · The dashboard shows measured facts in v1. Money estimates come later with a visible formula. No email-open tracking.
- **Origin:** changed (the demo's headline is "Brought in by Chairside this month: $14,860")
- **Why:** The numbers need treatment prices, an attribution rule and a "before Chairside"
  baseline that we do not have. A sales number the clinic cannot verify destroys trust. v1
  shows confirmation rate, no-show rate over time, and recalls that became bookings. "Opened"
  means our own link was opened; we add no tracking pixels.

### D-035 · "Needs attention" is built from live queries plus a small `tasks` table for things a person must tick off
- **Origin:** new (the architecture mentions the inbox but had no storage; the demo has no place
  for the dentist's "sent to the front desk to book")

### D-036 · Aftercare templates are structured (SMS text, intro, do, avoid, call-us-if), versioned, linked to a treatment type. Drafts expire 24 hours after the visit.
- **Origin:** changed (architecture had one `body` field; demo matched templates by text)
- **Why:** The email and the patient page need the structure. Advice like "bite on the gauze
  for 30 minutes" sent three days late is worse than no message. Drafts are a separate table
  from `messages`; a message row is created only on approval.

### D-037 · The AI gets: treatment type name, language, clinic tone notes. Nothing else. Rewrites operate on template text with placeholders, never on text with a patient's name filled in. No free-text staff notes go to the AI in v1.
- **Origin:** tightened (the demo's "Shorter / Warmer" buttons send text that already contains the patient's first name)

### D-038 · Template variables use single braces (`{first_name}`), come from a fixed list, and rendering fails closed
- **Origin:** changed (the two files used different syntax and names)
- **Why:** A message with a literal `{date}` in it must never be sent. Unknown variables are
  rejected when saving; a message that does not render fully is skipped and flagged.

### D-039 · At most one non-transactional message per patient per 7 days, with a priority order
- **Origin:** new
- **Why:** Without it a patient can get a recall, a treatment follow-up and a promotion in the
  same week and opt out of everything.

### D-040 · Patients have a status (active, archived, deceased) and can refuse any channel, including reminders
- **Origin:** changed (the demo says reminders are "always on")
- **Why:** People have a right to object, and messaging a deceased patient's family is a real harm.

### D-041 · The calendar stays fresh by polling, not websockets
- **Origin:** new
- **Why:** "The calendar updates itself" needs no more than a refresh every 30 seconds.

### D-042 · Clinics are created by a script run by the operator. No sign-up page, no admin UI in v1.
- **Origin:** new (neither file said how a clinic comes to exist)

### D-043 · Prices are optional estimates on treatment types and plan items. There is no billing.
- **Origin:** changed (the demo says "passed to the front desk for billing")

### D-044 · Outside production: synthetic data only, and messages can only go to an allow-list of test contacts
- **Origin:** new
- **Why:** The most likely way to leak or mis-send is a test environment with real data or
  real numbers in it.

### D-045 · A booking confirmation message is in v1 (staff can untick it). Messages about moved or clinic-cancelled appointments come in v1.1.
- **Origin:** clarified (the demo has the toggle; no rule existed for it)

---

## Part 3 — Process

### D-046 · The HTML design files are a reference, not source code. Readable copies live in `design/unpacked/`.
- **Why:** The originals are compressed bundles that cannot be searched or read by agents.
  The demo's markup is inline-styled prototype code with fake data and browser-side AI calls.

### D-047 · `docs/progress/board.md` is the only place task status lives. Tasks carry a risk level that decides how much checking they get.
- **Why:** Two places for status always drift apart. Risk levels keep the process light for
  small tasks and strict for dangerous ones. See `docs/process/workflow.md`.

### D-048 · The first task creates the project, conventions and the database foundation; domain tables arrive with their epics
- **Why:** See D-016. Keeps the first task inside one session and gives the owner small schema reviews.

---

## Part 4 — Owner answers

### D-049 · First market: North Macedonia
- **Origin:** owner's answer to Q-01, 2026-10-02
- **What follows from it:**
  - Defaults and the seed clinic use: time zone `Europe/Skopje`, phone country MK (`+389`),
    currency MKD, 24-hour clock, week starting Monday. Daylight-saving dates are the same as
    in the EU, so the timing test tables use `Europe/Skopje`.
  - The country is outside the EU. Its data protection law is modelled on GDPR, so we keep
    building to GDPR standard. Where patient data may be hosted is a point for the legal
    review (Q-06, item 5). D-007 (hosting in the EU) stands until the owner says otherwise.
  - Languages are narrowed to Macedonian and/or Albanian, still the owner's choice (Q-10).
  - Cyrillic and letters such as `ë` cut an SMS part from 160 to 70 characters, which
    multiplies SMS cost. New question Q-17; working assumption: a clinic setting, default
    plain Latin letters in SMS, real alphabet everywhere else.
  - Seed data includes invented names in both Cyrillic and Latin script, so search, sorting
    and SMS part counting are tested with the scripts real clinics use.
  - The provider comparison (E03-T01) is unblocked and must check coverage, price and
    sender-name rules for North Macedonia specifically.
- **Revisit if:** a second country is added (each needs its own check of law, providers and language).

### D-050 · Chairside replaces the clinic's current scheduling tool; charting is undecided
- **Origin:** owner's answer to Q-02, 2026-10-02 ("replace it, maybe")
- **What it means:** Chairside is the clinic's calendar and patient list of record. We do not
  build syncing with other clinic software. Charting and clinical notes are not in version 1
  and not ruled out: the owner decides after the pilot. D-017 is unchanged.
- **What follows from it:**
  - First customers are clinics on paper, Excel or a simple calendar. A clinic that depends on
    full practice software for charting and billing cannot fully switch with version 1.
  - Switching over needs the clinic's **already booked future appointments** in Chairside,
    not only its patients. Neither original file covered this. E04's refinement (E04-T00) adds
    a task: import upcoming appointments from a file, or a fast way to key them in.
  - Keep the door open for charting without building for it: `visit_treatments` already
    records treatment type and tooth per visit, which a later chart could build on. No other
    preparation is done.
- **Revisit if:** pilot clinics say they will not switch without charting or billing.

### D-051 · Only dentists approve aftercare (replaces D-022)
- **Origin:** owner's answer to Q-05, 2026-10-02 ("dentist")
- **What it means:** every aftercare approval needs a dentist: AI drafts, drafts filled from
  an approved template, and library templates. One permission, `aftercare.approve`, held by
  the dentist role and by an owner whose membership is linked to a dentist. Front desk and
  hygienists can read drafts but cannot edit, approve or discard them.
- **Why:** aftercare is medical advice; the person responsible for it signs it off, always.
  It is also simpler: one rule instead of two.
- **What follows from it:**
  - The "Aftercare to review" panel and bulk approve (for unedited template drafts) are
    dentist tools. Drafts a dentist does not get to within 24 hours expire (D-036).
  - A hygienist's own treatments (for example deep cleaning) also wait for a dentist.
- **Revisit if:** the pilot shows drafts expiring because dentists have no time, or the owner
  wants hygienists to approve for their own visits.

### D-052 · The legal review is deferred; building continues on the working assumptions
- **Origin:** owner, 2026-10-02 (on Q-06: "don't care about it, just continue")
- **What it means:** no task waits for legal answers. The working assumptions stay in force:
  recalls and follow-ups are care communication with an opt-out in every message (not opt-in);
  aftercare may name the treatment, other message texts stay generic (D-027); patient data is
  hosted in the EU (D-007); retention follows the table in `data-model.md`.
- **Not changed:** the safe defaults themselves, and the list in `security-privacy.md` Part 2.
  The legal items stay listed there so that going live without them is a conscious choice by
  the owner at that time, not something that was forgotten.
- **Revisit:** before the first real clinic's data enters production (E07-T09).

### D-053 · English only during development; translation-ready; the owner translates after version 1
- **Origin:** owner's answer to Q-10, 2026-10-02
- **What it means:** every screen, message template and aftercare text is built in English.
  No second language, no language switcher, no translation task exists while v1 is built.
  The app stays translatable at near-zero cost: all visible texts live in one message file
  (D-015), and templates and patients carry a language field.
- **After v1 is done:** a translation pass by the owner (Macedonian and/or Albanian) covering
  the message file, the default message templates, the aftercare library seed, and one run of
  the AI evals in that language. It sits between v1 and the first real clinic (roadmap).
- **Rule for agents:** never hard-code a visible string (that is what keeps the pass cheap),
  and never add a language or translation on your own.

### D-054 · SMS is always sent in plain Latin letters
- **Origin:** owner's answer to Q-17, 2026-10-02 ("yes latin")
- **What it means:** before sending, SMS text is converted to the basic SMS alphabet:
  Macedonian Cyrillic is transliterated to Latin, `ë` becomes `e`, `ç` becomes `c`,
  other accented letters lose their accents. This includes filled-in values such as names.
  Email and patient pages keep the real alphabet. No clinic setting in v1 (can be added later).
- **Why:** one non-basic character makes an SMS hold 70 characters per part instead of 160;
  a reminder would cost 2–3 times more.
- **Revisit if:** a clinic insists on Cyrillic SMS and accepts the cost.

### D-055 · WhatsApp first, email second, SMS addable at any time; rules carry an ordered channel list (replaces D-023, amends D-010, D-030, D-054)
- **Origin:** owner, 2026-10-02 ("let's go with WhatsApp first, but make it so that we can add SMS anytime, and change between them")
- **What it means:**
  - Version 1 sends on **WhatsApp** and **email**. SMS is not built in v1 but is fully
    designed (E03-T10) and can be added at any time without touching anything else.
  - Every rule has an **ordered channel list** (default: WhatsApp, then email). The
    dispatcher uses the first channel the patient can receive: the channel is enabled for the
    clinic, the patient has the contact detail, it is not marked invalid, the patient has not
    refused it. If sending fails permanently on one channel (number not on WhatsApp, bad
    email), the next channel is tried as a **new message row** (the key contains the
    channel), so there is never a duplicate. "Both" is dropped in v1.
  - **Switching channels is configuration**: a clinic enables or disables channels in
    Settings, and the rule order does the rest. Disabling a channel re-plans its pending
    messages on the next one.
  - WhatsApp business-initiated messages must use templates approved by Meta. In v1 the
    WhatsApp wording is the product's approved templates with variables (clinic name, date,
    time, provider, link); clinics cannot edit WhatsApp wording, but can edit email wording.
    Each template exists at the provider and as a local copy for previews and snapshots.
  - Confirm and cancel keep working through the **link** in the message (a URL button), so
    E02 is unchanged. Quick-reply buttons are a v1.1 improvement.
  - The patient record learns whether a number is on WhatsApp (`whatsapp_status`) from send results.
  - Replies are possible on WhatsApp: an opt-out word is honoured, other free text becomes an
    attention item with the text. There is still no chat interface (intent non-goal).
  - Caps (D-030) count messages per channel; SMS parts only matter once SMS exists.
  - D-054 (plain Latin letters) applies to SMS only. WhatsApp carries Cyrillic without cost.
- **Why:** WhatsApp is widely used in North Macedonia, is usually cheaper per message than
  SMS there, delivers read receipts, and has no 70-character problem. The cost is onboarding:
  business verification, a sending number, and template approval, which take days to weeks.
- **What follows:** the owner starts the Meta Business verification **now**, in parallel with
  M0–M2 (board). Q-18 decides whether one product number or one number per clinic is used.
  Meta's policy requires patient opt-in for business-initiated messages; the import wizard and
  onboarding record the clinic's confirmation (risk R-29; legal review deferred, D-052).
- **Revisit if:** WhatsApp delivery or policy problems appear in the pilot: enabling SMS is then
  a configuration change once E03-T10 is built.

### D-056 · One WhatsApp sender number for the whole product
- **Origin:** owner's answer to Q-18, 2026-10-02
- **What it means:** one Meta business verification, one phone number, one set of approved
  message templates, nothing extra when a clinic is onboarded. Patients see the product's
  name as sender; every template names the clinic in its first line.
- **Why:** per-clinic numbers would mean verification paperwork and template approvals for
  every clinic, driven by the operator. Not worth it before clinics ask.
- **Kept open:** clinic settings already hold sender details, so per-clinic numbers can be
  added later for clinics that want their own name as sender.
- **Risk accepted:** a restriction on the shared number affects every clinic (R-27); the
  email fallback and, later, SMS limit the damage.

---

## Part 5 — Decisions made while building

### D-057 · PostgreSQL driver: `pg` (node-postgres)
- **Origin:** stack, E00-T01. Approved by the owner on 2026-10-02 (agent rule 4: new library).
- **Why:** Drizzle (D-004) needs a driver and no task named one. pg-boss (D-005) is built on
  `pg`, so choosing it keeps the project on one driver for queries and jobs.
- **Note:** `pg` is a CommonJS package: import it as `import pg from 'pg'` and use `pg.Pool`.
  Named imports fail when Node runs a file directly.
- **Revisit if:** a hosting or performance need calls for a different driver.

### D-058 · A module's `schema.ts` may import another module's `schema.ts`, for foreign keys only
- **Origin:** process, E00-T01. Refines module rule 2 in `overview.md`.
- **Why:** every tenant table has a foreign key to `clinics`, and composite foreign keys cross
  modules (an appointment points at a patient). Drizzle declares a foreign key by referencing
  the other table's definition, so a schema file must import it. Exporting tables from a
  module's `index.ts` instead would let any code query them, which rule 1 forbids.
- **How it is enforced:** the lint rule `chairside/module-boundaries` allows exactly this import
  (`schema.ts` → another module's `schema.ts`) and reports every other deep import.
- **Revisit if:** a module needs to reach another module's tables for anything but a foreign key.

### D-059 · Local tooling details chosen in E00-T01
- **Origin:** stack, E00-T01.
- **What:** ESLint 9 (Next.js config) and Prettier 3, as the task named them. TypeScript 5.9 and
  ESLint 9 are the versions create-next-app 16.3 ships with, not the newer TypeScript 7 and
  ESLint 10. pnpm's protection against freshly published packages stays on. Local PostgreSQL 18
  in Docker on port 5433, matching Render's default version for new databases. The two database
  scripts (`db:migrate`, `db:reset`) run with Node's built-in TypeScript support instead of a
  runner such as tsx. UUID v7 ids come from a 25-line tested function (`src/lib/ids.ts`): Node
  has no built-in one, and the `uuid` package would be one more dependency.
- **Why:** the fewest new dependencies; versions known to work together; staging and local
  databases on the same major version; no build step for scripts.
- **Revisit if:** a script needs to import application modules (Node cannot resolve the `@/`
  paths; a runner such as tsx then needs a decision); Render changes its PostgreSQL version;
  Next.js supports TypeScript 7 and ESLint 10.

### D-060 · `withTenant` is opened once, at the edge; a nested call is refused; waits for a connection or a lock are limited
- **Origin:** process, E00-T01 (tester finding 2). Decided by the owner on 2026-10-03; the 5-second
  limits were chosen by the builder.
- **What:** the action wrapper or the job handler opens one `withTenant` per unit of work, and
  module functions receive its `tx` as a parameter. A `withTenant` call made while another one is
  still open in the same flow fails at once with an error (tracked with Node's
  `AsyncLocalStorage`). The app's pool gives up waiting for a connection after 5 seconds, and
  every tenant transaction sets `lock_timeout` to 5 seconds.
- **Why:** a nested call opens a second transaction on a second pooled connection. It can wait
  forever for a lock its own outer transaction holds, or for a connection when outer calls hold
  them all, with no error and no log line. Nothing may fail silently: refusing the call makes the
  mistake loud the first time it runs, and the limits end every other wait with an error.
- **Revisit if:** work really must run inside an outer transaction (then pass the outer `tx`, or
  use savepoints), or 5 seconds proves too short or too long under real load.

### D-061 · `withTenant` resets its connection with `DISCARD ALL` before the pool gets it back
- **Origin:** process, E00-T01 (tester findings 7 and 15). Decided by the owner on 2026-10-03.
  Adds to D-060, which stays as it is.
- **What:** after every `withTenant` transaction, committed or rolled back, the connection runs
  `DISCARD ALL` before it is released to the pool. A connection whose reset fails is closed, never
  pooled again; the transaction's own outcome stands, and the failed reset is logged. While
  `withTenant` holds a connection it listens for that connection's `error` event, so a connection
  that dies fails the call instead of ending the Node process.
- **Why:** some session state outlives the transaction that created it: a cursor declared
  `WITH HOLD`, a session-level `SET` (such as `SET app.clinic_id`), a session-level advisory lock
  (which even survives a rollback). On a pooled connection it reaches the next transaction, which
  may be another clinic's. One reset ends all of it without listing each kind.
- **Consequences:** one more round trip per transaction. Named prepared statements (Drizzle's
  `.prepare('name')`) cannot be used: the reset removes them on the server while pg still counts
  them as prepared, so their next use on that connection fails (SQLSTATE 26000). A setting every
  connection needs must come from the connection string or the role's or database's defaults,
  which the reset keeps; a command run after connecting is undone by the first reset. Large
  objects are stored database-wide, so no reset reaches them (risk R-31).
- **Revisit if:** the extra round trip shows up in measurements, or named prepared statements
  become necessary (then run the commands `DISCARD ALL` stands for, except `DEALLOCATE ALL`).

### D-062 · Login: the auth tables are global, the clinic is resolved from `memberships` on every request, and one cross-clinic function lists a user's clinics
- **Origin:** process, E00-T02. A builder decision inside the task's scope; the owner reviews it
  with the task.
- **What:** The auth library's tables (`users`, `sessions`, `accounts`, `verifications`,
  `rate_limits`) are global tables without `clinic_id`, on the meta-test allow-list. A session
  belongs to a user, not to a clinic. The clinic a signed-in user acts for is resolved on every
  request from their active memberships: the clinic named in the `chairside.clinic` cookie if they
  have an active membership there, otherwise their only clinic, otherwise the clinic picker. The
  cookie grants nothing by itself. Listing a user's clinics before any clinic is set is a
  cross-clinic lookup: the SECURITY DEFINER function `clinics_for_user(user_id)` (migration 0001)
  returns that user's active memberships (membership id, clinic id, clinic name, role, extra
  permissions) and is on `CROSS_CLINIC_FUNCTIONS`. Memberships stay a tenant table with Row-Level
  Security; `provider_id` is added by E01-T01, when providers exist.
- **Why:** one person can work at several clinics (D-021), so identity cannot live inside a
  clinic. Keeping the clinic choice out of the session row means switching clinics never touches
  the auth library's tables, and a stale or forged cookie is harmless because the membership check
  runs on every request. A named database function is the designed way to look across clinics
  (security-privacy.md, section 1); the alternative, a policy with OR, is what the meta-test forbids.
- **Revisit if:** sessions must be bound to a clinic (per-clinic session limits), or staff
  management (E04) needs the function to return more than it does.

### D-063 · Login details chosen in E00-T02
- **Origin:** process, E00-T02.
- **What:**
  - Sessions live in the database and end 30 minutes after the last request. The end is moved
    forward on use at most once a minute (`expiresIn` 1800 s, `updateAge` 60 s), so a session
    can end up to a minute early, never late. Cookies are httpOnly, SameSite=Lax, and Secure
    whenever `BETTER_AUTH_URL` starts with `https://`.
  - Sign-in attempts are limited to 5 per minute per client address; the other auth routes keep
    the library's defaults. Counters are rows in `rate_limits`, shared by every web instance and
    kept across restarts. The client address is read from `x-forwarded-for` when it holds exactly
    one address; otherwise all such requests share one bucket. Which proxy headers to trust is
    settled with hosting (E00-T07, risk R-33).
  - No self sign-up: the sign-up route is disabled. Users are created by `createStaffUser()`
    (seed and operator script in E00-T05, invites in E04). The library hashes passwords (scrypt).
  - The auth tables use our UUID v7 ids (`newId()`), plural snake_case names like every other
    table, and the library's field names as TypeScript property names.
  - Two settings, both required so nothing is inferred from request headers: `BETTER_AUTH_SECRET`
    (signs the cookies; a real secret outside the local machine) and `BETTER_AUTH_URL` (the app's
    address and the only trusted origin for login requests).
  - Login and logout go from the browser to the library's routes under `/api/auth/*`; no code of
    ours handles a password. The `(staff)` layout, every staff page and the action wrapper
    (E00-T03) take the user and clinic from `currentStaff()` in `src/app/_lib/auth.ts`.
    `src/proxy.ts` only sends requests without a session cookie to the login page.
  - The role → permission table is one constant (`PERMISSION_TABLE`) that mirrors scope-v1.md row
    by row; `can(role, extras, permission)` is pure. Extra permissions (import, export) count for
    front desk only, as the scope table says. An owner records visits only when linked to a
    provider, and approves aftercare only when linked to a dentist (D-051).
- **Why:** each point is the library's standard way or a rule the documents already state,
  written down so the next tasks build on the same assumptions.
- **Revisit if:** a clinic's shared address locks its staff out (then limit per account too), or
  dentists need extra permissions after all.

### D-064 · The five E00-T02 builder questions, decided by the builder at the owner's request
- **Origin:** process, E00-T02. On 2026-10-03 the owner delegated the five questions in
  `handoffs/E00-T02.md` to the builder ("not that critical, decide").
- **What:**
  1. Extra permissions (`import`, `export`) stay front-desk only, as the scope table says. Owners
     have both by role; dentists and hygienists cannot be given them.
  2. `BETTER_AUTH_SECRET` stays a required setting. `.env.example` holds a local-only value;
     staging and production get their own random value (E00-T07).
  3. Sessions keep `ip_address` and `user_agent`. Turning IP tracking off in the library would also
     turn off per-address rate limiting; the values serve a "your sessions" screen (E04) and go
     with the session when it is cleaned up (E07-T04).
  4. A login is audited as `user.logged_in` in every clinic the person has an active membership
     in, written when the library creates the session (`databaseHooks.session.create.after`),
     with the session's `createdAt` as "now". Failed logins are not audited: the rate limit and
     the library's warn lines cover them. Entering a clinic through the picker is not audited on
     its own. E00-T03 builds this once `audit.record()` exists.
  5. The sign-in limit stays per client address and goes from 5 to 10 requests a minute. Every
     sign-in request counts, successful ones too, and a clinic's staff share one address, so 5
     could lock out a team logging in at shift start; 10 still makes guessing slow (600 tries an
     hour against one address). No per-account limit for now; revisit if a pilot clinic is locked
     out (R-33).
- **Why:** each is the smallest choice that keeps the documents' rules and the library's
  defaults, written down so E00-T03 and E04 build on the same assumptions.
- **Revisit if:** the pilot shows lockouts, or a clinic asks who logged in when (the audit viewer
  in E07 then shows the rows from point 4).

### D-065 · Each task runs builder → reviewer → tester, with fix rounds, and one `/pipeline` session can run the whole chain
- **Origin:** process. Decided by the owner on 2026-10-03, so that a task no longer needs him
  at the computer to start every role.
- **What:**
  - New order: builder → reviewer → (fix) → tester → (fix → tester) → (delta review) → owner
    merges. The states become Built → Reviewed → Tested. Low-risk tasks keep no tester.
  - A fresh builder session fixes required changes and findings: exactly those, each with a
    test that fails without the fix, never by changing what a test expects. A fix hands the
    task back to the tester (state Reviewed).
  - Code changed after the full review is read once more in a delta review: only the commits
    since the commit the reviewer named.
  - Reviewer suggestions go to the board's Discovered list, not back to a builder.
  - The builder pushes the branch and opens the pull request (`gh pr create`); later roles
    push to the same branch. Agents never merge, push to `main` or force-push.
  - `/pipeline <task-id>` (`.claude/skills/pipeline/SKILL.md`) runs the chain in one session,
    each role as a fresh subagent, and resumes from the board state when started again. It
    stops for the owner when a role sets Blocked under agent rule 4, when a third fix round
    would be needed (two automatic rounds per task), when checks cannot be made to pass, or
    when a role's result is unclear. It sends a push notification when it stops and when the
    pull request is ready. It never merges.
- **Why:** reviewing first means the tester tests the code that ships. The tester finds most
  defects (E00-T01: 17 tester findings, no required review changes), so the chain must handle
  fix rounds without the owner, and a delta review keeps every fix read by a reviewer. One
  session started by the owner keeps the moving parts few: no new service, no secrets outside
  this machine, the local database the roles already use.
- **Consequences:** the computer must stay on, with Docker running, while a pipeline works.
  Remote Control lets the owner follow and answer from a phone. Only one pipeline runs at a
  time, because the roles share the board and the local database.
- **Revisit if:** CI exists (E00-T06), then the automatic review can also run on GitHub when a
  pull request opens; or two fix rounds prove too few or too many.

### D-066 · Login rules a client cannot ask its way around (E00-T02, tester findings 1–4)
- **Origin:** E00-T02, fix round 1 for the tester's findings 1–4 (`handoffs/E00-T02.md`).
- **What:**
  - A sign-in that sends `rememberMe: false` is refused (400). The library would give that
    session a fixed 24 hours that requests never move forward, past the 30-minute rule. A
    "Remember me" box (E04 or later) needs a decision first: the rule has no exception today.
  - Every library route that checks a password is limited like sign-in: `/sign-in/email`,
    `/verify-password` and `/change-password`, 10 requests a minute per client address and path.
    For these two routes this replaces "the other auth routes keep the library's defaults" in
    D-063 (the defaults were 100 and 3 per 10 seconds).
  - Every error the auth library's database adapter throws is replaced by a copy without the
    values the query was sent (`withoutQueryValues`, `src/lib/query-errors.ts`): the message
    without them, the PostgreSQL code and the names of the table, column and constraint kept,
    `params`, `detail` and `where` left out. The library's router prints unexpected errors with
    `console.error`, outside our logger. Errors from our own queries (`withTenant`,
    `clinicsForUser()`) are not changed here: that is the page side of the same finding, for the
    owner and E00-T03 (board, Discovered).
  - `can()` answers false for a role, permission or provider kind it does not know.
- **Why:** security-privacy.md sections 2 and 6 hold whatever a client sends or a query fails
  with; the tester showed three ways around them through the library's own routes.
- **Revisit if:** a "Remember me" or "confirm your password" screen is wanted (E04), or the
  library offers a setting for any of these.

### D-067 · The request proxy moves the session forward and renews the browser's cookie; pages only read the session (E00-T02, reviewer's required change 1)
- **Origin:** E00-T02, fix round 2 for the reviewer's required change 1 (`handoffs/E00-T02.md`).
- **What:**
  - `src/proxy.ts` runs before every staff page and server action. It asks the auth library for
    the session (`getSession` as a Response). When the session is due for its move (D-063: at most
    once a minute), the library moves `sessions.expires_at` forward and sends a renewed
    `chairside.session_token` cookie with `Max-Age` 1800; the proxy puts that cookie on its
    response. So the browser's cookie ends when the session row does: 30 minutes after the last
    request, up to a minute early, never late.
  - When the library finds no valid session (ended, deleted, or a cookie that is not signed by
    us), the proxy redirects to `/login`, with the cookie removal the library sends for an ended
    or deleted session. A failure to
    read the session (status other than 200 or 401) ends the request with an error; it is never
    treated as signed in.
  - Pages read the session without moving it: `currentUser()` passes `disableRefresh`. A Server
    Component cannot set cookies, so a move made while a page renders would leave the cookie
    behind the session row.
  - Nothing renews the session in the background: no polling, no `useSession()`. Only requests
    that pass the proxy count.
  - This replaces "`src/proxy.ts` only sends requests without a session cookie to the login page"
    in D-063. The proxy is still not the permission check: `currentStaff()` decides the user and
    the clinic for every page and action.
- **Why:** before, the move happened inside `api.getSession()` called from a page, which returns
  only the JSON; the renewed cookie was dropped, so the browser deleted the cookie 30 minutes after
  sign-in however busy the person was (the library calls it a DB/cookie mismatch). The proxy is the
  one place on a page request that can both write the database and set a cookie (Next.js 16 runs it
  on Node.js). The library's `nextCookies()` plugin does not help: it cannot set cookies while a
  page renders either, it only skips the move.
- **Consequences:** each staff request reads the session twice (proxy and page); the move itself
  stays once a minute. A link prefetch also passes the proxy, so it counts as a request; prefetches
  happen when a link enters the viewport or is hovered, not on a timer.
- **Revisit if:** the second read shows up in measurements, a route outside the proxy's matcher
  needs a signed-in user, or a later Next.js lets pages set cookies.

### D-068 · Zod 4 validates every input at the edge
- **Origin:** stack, refinement of E00-T03. Approved by the owner on 2026-10-03 (agent rule 4: new
  library).
- **What:** `zod` 4 becomes a direct dependency, at the version the lockfile already holds through
  Better Auth (4.6.5 on 2026-10-03), so adding it brings no new code into the tree. The action
  wrappers (E00-T03) parse every input with it; webhooks (E03) and AI responses (E06) follow, as
  the stack table in `overview.md` says. A failed parse is reported as field paths and Zod issue
  codes, never with the values that were sent.
- **Why:** the stack table named Zod but no decision approved it, and the wrappers need a schema
  library. Sharing the auth library's version avoids a second copy.
- **Revisit if:** Better Auth moves to another major version of Zod, or Zod's messages start
  quoting the input.

### D-069 · A staff action runs only in the clinic its page was shown for (E00-T02, tester finding 6)
- **Origin:** E00-T02 test, finding 6 (`handoffs/E00-T02.md`). Decided by the owner on 2026-10-03,
  in the refinement of E00-T03.
- **What:**
  - Every action made by the action wrappers carries the id of the clinic its page was shown for.
    The wrapper resolves the clinic for the request as before (D-062: the cookie, checked against
    active memberships, in `currentStaff()`). When the two differ, or the id is missing, it
    refuses with `clinic_changed` before anything else: no permission check, no transaction,
    nothing written. The person is told the clinic changed in another tab and to reload (how a
    form shows it: E00-T04).
  - The id the browser sends grants nothing. It can only stop an action, never let one into a
    clinic: memberships still decide.
  - A page rendering on the server needs no id: it renders in the clinic resolved for that request
    and shows that clinic's name.
  - One clinic per browser stays. The clinic is not put in the URL.
- **Why:** there is one clinic cookie per browser. A form shown for clinic A and sent after another
  tab switched to B, or after A's membership was disabled (D-062 then falls back to the person's
  other clinic), would otherwise run in B. A patient created or changed in the wrong clinic is a
  data-protection incident, not a slip. A clinic in the URL would allow two clinics side by side,
  but it changes every route and link, and each action still has to be told its clinic.
- **Revisit if:** people who work in several clinics need them open side by side. Then the clinic
  goes into the URL, and this check stays.

### D-070 · Query errors lose their values where they are made, for our own queries too (E00-T02, tester finding 2, page side)
- **Origin:** E00-T02 test, finding 2 (`handoffs/E00-T02.md`). Decided by the owner on 2026-10-03,
  in the refinement of E00-T03. Extends D-066, which did this for the auth library's adapter.
- **What:** every error that leaves `withTenant` (from the work inside it, the commit or the
  rollback) and every error from `clinicsForUser()` is replaced by the copy `withoutQueryValues()`
  (`src/lib/query-errors.ts`) makes: the message without the values, the SQL with `$1`
  placeholders, the PostgreSQL code and the names of the table, column and constraint. This also
  holds when the query error sits in the `cause` chain of another error. It holds in every
  environment, development included. E00-T03 builds it.
- **Why:** Next.js prints an error thrown while a page renders, outside our logger, with the values
  the failed query was sent (`params`). Today that is a user id; from E01 it is patient names and
  phone numbers. Cleaning where the errors are made covers every printer at once: Next.js, our
  logger, the error tracker (E00-T07). Keeping the values in development would make the code
  behave differently on the owner's machine than on staging, and agent rule 6 holds for synthetic
  data too.
- **Consequences:** nobody sees the values of a failed query, locally either: debugging works from
  the SQL, the code and the constraint name. Code that needs the PostgreSQL code still finds it on
  the error's `cause`, where Drizzle puts it.
- **Revisit if:** a failure cannot be diagnosed without the values. Then reproduce it with
  synthetic data in a test; do not print them.

### D-071 · E00-T03 refined: three action wrappers, the Discovered lines settled, the task split in two
- **Origin:** process, refinement of E00-T03 on 2026-10-03. The split was approved by the owner.
  The other points are architect choices inside D-062, D-064 and the owner's decision to solve
  R-32 in E00-T03; the owner reviews them with the two tasks.
- **What:**
  - **Three wrappers, in `src/app/_lib/`.** `staffAction` for every server action that changes
    data: session → clinic check (D-069) → permission → input (D-068) → one `withTenant` → handler
    → one audit row in the same transaction → typed answer. A read helper for pages and read-only
    actions: the same steps without the audit row, unless the read declares a patient-record view.
    `userAction` for a signed-in person before a clinic is chosen: session → input → handler, with
    no transaction and no audit row. The clinic picker's `chooseClinic` moves onto it. Every
    wrapper call names its permission, or says that every active member may; there is no default.
  - **Typed answers.** `forbidden`, `invalid_input` (field paths and issue codes), `clinic_changed`,
    a handler's own refusal (such as `not_found`), and `internal` for anything unexpected: rolled
    back, logged once with ids, no detail in the answer. A caught error is kept as `cause`; its
    message is never copied into a new error or a string. The wrapper does not depend on seeing the
    handler's first error: when a rollback fails, Drizzle throws the rollback's error instead.
  - **Only the wrappers open a transaction.** A value import of `withTenant` is allowed only in the
    wrappers, in `src/db/`, and in `src/modules/auth/` for the login audit; `@/db/client` only in
    `src/db/` and `src/modules/auth/` (D-062). Lint enforces both. Another lint rule fails any
    server action in `src/app` that a wrapper did not make, in every route group, not only
    `(staff)`. Route handlers under `src/app/api/` other than the auth library's are on a short
    list, each with a reason. The worker's job handler joins these lists in E00-T07, E02's
    patient-link wrapper and E03's webhooks in theirs.
  - **Un-awaited promises (R-32).** Type-aware linting with `no-floating-promises` and
    `no-misused-promises`. No new dependency: typescript-eslint is already installed.
  - **Login audit (D-064, point 4).** Written from `databaseHooks.session.create.after`. Better Auth
    1.7.7 runs that hook after the session row is stored and before the cookie is set, and an error
    in it fails the sign-in. So when a login row cannot be written, the sign-in fails and no cookie
    reaches the browser: the same rule as an action, whose change and audit row stand or fall
    together. The session row already stored is never used and ends after 30 minutes.
  - **An action sent after the session ended** lands the person on the login page with nothing
    run, instead of the error the proxy's redirect probably causes today (E00-T02 delta review).
    The proxy stays the place the session is moved forward (D-067), and is still not the
    permission check.
  - **Split.** E00-T03 builds the wrappers, the audit module and the cleaned query errors. A new
    task, E00-T08, right after it, adds the lint rules, the login audit and the ended-session
    action. Together they are about 500 changed lines of product code, over the one-session rule
    of thumb (`workflow.md`), and the owner reads every critical diff.
- **Why:** these points settle the board's Discovered lines that named E00-T03, and risk R-32. Each
  is the smallest choice that keeps an existing decision: a check in every route group, because a
  bare action anywhere is a way in; one failure rule for audit rows everywhere; a lint rule
  wherever a reviewer could miss the mistake.
- **Revisit if:** a server action fits none of the three wrappers; type-aware linting makes
  `pnpm check` too slow to run on every task; a later Better Auth runs `create.after` hooks after
  the cookie is set (then the login rule needs another place).

### D-072 · The action wrappers as built: how they are called, how they answer, what they audit (E00-T03)
- **Origin:** process, E00-T03. Builder choices inside the task's scope (D-068–D-071); the owner
  reviews them with the task.
- **What:**
  - **Calls.** The browser calls a staff action as `action(clinicId, input)`: the clinic id first,
    so a form binds it (`action.bind(null, clinicId)`, which Next.js supports without JavaScript),
    then the input as a plain value or a form's FormData (one value per field as it is, several as
    a list). `staffRead` adds `.forPage(input)` for a page while it renders: no clinic check
    (D-069); it is not an action and is never exported from a `'use server'` file. `userAction` is
    called with the input only. All three live in `src/app/_lib/actions.ts`.
  - **Answers.** `{ ok: true, value }` or `{ ok: false, error: { code } }` with `clinic_changed`,
    `forbidden`, `invalid_input` (plus `issues: { path, code }[]`), `internal`, or the handler's own
    code. A handler refuses by returning `refuse('code')`, a lower-case word that is none of those
    four; the wrapper then rolls its transaction back. Anything a staff handler throws, Next.js's
    `redirect()` and `notFound()` included, is rolled back, logged once and answered `internal`.
    A `userAction` handler may redirect (there is no transaction to lose), as the picker does.
  - **The audit declaration** is `{ action, entityType, entityId, metadata? }`: required on
    `staffAction`, optional on `staffRead` (a patient-record view). `entityId` and `metadata` come
    from a function of the parsed input and the staff member, or from a field of the handler's
    result (`{ result: 'id' }`), checked against the result's type. A function of the result cannot
    be typed: TypeScript fixes the result's type as `unknown` when the declaration comes before the
    handler, as `staffAction({ permission, input, audit }, handler)` has it.
  - **Permissions.** `permission` is a key of the permission table or `'every_member'`; a call
    with neither fails the type check and fails when its module loads. `providerKind` is null until
    memberships are linked to providers (E01-T01).
  - **Input issues** hold paths and Zod codes only. A key that the schema does not declare as a
    field (the keys of a record or of a catch-all object, which are values the browser sent) shows
    as `*` in the path.
  - **`audit.record()`** writes into the transaction's own clinic (`current_clinic_id()` in the
    insert; there is no clinic parameter). Besides a personal field name in the metadata (checked
    on the JSON that will be stored, so `toJSON` or a getter cannot hide one), it refuses an action
    or entity type that is not a code (`patient.created`, `patient`), an id that is not a UUID, and
    a user or patient-link actor without an id: no free text reaches the audit log's text columns.
  - **Query errors (D-070).** An error that holds a query error (as its cause, among an
    AggregateError's `errors`, or in another own property) is copied with its class, message, stack
    and fields, and its inner errors cleaned, so a handler's own error class survives the cleaning.
  - `asFormAction(action)` lets a plain `<form action>` take a wrapper-made action (React types a
    form's action as returning nothing because it ignores the answer); the clinic picker uses it.
- **Why:** each point is the smallest shape that keeps D-068–D-071 checked by the type checker as
  well as at run time, and that a reviewer can read in one file.
- **Revisit if:** E00-T04's forms need another call shape (`useActionState` calls an action with
  `(previousState, formData)`); a handler must refuse with more than a code; an audit row needs an
  actor or entity id that is not a UUID.

### D-073 · E00-T08 refined: `.forPage` and thrown non-errors are caught by lint; a read-only transaction for reads waits
- **Origin:** process, refinement of E00-T08 on 2026-10-04. The first three points are the owner's
  (2026-10-04, from E00-T03's review); the last two are architect choices inside D-071, which the
  owner reviews with the task. Adds to D-071, which stays as it is.
- **What:**
  - **`.forPage` is never an action.** The lint rule that makes every server action a wrapper's
    also reports a `staffRead(…).forPage` exported from a `'use server'` file, written directly or
    through a read made elsewhere in the file or imported. `.forPage` skips the clinic check
    (D-069, D-072), so exported as an action it would let a form shown for one clinic run in
    another.
  - **Only errors are thrown.** `@typescript-eslint/only-throw-error`, with its default options,
    joins the type-aware rules of E00-T08 for `src/`. `withoutQueryValues()` walks an error's
    `cause` chain, an AggregateError's `errors` and own properties that hold errors; a failed query
    inside a thrown plain object (`throw { cause: e }`) is not found, and its values would print.
    The rule also reports `throw refuse(…)`, which the wrappers answer `internal` (a refusal is
    returned). The comment on `withoutQueryValues()` says which shapes it walks and which not; the
    function itself does not change.
  - **No read-only transaction yet.** A `READ ONLY` transaction for `staffRead` handlers that
    declare no audit row (board, Discovered, E00-T03) is not part of E00-T08. It stays on the
    Discovered list for a later task.
  - **One accepted shape for an action.** In a `'use server'` file the only value export the rule
    accepts is `export const name = staffAction(…)` (or `staffRead(…)`, `userAction(…)`), called
    directly, with the wrapper imported from `src/app/_lib/actions.ts`. Type-only exports pass.
    Everything else is reported, re-exports and `export async function` included. One shape is
    easy to check, for the rule and for a reviewer, and it is the shape the only action today
    (`chooseClinic`) already has.
  - **No server action outside `src/app`.** A `'use server'` file or an inline `'use server'`
    function anywhere else in `src/` is reported. A module cannot import Next.js (module rule 3),
    but a `'use server'` directive is not an import: without this, a module file could become an
    unwrapped action.
- **Why:** both gaps were found in E00-T03's review, and both fall exactly where E00-T08 already
  adds lint rules, so closing them costs one rule option and a few test cases. The read-only
  transaction would change how every read runs, which is more than a lint rule; the owner chose to
  leave it for later.
- **Revisit if:** a server action needs another shape (a wrapper made through a helper of our own,
  for example); the default options of `only-throw-error` let a real case through; a read that
  writes is found in review (then the read-only transaction comes sooner).

### D-074 · The guards around the action wrappers as built: lint options, test snippets, the proxy and the login rows (E00-T08)
- **Origin:** process, E00-T08. Builder choices inside D-071 and D-073; the owner reviews them with
  the task. Adds to D-067, which stays as it is.
- **What:**
  - **Un-awaited queries.** `@typescript-eslint/no-floating-promises` runs with
    `checkThenables: true`. A Drizzle query (`tx.insert(…).values(…)`, `tx.execute(…)`,
    `tx.select()…`) implements `Promise` without extending it; with the rule's default options
    none of them is reported, which is exactly R-32's case. A promise marked `void` on purpose
    still passes (the rule's default), as the login form's event handlers need.
  - **Which files the type-aware rules see:** `src/**/*.{ts,tsx,mts}`, the TypeScript files
    tsconfig.json includes. A `.js`, `.jsx`, `.mjs`, `.cjs` or `.cts` file in `src/` is in no
    TypeScript project, so neither `tsc` nor these rules check it; none exists.
  - **Snippets in `architecture.test.ts`** are linted at paths that do not exist on disk. The
    snippet runner (`eslint-rules/lint-snippets.mjs`), and only it, lets those paths use the
    TypeScript default project with tsconfig.json's options; the project's own config keeps
    `projectService: true`. A snippet at a path that exists is linted as that file, whose own text
    is put back afterwards. A snippet that cannot be parsed fails its case.
  - **The one accepted shape** is checked through the binding: the wrapper must be imported under
    its own name from `src/app/_lib/actions.ts` (by the `@/` alias or a relative path). An alias, a
    local function of that name, `export let`, `export default`, every re-export, and a wrapper's
    result passed through another function are reported.
  - **Route handlers anywhere in `src/app`** need a line in `ROUTE_HANDLERS`
    (`eslint-rules/server-actions.mjs`), not only those under `src/app/api/`: a `route.ts` in a
    page folder is the same way in. The auth library's handler is on the list by its exact path,
    so another file under `api/auth/` is not exempt.
  - **A server action after the session ended.** The proxy lets a server action through without a
    valid session: a POST with the `Next-Action` header, or a multipart/form-data POST (a form
    posted without JavaScript), the two shapes Next.js runs an action for. Its wrapper then runs
    nothing and redirects to `/login`: Next.js answers the page with `x-action-redirect: /login`,
    and a form posted without JavaScript with a 303 to `/login`. Every other request without a
    valid session is still redirected by the proxy, with the library's cookie removal as before.
    Measured on a production build: before, a form posted without JavaScript followed the proxy's
    307 to `/login` and got a 500 ("Failed to find Server Action").
  - **Login rows** (`src/modules/auth/login-audit.ts`, as `databaseHooks.session.create.after`).
    On a failure the hook logs once, with the user and clinic ids and the cleaned error, and throws
    the auth library's `APIError` (500), which carries none of that error: an error of another kind
    the library would print again (its logger and `console.error`), and an `APIError`'s body goes
    to the browser as it is. The login form shows "Login did not work. Try again." Rows already
    written in other clinics stay: each clinic has its own transaction. Every new session writes
    the rows, so a password change that ends the other sessions (`revokeOtherSessions`, which
    starts a new session) writes them too.
- **Why:** each is the smallest choice that makes the task's acceptance true while keeping D-067,
  D-071 and D-073: the lint rules must see the real query type, the snippet tests must keep
  passing unchanged (agent rule 8), and a person whose session ended must land on the login page.
- **Revisit if:** a query library returns real Promises (`checkThenables` can go); `.js` files
  appear in `src/`; Next.js recognises a server action request differently (then `isServerAction()`
  in `src/proxy.ts` follows); the login rows of a password change are unwanted (E04).

### D-075 · E00 after E00-T08: CI comes first, two new tasks from E00-T08's review and test, and how CI runs
- **Origin:** process, planning after E00-T08 (PR #9) on 2026-10-04. The owner decided: the
  login-form fix is its own task; E00-T06 is split so that CI comes first; the repository stays on
  GitHub Free with a small Actions budget, and GitHub Pro is decided after two weeks of runs; the
  dependency check fails a run only for production dependencies; Next.js telemetry is off
  everywhere; the pipeline waits for CI, a red run becomes a fix round, and "ready to merge" comes
  only on green. These answers also settle Q-16 (GitHub for code and CI). The other points are
  architect choices, which the owner reviews with the tasks.
- **What:**
  - **Split and order.** E00-T06 becomes E00-T06a (CI) and E00-T06b (Playwright and journey J1).
    J1 needs the seeded users (E00-T05) and the Today page of the app shell (E00-T04); CI needs
    neither. Two tasks come from E00-T08's review and test: E00-T09, the login form (D-076), and
    E00-T10, the lint gaps (D-077). Order: T06a → T09 → T10 → (T04, T05 in any order) → T06b →
    T07. E00-T04 waits for E00-T09, because it restyles the login form, and for E00-T10, so that no
    inline comment can switch a lint guard off in the components it copies into `src/`. E00-T07
    still comes last, its dependencies named directly: E00-T05, E00-T06b, E00-T09. E00-T04 as
    written is about 1,160 changed lines of product code (estimated against the code on `main`:
    tokens, fonts and strings; the components page; the sidebar and its pages; the form pattern),
    about three times the one-session rule of thumb, so it is split when it is refined.
  - **How CI runs (E00-T06a).** One workflow on every pull request and every push to `main`, on
    `ubuntu-24.04` only: every agent already runs `pnpm check` on the owner's Windows machine, and
    GitHub's Windows runners cannot run the Linux database container. The database starts as on a
    developer machine (`.env.example` copied to `.env`, then `docker compose up -d --wait`), so no
    GitHub secret exists. Each command of `pnpm check` is its own step, then `pnpm build`, then the
    unit and integration tests again with `TZ=Pacific/Auckland`. Every check step runs even when an
    earlier check failed, but not after a failed setup step (never `always()`), so
    one red run names every failing check. The token is
    read-only, every action is pinned to a full commit SHA, every job has a time limit, and a newer
    push to a pull request cancels its older run.
  - **No enforced merge rule (owner).** GitHub refuses branch protection and rulesets for a
    private repository on the Free plan (the API answers 403). The repository stays on Free: the
    pipeline says "ready to merge" only on a green run, and the owner merges only on green (R-34).
    The owner adds a payment method with a small Actions budget (for example $10 a month), so CI
    does not stop when the 2,000 free minutes are used up (estimate: 40 to 55 minutes a task), and
    decides on GitHub Pro ($4 a month: the merge rule and 3,000 minutes) after two weeks of
    measured use.
  - **Dependency check (owner).** `pnpm audit --prod` fails the run: production dependencies are
    what reaches staging and patient data. The full `pnpm audit` is printed and fails nothing; on
    2026-10-04 it reports two advisories in development tools, one without a fix. A weekly run on
    `main` shows a new advisory without waiting for a pull request. CI never passes `--fix`,
    `--ignore` or `--ignore-unfixable`: they write `pnpm-workspace.yaml`.
  - **Telemetry (owner).** Next.js's anonymous telemetry is off everywhere: in CI and in
    `.env.example` (E00-T06a), on staging (E00-T07) and on production (E07-T09). In CI, Next.js only
    changes where it keeps its telemetry settings; it still sends data unless
    `NEXT_TELEMETRY_DISABLED=1` is set.
  - **The pipeline waits for CI (owner; the path is the architect's).** After Build and after each
    Fix, the pipeline waits for the run of the branch's latest commit, found by that commit
    (`gh pr checks` cannot tell a run that has not started from a red one). A red check step becomes
    a fix round: the pipeline gives the builder the run's link and the names of its failing steps. That is
    CI output, not a role's judgment, so it does not break the rule that the pipeline passes on
    nothing a role found. The builder fixes exactly those under the usual fix-round rules, records
    them in its fix-round section, and sets the state the task had before: Built when the note has
    no reviewer section yet, so the full review still comes next; otherwise Reviewed. The round
    counts toward the two automatic rounds. The pipeline stops for the owner, and never counts it as
    green, when no run exists for that commit 10 minutes after the push, when a run stays queued or
    is refused (minutes used up, GitHub down; such a run is red with no red check step), when a
    setup step is red, and when
    `pnpm audit --prod` is red: a dependency change falls under agent rule 4. "Ready to merge" only when the run of the last pushed commit
    is green. This is how `workflow.md`'s "CI must be green before review" is kept. E00-T06a writes
    it into the pipeline skill and `builder.md`.
  - **One scratch pull request (architect choice).** E00-T06a's tester shows the red runs on one
    scratch pull request: a branch made from the task branch (before the merge only it has the
    workflow), against `main`, with "scratch" in its title; never merged, closed and its branch
    deleted afterwards. It is the one exception to one branch and one pull request per task, and
    the closed pull request stays visible on GitHub. An ordinary pull request, not a draft: on
    GitHub Free, draft pull requests exist only for public repositories.
  - **The test clock control** stays in E00-T06b and is designed when that task is refined. Its
    guard cannot be `NODE_ENV`: `next build` writes `production` into the build that end-to-end
    tests run against, so such a guard would switch the control off in those tests too.
  - **The other lines from E00-T08's review and test.** Every page checks the session itself or is
    public on purpose: `security-privacy.md` section 2 now, the `CLAUDE.md` sentence in E00-T04,
    the first task that adds pages. Next.js's "Failed to find Server Action" error, which anyone can
    cause by posting a multipart form that names no server action, is not sent to Sentry (E00-T07)
    and is never an alert on its own (E07-T03). E00-T07's scrubbing also removes request headers
    and cookies: Next.js hands a request's headers, the session cookie among them, to the error
    hook that reports to Sentry.
  - **`.env.example` (D-064, point 2).** `security-privacy.md` section 7 still said the file lists
    names without values, while D-064 decided it holds local values that are not secrets, which CI
    now uses. The section now says what D-064 decided.
- **Why:** CI needs nothing from E00-T04 or E00-T05. Doing it first means every later task is
  checked by a machine, on Linux and from a fresh checkout, which agents' claims need. The two new
  tasks keep a small critical login fix out of E00-T04's large diff, and close the lint gaps before
  E01 writes the first domain code. Each CI choice is the smallest that keeps the documents true:
  local values and no secret, a red run only for what reaches production, nothing about our builds
  leaving the machines.
- **Revisit if:** two weeks of runs show the minutes or the budget are too tight (then GitHub Pro,
  which also brings the merge rule); a run takes over 10 minutes; an advisory in a production
  dependency has no fix; the automatic review on GitHub that D-065 mentions is wanted.

### D-076 · The login form posts to `/login`, and its button stays disabled until its script runs; login still needs JavaScript (E00-T09)
- **Origin:** process, E00-T08 test, tester note 1. On 2026-10-04 the owner made it its own task,
  to be fixed before staging. The approach is the architect's choice inside D-063; the owner reviews
  it with the task.
- **What:**
  - The form gets `method="post"` and `action="/login"`, with the default encoding. With
    JavaScript, its `onSubmit` handler still stops the browser's own submission and signs in
    through the auth library's client (D-063). If the form is ever submitted without that handler
    (a script calling `form.submit()`), the browser sends the fields to `/login` in the request
    body, never in the URL. Next.js 16.3.8 answers a URL-encoded POST that is not a server action
    with the page itself and does not read the body, and the proxy never sees `/login`. The `action`
    is written out because a form without one posts to the page's own URL, query string included.
  - The submit button is disabled in the HTML the server sends, and enabled once the form runs in
    the browser. A disabled default button also stops Enter from submitting the form, so with
    JavaScript off nothing is sent at all. A line for browsers without JavaScript says it is needed
    to log in.
  - A lint rule reports a `<form>` in `src/` that could put its fields in the URL: one whose
    `action` is neither a function nor a URL it posts to, and a button or input whose `formMethod`
    is not `post`. Later forms with secrets (two-factor codes, new passwords, E04) get the same
    guard.
  - Login without JavaScript is not built. Posting the form straight to the auth library's sign-in
    route would show the person a JSON page that holds the session token. Signing in from our own
    server code instead would skip the library's rate limit, which runs only for HTTP requests to
    its routes (security-privacy.md section 2, D-064 point 5), and would put the password through
    our own code, which D-063 rules out.
- **Why:** with only an `onSubmit` handler, the browser sends the fields as a GET whenever the
  handler does not run: JavaScript off; before the page's script has run (a slow network, a
  password manager that submits at once); a script that failed to load after a deploy;
  `form.submit()`. The fields then stay in the browser history, the development server's request
  log (seen in E00-T08's test) and a host's access logs. The disabled button stops those
  submissions before they start, and posting keeps the fields out of the URL when one gets through.
  Standard attributes and one documented React hook; a unit test of the server's HTML pins it.
- **Consequences:** on a very slow connection the person waits for the button. When a script
  fails to load, the button stays disabled with no message; a reload fixes it. A script that calls
  `form.submit()` after the page has loaded gets the login page back, not a login, and nothing
  leaks.
- **Revisit if:** login must work without JavaScript (then a route of our own that keeps the rate
  limit, an owner decision); E00-T04 moves the login form to a React form action (then the form's
  test changes only with the owner's agreement, agent rule 8).

### D-077 · E00-T10: the lint guards close the gaps found in E00-T08's review and test
- **Origin:** process, planning on 2026-10-04. The architect turned six Discovered lines into one
  task: E00-T08 review suggestions 3 and 4, test notes 2 to 4, and the builder's line on `.js`
  files. Architect choices inside D-062, D-071, D-073 and D-074; the owner reviews them with the
  task. D-074 stays as it is.
- **What:**
  - **No database handle passed on.** `chairside/database-access` also checks the places allowed to
    use `withTenant` or the database client (`src/db/`, `src/modules/auth/`, the wrappers' file),
    and reports a value re-export of either there. Only re-exports are reported: an
    `export const x = withTenant`, and a function that wraps it, stay review checks, so that no
    existing test case changes (agent rule 8).
  - **Database drivers only in `src/db/`.** Outside it, a value import of `pg` or a `pg-…` package,
    of any `drizzle-orm/…` path except `drizzle-orm/pg-core`, or of `src/db/reset` or
    `src/db/migrate` is reported. `drizzle-orm` itself and `drizzle-orm/pg-core` stay allowed
    everywhere, and type-only imports pass. An allow-list, because drizzle-orm has hundreds of entry
    points and dozens of drivers. The worker's folder joins the list for pg-boss in E00-T07.
  - **No inline switch.** `linterOptions.noInlineConfig` for `src/`: an `eslint-disable` comment
    there switches nothing off, and lint reports the comment as a warning, which
    `--max-warnings=0` fails. The config option, not the command-line flag, which ignores the
    comments silently and does not reach editors.
  - **Rejections and swallowed promises.** `@typescript-eslint/prefer-promise-reject-errors`, with
    `allowThrowingAny` and `allowThrowingUnknown` as `only-throw-error` has them. In
    `src/**/*.{ts,mts}`, a statement that only hangs `.catch(…)` or a two-argument `.then(…)` on a
    promise is reported: `no-floating-promises` counts such a promise as handled, so a query could
    still run after its transaction ended (R-32) and its error would vanish. A client `.tsx` file
    keeps `void`, as D-074 allows.
  - **Routes only in `src/app`.** A file under `src/pages/` is reported: Next.js 16 serves the Pages
    Router next to `src/app`, outside the wrappers and `ROUTE_HANDLERS`, and since E00-T08 the proxy
    lets a signed-out POST shaped like a server action through to it. `chairside/server-actions`
    runs on every script file in the repository, so a `'use server'` file outside `src/` is reported
    too.
  - **No `.js`, `.jsx`, `.mjs`, `.cjs` or `.cts` files in `src/`.** A test, not a lint rule, fails
    when `src/` holds one. Those files are outside tsconfig.json's `include` and outside the files
    the type-aware lint rules check (`TYPED_FILES` in `eslint.config.mjs`), so none of those rules
    sees them (D-074). A lint rule would add a report to seven existing test cases.
- **Why:** since E00-T08, lint is a security guard, and each of these is a way past it that a
  reviewer may not notice. All six are small and live in the same files, so one task closes them.
  Doing it before E00-T04 copies components into `src/`, and before E01 writes the first domain
  modules, keeps "lint fails" true from the start.
- **Revisit if:** a real need meets one of these (a module that must reach a driver, a generated
  file that needs a lint comment); `void` should be refused in server code too (D-074).

### D-078 · CI and the pipeline's CI wait as built: step names, the run found by commit and branch, time limits (E00-T06a)
- **Origin:** process, E00-T06a. Builder choices inside D-075; the owner reviews them with the
  task.
- **What:**
  - **Step names are the pipeline's input.** Setup steps are named `Setup: …`; each check step is
    named by its command (`pnpm lint`, `pnpm test (TZ=Pacific/Auckland)`, `pnpm audit --prod`).
    The pipeline reads the names of the red steps from `gh run view --json jobs`: a red `Setup: …`
    step or a red `pnpm audit --prod` stops it for the owner; any other red step whose name starts
    with `pnpm ` is a fix round; a red run with no red step is a Stop. A comment at the top of
    `ci.yml` says so, for whoever adds or renames a step.
  - **The last setup step is the database start** (`id: database`); every check step runs
    `if: ${{ !cancelled() && steps.database.outcome == 'success' }}`. Copying `.env` and starting
    the database are two steps, in the README's order: install, `.env`, database.
  - **The run is found by commit and branch:** `gh run list --workflow ci.yml --branch <branch>
    --commit <sha>`. The commit alone is not enough: the scratch branch is made from the task
    branch, so its first run can have the same head commit. A run that does not exist yet is
    waited for by a background `until` loop around `gh run list`, stopped after 10 minutes (Claude
    Code refuses a long sleep in the foreground). The pipeline then waits with
    `gh run watch <id> --exit-status --compact --interval 30` and reads the result with
    `gh run view <id> --json status,conclusion,url,jobs`. It never re-runs a run.
  - **A CI fix round** sets the board to In progress while the builder works, then to Built or
    Reviewed. A failure the builder cannot reproduce or explain from its log (a flaky test, an
    outage in the middle of a step) is Blocked, not re-run and not "fixed" in the test.
  - **Times.** The job's limit is 20 minutes, twice the 10 a run should stay under, so a slow
    runner does not end a good run, and a hung step costs at most 20 minutes. The weekly run is on
    Mondays at 05:17 UTC.
  - **The full audit** runs `pnpm audit` and, when it exits non-zero, writes a warning annotation
    on the run; the step itself stays green, so a red step in the list always means a failed
    check.
- **Why:** the pipeline must tell a check it can send to a builder from a failure only the owner
  can act on, from CI output alone, without a role's judgment (D-075). Step names are what
  `gh run view` gives without downloading logs.
- **Revisit if:** a second job or a matrix is added (the names then need a job prefix); GitHub Pro
  brings a merge rule (a required check names the job, `Check`); runs take over 10 minutes.

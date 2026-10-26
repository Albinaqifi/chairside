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

### D-079 · Agents read less at the start, the Discovered list leaves the board, the reviewer names the CI run (process)
- **Origin:** process. Decided by the owner on 2026-10-04 after a look at the four pipeline runs so
  far (E00-T02's fix rounds, E00-T03, E00-T08, E00-T06a).
- **What:**
  - **The Discovered list lives in `docs/progress/discovered.md`,** not on the board. Agents append
    one line each, as before; nobody reads the file at the start of a session; the architect or
    owner turns lines into tasks or decisions and deletes them in the next planning pass. The 23
    lines already struck through were dropped in the move, and the line about the board's
    "States:" order was answered by fixing that line; git history keeps them.
  - **"Your task" means its own section of the epic file** (its `### <task-id>` heading to the next
    `###`) plus the epic's introduction, not the whole file. Another task is read only when the
    task names it.
  - **Of the handoff note, each role reads what it needs,** and its role file says which: the
    tester the builder's sections, the reviewer's required changes and what it marked as the
    tester's, and the architect's lines for the reviewer and tester; the reviewer the builder's
    sections (full review), or its own section and everything after it (delta review).
  - **The reviewer does not run the full check.** It reviews a commit CI has run (the pipeline
    starts a full review only on a green run) and names that run in its section, which the handoff
    template now asks for. A single command for a doubt of its own is fine; the full check only
    when the commit has no green run. The builder and the tester still run it: the builder before
    it hands off, the tester because it adds tests.
  - **The architect says what a criterion costs to check** when it is more than a test run.
- **Why:** measured on the four runs: a task takes 1 h 25 to 2 h 25 of pipeline time; each role
  starts at about 38K tokens of context, reaches 60 to 100K after the start ritual and ends at
  150 to 330K. The board had grown to 37 KB (71 Discovered lines, 23 struck), the E00 epic file to
  52 KB for a 5 KB task, the notes to 40 to 87 KB. Agent rule 1 ("read in this order, and no
  more") was written against exactly that: an agent that loads everything gets worse at its one
  task. The reviewer's local check repeated CI's run of the same commands on the same commit.
  None of this changes a check: the reviewer still reads the whole diff, the tester still verifies
  every criterion and tries to break the code; fix rounds, the delta review, CI before review and
  before Finish, and the two-round limit stay as in D-065 and D-075.
- **Not done, on purpose:** skipping CI for pushes that change only `docs/progress/` (GitHub
  filters a `pull_request` run on the whole pull request's diff, so a path filter would not skip
  them; the logic would have to live in the workflow, and the pipeline's CI wait would have to
  read a skipped run as something other than a Stop); and a line limit on handoff sections (the
  sections are the evidence that a check ran; the cost of reading them is handled above).
- **Consequences:** `CLAUDE.md`, `agent-rules.md` (rules 1, 3, 12), `workflow.md`, the handoff
  template, the four role files, `docs/README.md`, `docs/backlog/README.md` and E07-T00's Read line
  changed. Where D-065 and older task texts say "the board's Discovered list", read
  `discovered.md`; earlier handoff notes keep their wording. The next pipeline run (E00-T09) is
  the check: compare its minutes and tokens per role with the four runs above.
- **Revisit if:** a role misses something it would have found in a section it no longer reads
  (then widen that role's list, not the rule); or the board grows past about 15 KB again.

### D-080 · The form lint as built: what passes, spreads, an action that may be missing, where it runs (E00-T09)
- **Origin:** process, E00-T09. Builder choices inside D-076; the owner reviews them with the task.
- **What:**
  - **Where.** `chairside/forms-post` (`eslint-rules/forms-post.mjs`) runs on the files the other
    type-aware rules cover (`TYPED_FILES`: the `.ts`, `.tsx` and `.mts` files of `src/`). It reads
    JSX elements written as HTML tags: `<form>`, and `<button>` and `<input>` for `formMethod`.
    Attribute and tag names are compared in any letter case, as HTML reads them. Without type
    information it throws rather than guess.
  - **What passes.** A form whose `action` is a function: every part of its type can be called (a
    type parameter counts as its constraint). Its `method` is then not checked: React sends such a
    form itself, with a method and encoding of its own. Or a form with `method="post"` written as
    a string, in any letter case but exactly that word (HTML reads `" post "` as GET), and an
    `action` that is a non-empty string: written (`"…"`, `{'…'}`, a template without `${}`) or
    typed as one (a literal, `string`, a template type). An action of only spaces is empty.
  - **Reported beyond the task's list**, as the same leak: an `action` whose type may be
    `undefined` or `null` (an optional prop: React then drops it, and the form goes to its page's
    own URL); `<form action>` with no value (React drops a boolean action); a spread after
    `action`, or after `method` when the action is a URL, since in JSX the last prop wins. A spread
    before them passes. `method={'post'}` is reported, as the task says of any expression.
  - **Not checked:** a form made with `createElement('form', …)`, and a `.jsx` file in `src/` (no
    types; none exists, D-074).
- **Why:** the rule's job is that no form can put its fields in the URL; a value that may be
  missing, or a prop that a later spread may replace, is exactly such a form. Each shape has a case
  in `eslint-rules/architecture.test.ts`.
- **Revisit if:** a form component in E00-T04 needs a shape the rule refuses; forms are made with
  `createElement`; `.jsx` files appear in `src/`.

### D-081 · The form lint also checks a button's own URL, spreads onto buttons and inputs, and refuses `next/form` (E00-T10)
- **Origin:** process, planning on 2026-10-05. Two Discovered lines from E00-T09: the reviewer's
  suggestion 1 (full review) and the tester's line on `next/form` (both in `handoffs/E00-T09.md`).
  Architect choices inside D-076 and D-080, folded into E00-T10; the owner reviews them with the
  task, **the spread choice above all** (it shapes E00-T04's components). D-077 and D-080 stay as
  they are.
- **What:** `chairside/forms-post` also reports, in the files it covers:
  - **A button's or input's own URL.** A `formAction` on `<button>` or `<input>` is read as a
    form's `action` is (D-080), with one difference: a value that may be missing passes. Without
    a `formAction` the element sends the form the way the form says, and the form is checked on its
    own. So a function passes, and so do `undefined`, `null` and no value at all (parts of a type
    that are `undefined` or `null` are left out before the rest is classified). A URL passes only
    with `formMethod="post"` written as a string on the same element. An empty URL, and a value
    that may be a string or a function (React's own type for it), `any` or `unknown`, are reported
    even with `formMethod="post"`, as on a form. Lint sees the element alone, not the form around
    it (a button can sit in another component), so the element must say that it posts.
  - **A spread onto `<button>` or `<input>` that could carry those two props.** Reported when the
    spread's type may hold `formAction` or `formMethod`: a property of either name, in any letter
    case, on any part of the type (a type parameter counts as its constraint); an index signature;
    `any` or `unknown`. Read from the type, wherever the spread sits: the props a component
    receives are what the type allows, and TypeScript holds every caller to that type.
  - **`next/form`.** A value import of `next/form` (also by its paths `next/form.js` and
    `next/dist/client/form`, with or without `.js`), an `export … from` it, and an `import()` of it
    written as a string. Type-only imports pass. The check lives in `chairside/forms-post`, not in
    `no-restricted-imports`: a second block of that rule matching `src/modules/**` would replace
    the modules' own list (the same flat-config trap as `no-restricted-syntax`, E00-T10's architect
    section). In a module the import is reported twice, by both rules.
- **How a component that spreads its props stays possible (E00-T04).** A button or input component
  types its props without the two: `Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'>`.
  If it needs a form action, it adds `formAction` typed as a function, takes it out of the props
  and writes `formAction={formAction}` on the element. Its callers then cannot pass a URL or a
  method at all: TypeScript refuses them before lint runs. A spread of an object built in the code
  (`{...{ disabled: pending }}`, a form library's `{ name, onChange, onBlur, ref }`) passes as it
  is.
- **Why:**
  - *The button's URL.* React renders a form whose action is a function with no `method`, and
    leaves a submitter whose `formAction` is a URL to the browser, before and after hydration: one
    click sends a GET with every field in the URL, with JavaScript on (react-dom 19.2.8, traced in
    E00-T09's review). It is the same leak D-076 closed for the login form.
  - *The spread.* React's own types for a button or input (`ComponentProps<'button'>`, the
    `…HTMLAttributes` interfaces) include `formAction?: string | function` and
    `formMethod?: string`, so the first design-system button that spreads them would carry the gap
    into every form. Refusing every spread instead would make E00-T04 list each prop by hand;
    checking the property types instead (a function-only `formAction` passes) is more code for a
    need nobody has. Not checking spreads at all (only naming them in D-080's "Not checked") leaves
    the likeliest way in open.
  - *`next/form`.* With a string `action`, Next.js's `<Form>` always sends a GET with the fields
    as search params; `method`, `formMethod` and `encType` are not supported (Next.js 16.3.8's own
    docs, `01-app/03-api-reference/02-components/form.md`). With a function action it is React's
    form with nothing added. So checking `<Form>` as a `<form>` would refuse every string action
    and pass only what `<form>` already does; refusing the import says the same with less code,
    and needs no knowledge of where a `<Form>` came from. A patient search (E01-T02) is its
    likeliest first use, with patient names in URLs and request logs.
  - A prototype in the architect's scratch space (never committed) added about 75 lines to the
    rule; with it, all 163 cases of `eslint-rules/architecture.test.ts` passed unchanged and
    `pnpm lint` passed on the tree. 22 of the 23 shapes this entry reports pass the rule as merged
    in E00-T09.
- **Consequences:** a button with its own URL inside a form that already posts must still write
  `formMethod="post"`: lint cannot see the form. A button or input component cannot spread React's
  full prop type (above). Once E00-T10's test keeps `.jsx` files out of `src/` (D-077), D-080's
  "Not checked" `.jsx` file cannot occur.
- **Not checked (review checks):** `createElement('button', …)`, as for forms (D-080);
  `require('next/form')` and `import x = require('next/form')`; a URL built in code from the
  fields (`router.push` with a query string, a link's `href`), which is not a form.
- **Revisit if:** E00-T04 needs a component that spreads a function-only `formAction` (then check
  the property types rather than their presence); E01-T02 or a later screen wants search terms in
  the URL (an owner decision: it changes D-076 and `security-privacy.md` section 8); React or
  Next.js change how a submitter's URL or `<Form>` is sent.

### D-082 · The lint guards as built: one report per statement, an exact driver allow-list, `object` spreads, and what stays a review check (E00-T10)
- **Origin:** process, E00-T10. Builder choices inside D-077 and D-081; the owner reviews them with
  the task. D-077 and D-081 stay as they are.
- **What:**
  - **Handles passed on.** `chairside/database-access` gives an import or export statement one
    report at most. In the wrappers' file a re-export from the client file is reported as an import
    of it (the file may not import the client at all), so it is not reported twice. `export { x }`
    is looked up in the file's module scope; `import x = require()` of the tenant file counts as
    the whole file. `export default withTenant` stays a review check, as `export const x =
    withTenant` does: both export a value, not the imported binding.
  - **Drivers.** The allow-list is exact: `drizzle-orm` and `drizzle-orm/pg-core`. A deeper path
    such as `drizzle-orm/pg-core/session` is reported (`drizzle-orm/pg-core` exports all of it); a
    path inside `pg` (`pg/lib/client`) counts as `pg`. A side-effect import, `import()`, `require()`
    and `export … from` load the driver and are reported; `import type`, `import { type … }` and
    `import('…')` used as a type pass. One helper decides this for the drivers and for `next/form`
    (`importsValue()` in `eslint-rules/import-paths.mjs`).
  - **Lint comments.** `noInlineConfig` covers every script file in `src/`, tests included. The
    snippet runner labels a fatal message `parse error: …` and any other message without a rule id
    `inline config`.
  - **Promises nobody waits for.** The check is syntax, not types: a statement `x.catch(…)`,
    `x.then(…)` with two or more arguments, or `x.finally(…)`, is reported whether `x` is a promise
    or not; also `x['catch'](…)`, `` x[`catch`](…) ``, `x?.catch(…)` and `x.catch?.(…)`, and the
    same spellings of `then` and `finally`. `.finally(…)` is in the list because
    `no-floating-promises` follows it back to the promise it hangs on, so `….catch(…).finally(…)`
    passed that rule (E00-T10 review); a `.finally(…)` statement on a promise nobody handles gets
    both reports. In the modules it is part of their `no-restricted-syntax` list, so it covers every
    script extension there; elsewhere the `.ts` and `.mts` files. A one-argument `.then(…)` stays
    `no-floating-promises`' alone.
  - **Routes.** `chairside/server-actions` runs on every script file in the repository; a file in
    `src/pages/`, at any depth, gets one report.
  - **Script files in `src/`.** The test lives in `eslint-rules/architecture.test.ts` and reads
    `src/` from disk, so the snippets at paths that do not exist (some end in `.js` or `.cjs`) are
    not affected.
  - **Forms.** A `formAction` is classified by the form's own `kindOfAction()`, with `undefined`,
    `null` and `void` parts left out first; its messages are its own. A spread's type is read part by
    part, through unions and intersections; a generic type counts as its base constraint, and one
    without a constraint as `unknown`. `object` counts as `unknown` too: it names no property, and
    `P extends object` is how a generic component says "any props". `next/form` is checked by
    every path the package publishes the component under, each with or without `.js`: `next/form`,
    `next/dist/client/form` (the Pages Router's), `next/dist/client/app-dir/form` (the App
    Router's, which a build puts in place of `next/form`), `next/dist/api/form` (a re-export, which
    an ESM build puts in its place), and their untyped copies under `next/dist/esm/`; not
    `next/dist/client/form-shared`, which holds helpers (E00-T10 review). It is checked in
    `import`, `export … from` and `import()` with a written path.
- **Why:** each is the smallest choice that makes E00-T10's acceptance true while every earlier
  case of `architecture.test.ts` passes unchanged. The `object` choice closes the commonest generic
  way around the spread check and changes none of the shapes D-081 lets pass.
- **Not checked (review checks):** `export default withTenant` and `export const x = withTenant`;
  `void` in front of a promise (D-074); a `.catch(…)` or `.then(ok, fail)` statement in a `.tsx`
  file, with or without a `.finally(…)` after it, server components included; `next/form` by a
  path written another way (`next//form`, `next/dist/client/../client/form`, a relative path into
  `node_modules`), which TypeScript resolves too; a spread of a generic mapped type whose type
  parameter has no constraint or `object` (`Partial<P>`); a caller's spread onto a component of an
  object that holds `formAction` next to a prop the component takes (TypeScript checks extra props
  only on written attributes); `require('next/form')`; a lint comment outside `src/`, which can
  still switch `chairside/server-actions` off in a `'use server'` file there.
- **Revisit if:** a library in `src/` has a `.catch`, a two-argument `.then` or a `.finally` that is
  not a promise's; E00-T04 writes a generic button or input component (then the mapped-type gap
  matters); the worker's folder needs `pg-boss` (E00-T07: `DRIVERS_FOLDER` in `database-access.mjs`
  becomes a list); a lint comment is needed outside `src/`.

### D-083 · The architect pass is started with `/architect <task-id>` (process)
- **Origin:** process, 2026-10-05. The owner asked for a way to start the architect from a task
  id, after five planning passes (E00-T03, E00-T08, E00-T06a, E00-T09, E00-T10) were each started
  with a prompt written by hand; merging this change is the decision.
- **What:** `.claude/skills/architect/SKILL.md` holds the standing instructions of a planning
  pass, the way the pipeline skill holds a task's. The owner types `/architect <task-id>` in a new
  session, and the skill chooses the pass from the board:
  - a **Done pass** when the task's pull request is merged: mark it Done, name the first CI run
    on `main` after the merge, collect the leftovers (the builder's questions for the owner and
    known gaps, the reviewer's and the tester's lines for the owner, the Discovered lines that
    name the task), sort each into the owner's, the architect's, work or struck, and refine the
    next task of the Next list;
  - a **Ready pass** when the task is Planned, or Ready with leftovers that name it;
  - a stop with a reason for any other state.
  It runs in the owner's session, not in a subagent, so the architect asks the owner where agent
  rule 4 says so: every item in one round, each with a recommendation. The pass ends as before: a
  `plan/<task>-done` or `plan/<task>-ready` branch, the architect section(s) in the handoff
  note(s), one pull request the owner merges before the next `/pipeline`. The pipeline's Finish
  now names `/architect <task>` as the step after the merge, and the handoff template has the two
  architect sections (Ready pass at the top of a note, Done pass at its end).
- **Why:** every pass so far did the same four things, and each time the owner asked the session
  that had run the pipeline to write the prompt for it. The last such prompt took that session 24
  minutes (it rebuilt the precedent with a multi-agent search) and still held answer lines the
  owner had to fill in by hand. Everything task-specific those prompts carried is in the
  repository (the board row names the pull request, the note holds the questions, the Discovered
  lines name the task), so a standing skill can find it; only the owner's answers are not, and the
  architect can ask for them in the session. The pipeline skill showed the shape works: one
  command, and the precedent lives in a file, not in a chat.
- **Not done, on purpose:** running the architect as a subagent from the pipeline's Finish (the
  owner merges first, and the architect must be able to ask the owner, which a subagent cannot);
  and refining the whole epic in every Done pass (the next task, usually one, is what the next
  `/pipeline` needs; a `T00` task refines its epic).
- **Consequences:** `.claude/skills/architect/SKILL.md` (new); `.claude/skills/pipeline/SKILL.md`
  (Finish); `.claude/agents/architect.md`; `docs/process/workflow.md` (the people table,
  "Starting a session", the rhythm); `docs/process/templates/handoff.md`; `docs/README.md`. The
  first use is E00-T10's Done pass, still owed when this was written: `/architect E00-T10`.
- **Revisit if:** a pass needs instructions the skill cannot know (then a prompt for that pass
  only, on top of the skill); or the skill's reading list makes the architect miss a leftover
  (then widen step 3's list, not the rule).

### D-084 · E00-T11: the form lint checks components and generic types, and the gaps from E00-T10's review and test are closed
- **Origin:** process, E00-T10's Done pass on 2026-10-05: E00-T10's nine Discovered lines (builder,
  review, test) and the builder's two questions for the owner (`handoffs/E00-T10.md`). **Owner,
  2026-10-05:** one more lint task before E00-T04, E00-T11, with every item below. The other choices
  put to the owner were the form part only, the form part folded into E00-T04, or no lint change.
  How each check goes is the architect's; the owner reviews it with the task. D-077, D-081 and D-082
  stay as they are.
- **What:**
  - **Components.** `chairside/forms-post` checks every element written as a component (`<Button>`,
    `<Comp>`, `<Primitive.Root>`) as it checks `<button>` and `<input>`: a written `formMethod` and
    `formAction` (D-081), and a spread whose type may carry either. Other lower-case HTML elements
    stay unchecked: they have neither prop.
  - **Generic types.** A spread whose type is a type parameter, or is built from one (`Partial<P>`,
    `Pick<P, K>`, `Omit<P, K>`, `P & { … }`), passes only when the constraint types both `formAction`
    and `formMethod` as `undefined` or `never`. In every spread check, a property typed only
    `undefined` or `never` carries nothing and does not count. `object`, `any`, `unknown` and an
    index signature count as before (D-082): the builder's first question, answered by keeping what
    the merge took.
  - **A handle by `export default`.** `chairside/database-access` reports `export default` of an
    imported handle in the files that hold one, as it reports `export { withTenant as default }`.
  - **A driver passed on.** In `src/db/`, a value re-export of a driver is reported (`export … from`,
    `export *`, and `export { x }` of an imported driver), as a handle's is: any file may import any
    file of `src/db/`.
  - **`'use server'` in `.tsx`.** `chairside/server-actions` reports a `'use server'` file that ends
    in `.tsx`. Outside the modules the `.catch`/`.then(ok, fail)`/`.finally` statement check covers
    `.ts` and `.mts` files only (D-082), so an action handler's `tx` there would go without it.
  - **Lint comments everywhere.** `noInlineConfig` covers every script file in the repository, not
    only `src/`, so a lint comment cannot switch `chairside/server-actions` off in a `'use server'`
    file outside `src/` either. No lint comment exists outside `src/` today.
  - **Whole case names.** Vitest names each case of `architecture.test.ts` in full
    (`taskTitleValueFormatTruncate`), so a red CI step names the case that failed.
  - **Struck, review checks as before:** names built in code (`import('p' + 'g')`, `p[k](…)`),
    deliberate as casts are (D-077, D-082); `next/form` by a path spelled another way (D-082);
    `c && p.catch(…)`, `p.catch(…), 0` and `c ? p.catch(…) : null` as statements, which
    `@typescript-eslint/no-unused-expressions` reports today and only a deliberate change of its
    options in `eslint.config.mjs` would let through; a mapped type written out over a type parameter
    (`{ [K in keyof P]: P[K] }`), if the type checker cannot tell it from a plain object.
- **Why:**
  - *Components.* D-081 assumed that the design system's button spreads its props onto a written
    `<button>`. shadcn/ui's Button (D-009; its published source, which E00-T04 copies) renders
    `<Comp {...props} />`, where `Comp` is Radix's `Slot` or `'button'` and the props are React's
    full button props; Radix's checkbox and switch are buttons whose props arrive through a spread
    onto a component. Lint sees none of these. Probed on `main` at `f3b45ab` with stand-ins: that
    Button passes lint, and so does a caller's `<Button type="submit" formAction="/patients">` in a
    form whose action is a function, which React leaves to the browser: a GET with every field in
    the URL (D-081). Checking every component also catches a caller's spread of an object that holds
    `formAction` (E00-T10, builder): TypeScript checks no extra props on a spread.
  - *Generic types.* An inferred type argument gets no excess-property check, so with
    `P extends Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'>` a caller may write
    `formAction="/patients"` (E00-T10, tester). Reading a type parameter as its constraint (D-081)
    answers what a component asks for, not what a caller may give it.
  - *The rest.* Each is a way past a guard that a reviewer may not notice, small, and in the files
    the first two touch. The owner chose to close them in the same run rather than keep them as
    review checks.
  - A prototype of the first two items in the architect's scratch space (never committed) added
    about 40 lines to `forms-post.mjs`. With it, and with block (h) of `eslint.config.mjs` widened to
    every script file, all 316 cases of `architecture.test.ts` passed unchanged, `pnpm lint` passed
    on the tree, and twelve probe shapes came out as E00-T11's acceptance says.
- **Consequences:** E00-T04 depends on E00-T11. Its components that render a button or input,
  directly or through a Radix part, type their props without `formAction` and `formMethod`
  (`Omit<…>`), shadcn/ui's Button included; a generic one also types both as `never` in its
  constraint. E00-T05 does not need E00-T11 but follows it in the queue: E00-T11 is Ready, and
  E00-T05 is refined first.
- **Revisit if:** a component must pass a function `formAction` through a spread (then check the
  props' types, as D-081's "Revisit if" says); a library component has a prop named `formAction` or
  `formMethod` that is not a form's; a lint comment is needed outside `src/`.

### D-085 · The lint guards as built in E00-T11: what counts as a component and as built from a type parameter, `export default`, and what stays a review check
- **Origin:** process, E00-T11. Builder choices inside D-084; the owner reviews them with the task.
  D-084 stays as it is.
- **What:**
  - **Components.** An element is a component when its name is a member expression (`<X.Root>`) or
    does not start with a lower-case letter (`<Button>`, `<Comp>`). `<a:b>` and custom elements
    (`<my-button>`) are HTML and stay unchecked, as `<div>` does. A component gets exactly the
    checks a `<button>` gets: a written `formMethod` and `formAction` in any letter case, then every
    spread.
  - **Built from a type parameter.** Two kinds of spread type are read strictly. A type parameter,
    an indexed access on one (`P['x']`) or a conditional type passes only when its base constraint
    has both `formAction` and `formMethod`, each typed only `undefined` or `never`, and also passes
    the ordinary spread check: a constraint that holds `object`, an index signature or a
    `formaction` in another letter case is still reported. A mapped type whose keys come from a
    type parameter passes only when its own properties, read through the constraint, do the same:
    an alias given one (`Partial<P>`, `Pick<P, K>`, `Omit<P, K>`, `Readonly<P>`, and the rest of a
    generic destructuring, which TypeScript types as `Omit<P, …>`), or a mapped type written out
    over one (`{ [K in keyof P]: P[K] }`), read from its own declaration. E00-T11's Out of scope let
    the written-out kind stay a review check if the public type-checker API could not see it; it
    can (`type.symbol.declarations`, `getTypeFromTypeNode`), so it is checked. An alias given a type
    parameter that is not a mapped type (`type Labeled<T> = { label: string; value: T }`) has fixed
    keys and is read as it is. An intersection is read part by part, as before (D-082).
  - **Stricter than the minimum, on purpose.** `P & { formAction?: never; formMethod?: never }` is
    reported when `P`'s own constraint does not type both away (D-084 asks it of the constraint).
    `Pick<P, K>` with a generic `K`, and `Omit<P, 'formAction' | 'formMethod'>`, are reported even
    with a safe `P`: TypeScript lists no property for lint to read. A generic component puts the two
    `never`s in its constraint, as D-084's example does.
  - **A prop typed only `undefined` or `never` does not count,** in every spread check, generic or
    not; `null` and `void` still count (D-084 names the two).
  - **`export default`.** `export default x` of an imported name is checked as
    `export { x as default }` is: a handle in the three places that hold one, and in `src/db/` a
    driver too. D-084 names `export { x }` of a driver; `export default x` is the same export spelled
    another way, and would have been the one spelling left. Only a name is checked: a cast or a
    call after `export default` is a value built in code, a review check as
    `export const x = withTenant` is.
  - **A driver passed on** gets its own message (`driverPassedOn`). A re-export without a value
    name (`export {} from 'pg'`, `export { type PoolConfig } from 'pg'`) passes nothing on.
  - **`'use server'` files.** Only `.tsx` is reported, as D-084 says: an `.mts` file is under the
    statement check, and the other script extensions cannot be in `src/` (D-077's test). A
    `'use server'` `.tsx` file outside `src/app` gets the one report such a file gets there.
  - **Lint comments.** Block (h) of `eslint.config.mjs` covers every script file in the
    repository: the config files, `eslint-rules/`, `tests/` and `design/unpacked/unpack.mjs` too.
    None holds a lint comment today.
  - **Whole case names.** `taskTitleValueFormatTruncate: Number.MAX_SAFE_INTEGER` at the root of
    `vitest.config.ts`, which both projects inherit (`extends: true`). Vitest cuts a `$name` string
    longer than the limit (`0` would cut every name), so the limit is a number no name reaches. It
    applies to every `it.each` title in the project.
- **Why:** each is the smallest reading of D-084 that makes E00-T11's acceptance true while all 316
  earlier cases of `architecture.test.ts` pass unchanged and `pnpm lint` passes on the tree.
  Reading only mapped types strictly keeps fixed-key generic aliases out, which would otherwise be
  reported for nothing; reading the written-out mapped type closes a shape the task allowed to
  leave open, for a few lines.
- **Not checked (review checks):** a spread of a property read on a type parameter
  (`{...props.inner}` with `P extends { inner: … }`): TypeScript types `props.inner` by the
  constraint, so lint sees no type parameter, yet a caller may give `inner` a `formAction`; a
  mapped type that reaches the spread already instantiated without an alias (a generic function's
  return type `{ [K in keyof T]: T[K] }` given `P`), whose declaration is the generic one; casts
  and other types written away; a component called without JSX (`createElement`, D-081);
  `export =`, which TypeScript refuses in this ECMAScript-module project.
- **Revisit if:** E00-T04 needs a generic component whose constraint types `formAction` as a
  function (the strict reading reports it; then check the props' types, D-081's "Revisit if"); a
  shape reported on purpose above turns out to be one E00-T04 needs; a library component's props
  carry an index signature (every spread onto it is then reported).

### D-086 · E00-T11 Done: its leftovers stay review checks, E00-T04 is split in four, and the automated accessibility check moves to E00-T06b
- **Origin:** process, E00-T11's Done pass on 2026-10-05 (PR #20 merged, `handoffs/E00-T11.md`)
  and E00-T04's Ready pass on the same branch. **Owner, 2026-10-05:** no new lint task for
  E00-T11's leftovers: they stay review checks (the other choice was a task E00-T12 before
  E00-T04). Also the owner's: this pass runs before the process change planned the same day, which
  comes before `/pipeline E00-T04a`. The rest is the architect's.
- **What:**
  - **E00-T11's leftovers.** The form lint's known blind spots stay review checks, as D-085 left
    them: a spread of a value read off a type parameter's props, written `props.inner`,
    `props['inner']` or as a destructured prop; a mapped type that reaches a spread already
    instantiated; a spread typed as the empty type (`Record<never, never>`, `NonNullable<unknown>`).
    So does `export default t.withTenant` through a namespace import: it is the
    `export const x = withTenant` check (D-082). D-085's strict choices stay (the builder's
    question): a harmless generic shape that lint reports is rewritten into one it reads (D-084's
    constraint); one that E00-T04 cannot rewrite is D-085's "Revisit if", and the builder stops
    (agent rule 4). E00-T04's parts name these checks for their reviewers. The two comments in
    `eslint-rules/` that still say "in src/" go to E00-T04a, which edits that folder.
    `CLAUDE.md` module rule 7 and R-32 said every action handler is under the `.catch` statement
    check; a handler written in a `.tsx` file and passed to the wrapper is not, and both now say so
    (E00-T11 review).
  - **E00-T04 in four parts,** each depending on the one before; E00-T05 still runs in any order
    with them. D-075 estimated E00-T04 at about 1,160 changed lines; the 13 shadcn/ui components it
    names come to about 960 lines as published, before restyling.
    - **E00-T04a**, tokens, fonts, texts and the login page: Tailwind's theme with every token,
      the two fonts, next-intl with every existing string moved, Button, Input and Label, the
      login page and the clinic picker restyled, a favicon, lint for text in JSX and for
      accessibility.
    - **E00-T04b**, the staff shell: the sidebar, navigation by permission, the placeholder
      pages, the card, the badge and the empty state.
    - **E00-T04c**, the form pattern: a form that calls a wrapped action with its page's clinic
      id and shows the answer, submit disabled while it runs, the toast, and `/dev/components`.
    - **E00-T04d**, the other components: textarea, select, checkbox, toggle, tabs, the
      right-side drawer and the dialog.

    A part after the first is refined in the Done pass of the part before, against what was built.
    E01-T02, E01-T04 and E01-T08 depend on all four.
  - **Accessibility.** The automated check of "keyboard-usable and labelled" moves to E00-T06b,
    which brings a real browser: it runs on `/dev/components` and on the pages J1 visits, as
    `test-strategy.md` already plans automated accessibility checks in the journey runs. Its tool is
    a library, chosen with the owner when E00-T06b is refined (agent rule 4). Until then lint
    checks what it can see (`jsx-a11y`'s recommended rules, from E00-T04a), and each part's tester
    goes through its pages with the keyboard in a browser.
  - **E00-T04a's choices.** The fonts come from files in the repository through `next/font/local`:
    no font host is asked at build or at run time (`next/font/google` downloads at build time).
    Text in JSX is checked by lint (`react/jsx-no-literals`); text in `aria-label`, `placeholder`,
    `title` and `alt`, by review. Both lint plugins come with `eslint-config-next`: no new package.
    The token names of `design-reference.md` are the only ones: the copied components' own names
    are rewritten to them, never kept as aliases, because `accent` and `muted` mean other things in
    shadcn/ui. The packages shadcn/ui's components install (`radix-ui`,
    `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`) are D-009's; the builder
    records their versions. Screenshots are files next to the note, without a person's name or
    email.
- **Why:** one session per part (Definition of Ready), and each part needs the one before: the
  shell needs the tokens and the texts, a form needs the shell's clinic id, the components page
  shows the form. A browser-level accessibility check needs a browser. The leftovers: no product
  code on `main` has those shapes, and the components E00-T04 copies are not generic.
- **Not decided:** Figtree and Newsreader cover Latin only (fontsource lists `latin` and
  `latin-ext`, Newsreader also `vietnamese`), so Cyrillic text, a patient's name written in
  Macedonian for one, shows in the fallback font. Fonts are the owner's design choice: a question
  in `handoffs/E00-T04a.md`, to settle before the translation pass (D-053).
- **Revisit if:** a part does not fit one session when it is refined (split it again); a blind
  spot above turns up in product code (then it is work); the owner changes the order of E00 and
  E01.

### D-087 · Weigh what you find; the lint guards are finished; sizes for notes, entries and `CLAUDE.md`; the critical review (process)
- **Origin:** process, decided by the owner on 2026-10-05 after a look at the eight E00 tasks so
  far (E00-T01, T02, T03, T08, T06a, T09, T10, T11): four of them lint guards (T08, T10, T11 and
  half of T09), no patient screen. The numbers are in the pull request.
- **What:**
  - **Weights.** Agent rule 15: every finding, suggestion and Discovered line starts with what it
    protects: `data`, `message`, `speed`, `slice` or `none`, in the intent file's order, which is
    the order of the work. The lint guards are finished: a new way past one is a review check,
    weighed `none`, unless product code on `main` would hit it today. The architect's Done pass
    weighs leftovers before it sorts them; a new task ahead of the Next list is the owner's choice,
    "not now" offered first. Critical means the diff touches an area of `test-strategy.md`'s table;
    nothing is reclassified (owner). A tester verifies a non-product task's criteria and stops.
  - **Sizes** (the handoff template and the role files): a builder section about 80 lines, a
    reviewer's about 40 plus one per required change, a tester's about 60, an architect's about
    60, a fix round as long as its table. A decision entry about 15 lines, only for a choice that
    makes a document untrue or adds a dependency. `CLAUDE.md` holds only what no lint rule or test
    enforces (240 → about 205 lines). The builder runs `pnpm build` before it hands off. The board
    drops its "Last updated" paragraph, which made branches conflict, and lists the standing owner
    actions in their own section.
  - **The owner does not review code,** and the documents now say so. A critical task gets the
    critical review in place of the owner's read: a second, independent review by a fresh reviewer
    after the tester and the delta review check, starting from the tests. The owner decides what
    rule 4 lists, merges every task pull request on green, and uses the product. Reports and
    questions to the owner are short and plain: what the owner must do first, and each question
    with its recommended answer. The board's "Owner review" lines stop: technical choices are the
    architect's, recorded in an entry. R-35 records that no human reads the code; Q-19 asks for a
    paid human review of the critical areas before real patient data.
  - **The owner's other answers.** CI does not run on a pull request that changes only files
    under `docs/`, Markdown files under `.claude/` (Prettier checks `.claude/settings.json`),
    `CLAUDE.md` or `README.md`; a push to `main` and the weekly run are unchanged. The architect
    merges its own such planning pull request; the owner merges every other one, on green (agent
    rule 14). The owner adds the GitHub Actions payment method and budget when the free minutes
    run out, not now, and decides on GitHub Pro then (D-075 and R-34 said after two weeks of
    runs). The order: E00-T04a → E00-T04b → E00-T05 → E01-T01 → E00-T04c → E00-T04d → E01-T02 →
    E00-T06b → E00-T07 → the rest of E01, so a receptionist sees a patient list before staging
    exists. E00-T04c and E00-T04d stay before E01-T02, which depends on them (D-086); E00-T04c is
    refined in E01-T01's Done pass. This replaces D-086's "E00-T05 still runs in any order with
    them" and, for E00-T04c, "refined in the Done pass of the part before". E00-T01 is Done: the
    builder's five round-3 answers are accepted as its reviewer recommended, the fifth (values go
    in fields or arguments, never inside a log message's text) added to `CLAUDE.md`.
- **Why:** D-079's "Not done, on purpose" declined "a line limit on handoff sections (the sections
  are the evidence that a check ran; the cost of reading them is handled above)". They are not:
  the test case in the repository and the CI run are, and a section names them. This entry
  replaces that line of D-079; the rest of D-079 stays.
- **Not done, on purpose:** removing or shrinking any lint rule (they work and cost nothing to
  run); rewriting old notes or entries; two pipelines at once (after the first E01 tasks).
- **Consequences:** the files of this change. The next three pipeline runs are the check: their
  minutes per step against earlier runs (1 h 25 to 2 h 30 a task, 20 to 25 minutes a fix round).
- **Revisit if:** a reviewer or tester misses a defect it would have written up under the old
  sizes (then widen that role's size, not the rule); or a `none` turns out to be a real bug in
  product code (then it was weighed wrong, not parked wrong); or CI becomes a required check
  (GitHub Pro, R-34): a workflow that `paths-ignore` skips leaves a required check Pending, which
  blocks the merge, so the documents-only filter moves into the job first.

### D-088 · E00-T04a's packages: Tailwind, next-intl and shadcn/ui's, at these versions
- **Origin:** process, E00-T04a (builder). The packages are D-009's and D-015's (D-086 lists
  shadcn/ui's); this entry records the versions, as D-086 asks, and two choices around them.
- **What:** `tailwindcss` and `@tailwindcss/postcss` 4.3.3 (build only); `next-intl` 4.14.9;
  `radix-ui` 1.6.7, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0.
  `lucide-react` waits for the first icon. No package was removed or moved to another version.
  - next-intl 4.14 lists its message extractor's tools as dependencies, `@swc/core` and
    `@parcel/watcher` among them; both bring prebuilt binaries as optional packages, so their
    install scripts stay off in `pnpm-workspace.yaml`, as esbuild's and sharp's are.
  - `radix-ui` exactly 1.6.7 (July 2026): 1.7.0 came out hours before this task, too new to trust.
  - `cn()` is shadcn/ui's classic helper over clsx and tailwind-merge (`src/ui/cn.ts`). shadcn/ui's
    registry now imports it from a package named `cn` (0.4.0, September 2026), which D-086 does not
    list: not taken.
- **Revisit if:** next-intl drops the extractor's tools from its dependencies (remove the two
  `allowBuilds` lines); a radix-ui release after 1.7.0 has been out a few weeks (move to it).

### D-089 · Onest and Source Serif 4 replace Figtree and Newsreader, so Cyrillic shows in the app's own fonts
- **Origin:** **Owner, 2026-10-06,** in E00-T04a's Done pass (`handoffs/E00-T04a.md`): the font
  question D-086 left open ("Not decided"), answered "switch now", then "Onest + Source Serif 4"
  after three pairs were shown at real size in the sidebar and the Today heading (the design's,
  Onest + Source Serif 4, Manrope + Literata).
- **What:** the interface font is Onest and the heading font Source Serif 4, in place of the
  demo's Figtree and Newsreader. Sizes, weights and colours stay as `design-reference.md` has them.
  Both are SIL Open Font License 1.1 and cover Latin, Albanian's ë and ç, and Cyrillic with
  Macedonian's letters (fontsource lists `cyrillic` for both; Figtree only `latin` and
  `latin-ext`). They come as files in the repository, as D-086 says, the designers' own: Onest
  2.001's `Onest[wght].woff2` (github.com/simpals/onest, 84 KB) and Source Serif 4's variable
  roman woff2 (github.com/adobe-fonts/source-serif, 429 KB), the one file with weight 500, which the
  wordmark uses: the static files have no Medium. No package. The switch is in E00-T04b.
- **Why:** the first market is North Macedonia (D-049). A name written in Cyrillic showed in the
  computer's fallback font, unlike the text around it, headings most of all.
- **Revisit if:** a letter a clinic uses does not show in these fonts; or the heading font's
  first load is felt (429 KB, fetched once, then cached): then a subset of Latin and Cyrillic.

### D-090 · E00-T05 split in two: the seed now, `clinic:create` before staging; the seed runs with tsx
- **Origin:** E00-T05's refinement in E00-T04b's Done pass, 2026-10-06 (`handoffs/E00-T05a.md`).
  tsx: **Owner, 2026-10-06** (agent rule 4, a package).
- **What:**
  - E00-T05 is split. **E00-T05a**, the seed (normal), keeps E00-T05's place, before E01-T01.
    **E00-T05b**, `clinic:create` (critical: the first owner's login, a hosted database), comes
    after E00-T06b and before E00-T07, which needs it. The order: E00-T04b → E00-T05a → E01-T01 →
    E00-T04c → E00-T04d → E01-T02 → E00-T06b → E00-T05b → E00-T07 → the rest of E01. This
    replaces E00-T05's place in D-087's order.
  - `tsx` is a development dependency, at the version the lockfile already holds through
    drizzle-kit and vitest (4.23.15), so nothing new is installed. The seed runs with it and may
    import `@/`: it makes its logins with `createStaffUser()`, as D-063 says, which plain Node
    cannot load (`@/` and extensionless imports). `migrate.ts` and `reset.ts` stay plain Node.
  - The seed runs on this machine only, behind `db:reset`'s guard: its logins share one
    development password, written in `README.md`.
- **Why:** E00-T05 held two tasks of different risk and timing. E01-T01 needs the seed next; only
  staging needs `clinic:create`, whose setup link and database role are login and hosting
  questions, asked when it is refined. A seed that hashed its own passwords would make logins a
  second way, against D-063.
- **Revisit if:** staging needs the seed (E00-T07 decides; its password then comes from the host's
  secret store), or a script must run where development packages are not installed (E00-T05b in
  production: credentials never reach a development machine, `overview.md`).

### D-091 · E01-T01 split in two: the schema and the provider link, then the seed; two columns wait for the tables they point at
- **Origin:** E01-T01's refinement in E00-T05a's Done pass, 2026-10-06 (`handoffs/E01-T01a.md`).
- **What:**
  - E01-T01 is split. **E01-T01a** (critical: migrations, policies, the permission check): the
    seven scheduling tables, their constraints and indexes, and the provider link. **E01-T01b**
    (normal: rows on this machine only): the scheduling seed. The order: E00-T05a → E01-T01a →
    E01-T01b → E00-T04c → E00-T04d → E01-T02 → E00-T06b → E00-T05b → E00-T07 → the rest of E01.
    This replaces E01-T01's place in D-090's order; E00-T04c is refined in E01-T01b's Done pass.
  - A membership's provider kind comes from `clinics_for_user()`, which returns it beside what
    D-062 lists: every page and action already reads the user's clinics through it, before any
    clinic is set, so the sidebar and the action wrapper need no second query.
  - `patients.import_job_id` comes with `import_jobs` (E04-T01), `appointments.source_message_id`
    with `messages` (E02-T01), each with its foreign key, as `memberships.provider_id` comes with
    `providers` (D-062). `data-model.md` says so.
- **Why:** E01-T01 held about 600 lines of product code by estimate (seven tables with their
  policies, the provider link, 40 patients and a week of appointments), above the one-session size
  (`workflow.md`, about 400); the seed is local data and needs no critical review. A foreign key to
  a table that does not exist yet cannot be written, and a column without one would be the only
  unchecked link in the schema.
- **Revisit if:** `clinics_for_user()` must return more than a membership's own fields and its
  provider's kind: then a read inside the tenant transaction, not a wider cross-clinic function.

### D-092 · The staff form: how a form calls a wrapped action, with the clinic its frame names (E00-T04c)
- **Origin:** process, E00-T04c (builder): the bridge the task leaves to its builder, and D-072's
  "Revisit if" (useActionState's call shape). Builder choices inside the task.
- **What:**
  - The wrappers' call shape stays `action(clinicId, input)` (D-072). `StaffForm` gives
    useActionState a function of its own, `(previous, formData) => sendForm(action, clinicId,
    formData)`; its state is the answer and a count of attempts. The clinic id is the frame's:
    `FrameClinic`, filled by the staff layout with the clinic its sidebar names. `StaffForm` has
    no clinic prop. A page rendered for another clinic than its frame's refreshes the frame
    (`PageClinic`, `router.refresh()`).
  - The form's `action` is that dispatch (D-076's lint), but its `onSubmit` dispatches the form's
    data itself, in a transition: React 19 empties a form's fields after its form action, whatever
    the answer, so field errors would stand under empty fields. A ref drops a second submit while
    the first runs; the button is disabled meanwhile.
  - A call that rejects is answered `failed` inside that function: in the transition it would
    reach the nearest error boundary, and the app has none. Next.js's redirect is rethrown
    (`unstable_rethrow`): its router is already navigating. `noValidate`: a field's error is the
    server's, in the message file's words.
- **Why:** the smallest bridge that keeps D-072's checked call shape, keeps what was typed when
  the answer is a field error, and never runs an action in a clinic the person does not see named.
- **Revisit if:** React lets a form action keep its fields (then the dispatch alone sends it); a
  form must work before its script runs (then the action bound to the frame's clinic id,
  `action.bind(null, clinicId)`, D-072); a screen needs two clinics side by side (D-069).

### D-093 · Staff forms keep nothing in the browser; E00-T04d split in two; the permission test comes with E01-T02 (E00-T04c Done)
- **Origin:** E00-T04c's Done pass and E00-T04d's Ready pass, 2026-10-07 (PR #33 merged,
  `handoffs/E00-T04c.md`, `handoffs/E00-T04d.md`). **Owner, 2026-10-07:** staff forms switch the
  browser's memory off (the other choice: keep it, and find another fix). The rest is the architect's.
- **What:**
  - `StaffForm`'s form carries `autocomplete="off"`: no browser brings a staff form's fields back
    after a reload or Back, or offers past entries in them. The login form keeps its own, for the
    password manager. Built in E00-T04d; `security-privacy.md` section 8 says it.
  - E00-T04d is split (D-086's "Revisit if"): **E00-T04d**, the form fields and the memory switched
    off, critical (it changes `StaffForm`); **E00-T04e**, tabs, the drawer and the dialog, normal.
    Both come before E01-T02, where D-087's order has E00-T04d. The select is the browser's own,
    styled to the tokens: it sends what it shows and opens a tablet's own picker.
  - The test `test-strategy.md` asks for, every action × every role, comes with E01-T02's first real
    staff actions; E01-T02 is critical (permissions).
- **Why:** Firefox gives a form's fields back after F5, before the script runs: after a clinic switch
  in another tab, what was typed for one clinic comes back on the other's page (E00-T04c fix round 3,
  seen by its tester). Radix's checkbox, switch and select keep a hidden copy that re-syncs only when
  the value changes, so a restored copy sends what the screen does not show. One attribute closes
  both, and keeps patient details out of a shared computer's form history. E00-T04c came to about
  980 changed lines against 450–550 estimated; E00-T04d's seven components are about 600 as published.
- **Revisit if:** a field needs the browser's suggestions (its own `autocomplete`, never the form's);
  a browser restores fields despite the attribute (then reset the form on a reload); a select must
  show more than text (Radix's, with the hidden copy checked).

### D-094 · E00-T04d's package: lucide-react, for the first icons
- **Origin:** process, E00-T04d (builder). The package is D-009's, one of those D-086 lists for
  shadcn/ui's components; D-088 left it waiting for the first icon. This entry records its version,
  as D-086 asks.
- **What:** `lucide-react` exactly 1.47.0 (17 September 2026), in `dependencies`. The first icons
  are shadcn/ui's own: the checkbox's check mark (`CheckIcon`) and the native select's chevron
  (`ChevronDownIcon`). It has no dependencies of its own and no install script (React is a peer);
  only the icons a file imports reach the browser. An icon without a label of its own is drawn
  with `aria-hidden="true"`.
- **Why:** shadcn/ui's checkbox and native select import these icons from it, so the components stay
  as published. Exactly 1.47.0 rather than a range: lucide-react publishes a new version every few
  days, and a release that has been out a few weeks is the one trusted (D-088's reasoning for
  `radix-ui`); the newest, 1.52.0, was three days old.
- **Revisit if:** an icon is needed that lucide-react does not draw; a version after 1.47.0 has been
  out a few weeks and a component needs it (move to it).

### D-095 · Nothing typed about a patient stays in the browser: no field's own `autocomplete`, the search box too, and a browser re-check (E00-T04d Done)
- **Origin:** E00-T04d's Done pass, 2026-10-07 (PR #35 merged, `handoffs/E00-T04d.md`): three `data`
  lines from its review, delta review and critical review. The architect's, keeping the owner's
  D-093 true.
- **What:**
  - In a staff form no field sets an `autocomplete` of its own but `off`: WebKit (Safari, an iPad
    at the desk) gives such an input back after Back inside an `autocomplete="off"` form, under
    another clinic's page too. This replaces D-093's "Revisit if" first case (a field that needs
    the browser's suggestions sets its own): such a field comes back to the architect first.
  - A field outside a staff form that takes patient details (E01-T02's search box, E01-T05's
    patient search) is `autoComplete="off"` itself, and a search's words go in the request's body
    (a `staffRead` action), never in the page's address (`?q=…`).
  - E00-T06b checks D-093 in a real browser, Firefox among them: a browser that starts giving
    fields back turns CI red. The task texts hold the detail; `CLAUDE.md` and
    `security-privacy.md` section 8 say the rule.
- **Why:** D-093's attribute guards `StaffForm`'s `<form>` only, and was checked once, by hand. The
  browser's history and the host's request log keep an address: patient data in a log.
- **Revisit if:** a field needs the browser's suggestions (then the form is reset when the page is
  shown again, checked in WebKit); a search must live in the address (to share or bookmark it).

### D-096 · E01-T02 split in two, and editing moves to the profile; the trigram indexes go; Q-11 answered (E00-T04e Done)
- **Origin:** E00-T04e's Done pass, 2026-10-07 (PR #37 merged; `handoffs/E00-T04e.md`,
  `handoffs/E01-T02a.md`). **Owner, 2026-10-07:** the two trigram indexes on `patients` are removed;
  Q-11 is answered: every staff member sees every patient of their clinic. The rest is the architect's.
- **What:**
  - E01-T02 is split. **E01-T02a**, the list and the search, critical (the test of every action and
    every role, D-093; the migration below), with the logger's safety net and the clinic's time
    zone. **E01-T02b**, adding a patient, normal. Editing a patient's details, status among them,
    moves to **E01-T03**, the profile, which shows the same record. The order: … → E00-T04e →
    E01-T02a → E01-T02b → E00-T06b → E00-T05b → E00-T07 → the rest of E01. This replaces E01-T02's
    place in D-091's order.
  - `patients_full_name_trgm_idx`, `patients_phone_e164_trgm_idx` and `pg_trgm` go, in a migration
    of E01-T02a: under Row-Level Security the app's search can never use them (their operators are
    not leakproof). The search reads the clinic's patients through its own key, under 300 ms at
    20,000 patients (E01-T02a's criterion). `data-model.md` says so.
  - Q-11: every member of a clinic sees every patient of it, D-021's default made the owner's answer.
    A read of patients names `every_member`.
- **Why:** E01-T02 held about 1,000 lines of product code by estimate (a module, a list and a form
  page, a duplicate check, phone numbers, the time zone), more than twice the one-session size
  (`workflow.md`); E00-T04c's 980 took three fix rounds. E01-T02a is about 500 by estimate,
  E01-T02b about 400. The list is what a receptionist needs first, adding comes next, and editing
  sits where the record is shown. Indexes nothing can use only cost writes, and `data-model.md` said
  the search used them.
- **Revisit if:** a clinic's search gets slow (then a search that works under the policies, such as a
  table of search keys per clinic, never a function that skips them); a role must not see every
  patient (a `patients.view` permission, and the permission test's table).

### D-097 · libphonenumber-js 1.13.13 for phone numbers (E01-T02a, E01-T02b)
- **Origin:** stack, E01-T02's refinement in E00-T04e's Done pass. **Approved by the owner on
  2026-10-07** (agent rule 4: new library). The stack table in `overview.md` named it without a
  decision, as it named Zod before D-068.
- **What:** `libphonenumber-js` exactly 1.13.13 (10 September 2026), in `dependencies`, with its
  default metadata. E01-T02a shows a stored number as the clinic's people write it (the national
  form for the clinic's own country, the international one otherwise), formatted on the server so
  the metadata stays out of the browser. E01-T02b reads a typed number with the clinic's
  `default_country` into E.164 and refuses an impossible one (a length no number of its country
  has); a possible number the package does not know is kept, so a new range is never refused at the
  desk. MIT licence, no dependencies, no install script.
- **Why:** phone numbers differ by country in length, trunk prefix and grouping, and the package
  carries Google's libphonenumber metadata for every country, which one developer cannot keep by
  hand. Exactly 1.13.13 rather than a range: it publishes every two weeks, and a release out a few
  weeks is the one trusted (D-088, D-094); 1.13.14 was two weeks old.
- **Revisit if:** a pilot clinic's numbers are refused or misread (move to a newer version that has
  been out a few weeks); the browser must read numbers itself (then weigh the metadata's size).

### D-098 · Screens with patients: a list is no record view, rows keyed by clinic, dates through the formatter, the clinic's checks refused above the button (E01-T02a Done)
- **Origin:** E01-T02a's Done pass and E01-T02b's Ready pass, 2026-10-08 (PR #39 merged;
  `handoffs/E01-T02a.md`, `handoffs/E01-T02b.md`): two `data` lines and a `slice` line from
  E01-T02a's review and fix round 2, and E01-T02b's phone. The architect's.
- **What:**
  - A list or a search of patients is not a patient record view: no audit row, and what was typed
    is written nowhere. A record view is one patient's profile or edit page opened (E01-T03), so
    E01-T05's search and E01-T02b's duplicate warning write none (`security-privacy.md` section 10).
  - A client component that keeps state made from its page's rows is keyed by the page's clinic
    (`key={staff.clinic.clinicId}`), as the patient list is. A review check in `CLAUDE.md`.
  - A moment is shown through next-intl's formatter, which carries the clinic's zone; a calendar
    date is formatted in UTC, never in the clinic's zone (`CLAUDE.md`, Dates and times).
  - A check the input alone settles is the schema's, shown at its field. One that needs the clinic's
    settings or rows (a phone read with the clinic's country, a day already closed) is the handler's
    refusal, shown above the button with a text that names the field. How `StaffForm` shows an
    answer does not change.
- **Why:** E01-T02a's builder settled the audit question in a code comment; the stale rows were found
  by hand in a critical review, and no test sees the next ones; next-intl shows a date of birth on the
  day before in a zone behind UTC. The wrappers parse the input before the clinic's transaction
  opens, so no schema can read its country; showing a refusal at a field would change `StaffForm`,
  which made E00-T04d critical (D-093), for a red border and the focus.
- **Revisit if:** a clinic or the law asks who searched for whom (then a row per search, without its
  words); a form needs a refusal marked at its field (then `StaffForm`'s `refusals` names the field,
  typed by the action's codes and input keys, in a critical task).

### D-099 · The tests run once, in UTC: the Auckland steps leave CI and the agents' machines (owner, PR #42)
- **Origin:** **Owner, 2026-10-08:** PR #42 took the Auckland steps out of CI; asked in E01-T02b's
  Done pass, the owner chose "gone everywhere". Replaces D-075's "then the unit and integration
  tests again with `TZ=Pacific/Auckland`" and the Auckland step name D-078 gives as an example.
- **What:**
  - CI runs each check once, in UTC; builders and testers no longer run the Auckland steps
    (`CLAUDE.md`, "CI"; `builder.md`; `test-strategy.md`, "Hidden local time").
  - Code that handles moments or days is guarded by its own tests, which name the zones they run in
    and never rely on the computer's, as `patient-list.test.ts` and `new-patient-form.test.ts` do.
    E02-T02's send-time tables also run with the process's zone set to `Pacific/Auckland` in the test.
  - The seed's day (`seed-day.test.ts`, `02-scheduling.test.ts`) had only the second run: it is now
    tested in the computer's zone alone. Accepted, `none`: the seed runs on this machine only.
    E00-T06b corrects the five comments that still say CI repeats the tests in Auckland.
- **Why:** the two steps took about 3 of a run's 7½ minutes (run 37806088255 with them; 37807574106
  without, 4 min 21 s), and every pipeline round waits for a run.
- **Revisit if:** a bug from the computer's time zone reaches `main` (then the Monday run repeats
  the tests in Auckland, the owner's second option).

### D-100 · E00-T06b refined: Playwright and axe-core, Chromium on every run and three browsers on Mondays and before each hand-off, the components page on `next dev`, the clock its own task
- **Origin:** E00-T06b's Ready pass, in E01-T02b's Done pass, 2026-10-08. **Owner, 2026-10-08:**
  the accessibility check uses axe-core (a library, agent rule 4); CI runs the journeys in Chromium
  on every pull request and push, and in Chromium, Firefox and WebKit on the Monday run; agents run
  all three. The rest is the architect's. Replaces D-075's "the test clock control stays in E00-T06b".
- **What:**
  - Development packages, exact: `@playwright/test` 1.63.0 (D-012); `@axe-core/playwright` 4.13.0
    with `axe-core` 4.13.0 (MPL-2.0). Releases out a few weeks (D-094): 1.64.0 was a day old.
  - J1 tests the production build (`next start`, a port of its own) against `<database>_e2e`,
    rebuilt and seeded each run, in steps of CI's one job after the build. `/dev/components` stays
    out of production builds: its checks reach it on `next dev`, a second server on that database
    (Next 16 writes `next dev`'s output to `.next/dev`, beside the build). No product code changes.
  - The builder runs the journeys in all three browsers before every hand-off, as it runs
    `pnpm build`: D-095's "turns CI red" holds on the Monday run, and the builder's run sees it first.
  - The test clock control becomes E00-T06c, before the first journey that sets "now"; J1 does not.
- **Why:** axe-core is the engine most accessibility tools run, with no service. Chromium alone adds
  an estimated 1½ minutes to the 4½ PR #42 left; it restores no fields on reload, so the two
  browsers that do run where no pull request waits. A switch opening the page in a production
  build would make the task critical (production configuration), and better-auth's origin check
  would not stop a script; D-093's check looks at the form's attributes, the same in both builds.
- **Revisit if:** a Monday run fails in Firefox or WebKit alone (then they run on every pull
  request); a run takes over 10 minutes; the builder's three-browser run takes more than a few
  minutes; a journey needs a set "now" before E00-T06c is built.

### D-101 · `clinic:create`: the first owner chooses a password through a one-time link; the script writes as the app role; on a host it runs in the image, as the worker does
- **Origin:** E00-T05b's Ready pass, in E00-T06b's Done pass, 2026-10-09. **Owner, 2026-10-09:** the
  first owner gets in through a one-time link to a page where they choose their own password; the
  link works for 3 days; the script uses the app's own database login, given the right to add a
  clinic and its members (login, links, tenant isolation: agent rule 4). The rest is the architect's.
- **What:**
  - The link carries the auth library's own password-reset token for the new person, who has no
    password until then: at least 128 random bits, one use, 3 days, only its SHA-256 hash stored
    (`verification.storeIdentifier: 'hashed'`), after `#` so no request log or Referer holds it. The
    page `/login/set-password` sends it with the new password to the library's `/reset-password`.
  - Migration 0004 grants the app role `INSERT` on `clinics` and `memberships`, nothing more. The
    script writes the clinic, the membership and its audit row inside `withTenant` for the new
    clinic, so Row-Level Security binds it. A page or an action cannot add a clinic with it: its
    `withTenant` is for its own clinic, which exists already.
  - It runs on this machine, and against a hosted database only with an explicit flag: there, in the
    app's image as the worker runs (E00-T07), never from a development machine against production
    (D-044). This answers D-090's "Revisit if" for E00-T05b. No new setting.
- **Why:** nobody but the owner ever knows their password, and neither a library nor a table is
  added. As the migration role the script would run past the policies, and a module function that
  relies on them (`clinicPlace(tx)`) would read any clinic's rows (E01-T02a critical review). The
  worker needs our TypeScript in the image anyway.
- **Revisit if:** E04-T00 gives invites their own token (`staff_invites.token_hash`,
  `data-model.md`) rather than this one; a page or action must create a clinic (none does in v1,
  D-042); the host cannot run a one-off command in the image.

### D-102 · E00-T07 split in three; pg-boss now and Sentry later (owner); the web's health check never waits on the worker; E00-T12 for the logger's net
- **Origin:** E00-T07's Ready pass, in E00-T05b's Done pass, 2026-10-10. **Owner, 2026-10-10:**
  pg-boss is added (D-005), its tables shared by every clinic and a job's data ids only; Sentry not
  now, errors stay in the host's logs until E07-T03; staging's cost decided later (Render has no
  free worker, its free database is deleted after 30 days without backups, and free services have
  no shell to run `clinic:create`). The rest is the architect's.
- **What:**
  - E00-T07 is split: **E00-T07a**, the image, `/api/health` and the start-up refusals, tried on
    this machine; **E00-T07b**, the worker and pg-boss; **E00-T07c**, staging on Render (builder +
    owner), once the owner has decided its cost. Sentry and its noise filters move to E07-T03;
    D-013 stands, later.
  - `/api/health` is the host's check of the web alone: the database answers, through a login that
    cannot get past the policies, with an auth secret that is not the example's. It never waits on
    the worker, which an external monitor watches (E00-T07c).
  - pg-boss's schema is made by a migration, as the migration role, from the SQL pg-boss gives for
    its pinned version; the worker runs it as the app role, with no migration, no schema change and
    no run-time partitions. Its tables join `GLOBAL_TABLES` (`data-model.md` section 1).
  - **E00-T12**, new: the logger's net before E02, from two E00-T01 lines (owner, 2026-10-03) and
    E00-T05b's whole-name plurals.
- **Why:** E00-T07 held four outcomes, three accounts and a deploy; its first two parts need no
  account. A host restarts a web whose check fails, so a check that waited on the worker would take
  the staff app down with it, while "if the worker is down, jobs wait" (`overview.md`). The app role
  cannot make pg-boss's tables (`CLAUDE.md`, database roles).
- **Revisit if:** the host treats a failed check otherwise (E00-T07c); pg-boss must change its
  schema while it runs; the owner wants Sentry before the pilot.

### D-103 · The image: production dependencies only, tsx among them; a script runs as `node --import tsx`; the build needs no setting
- **Origin:** E00-T07a (builder), 2026-10-10: the task's choice between tsx in the image and a bundle
  made at build time (D-090's "Revisit if", D-101). It moves a package, hence this entry.
- **What:**
  - `tsx` moves from `devDependencies` to `dependencies`, at the same version (4.23.15): the
    lockfile changes in its importers section only. The image installs the production dependencies
    alone (`pnpm install --prod`), so `pnpm audit --prod` covers everything it holds (D-075); tsx
    brings esbuild 0.28.2, which has no advisory. This replaces D-090's "`tsx` is a development
    dependency".
  - `Dockerfile`: Node.js 24 on Debian 13 slim; pnpm, at `package.json`'s version, only in the stages
    that install. The image holds the build (`.next`, without its build cache), the production
    dependencies, `src/`, `package.json`, `next.config.ts` and `tsconfig.json`; it runs as the
    `node` user, with `NODE_ENV=production` and `NEXT_TELEMETRY_DISABLED=1`. The web is
    `node node_modules/next/dist/bin/next start`, so Node.js gets the host's stop signal; a script
    is `node --import tsx <file>` (`clinic:create`; the worker, E00-T07b). No pnpm in the image.
  - `currentUser()` reads the request's headers before it makes the auth library: `next build` then
    stops trying to prerender a page there, so the image is built with no setting at all (without
    one, the build failed on `/_not-found`: `BETTER_AUTH_URL is not set`).
- **Why:** a bundle needs a bundler as a direct dependency, a new package; installing every
  dependency would put the development tools, and their advisories, where patient data is; pnpm adds
  a process between the host and Node.js and runs nothing the image needs.
- **Revisit if:** the worker starts too slowly or uses too much memory under tsx (E00-T07b); the
  image's size (about 1 GB unpacked) matters on the host (E00-T07c: `output: 'standalone'`); Node.js
  runs our `@/` imports itself.

### D-104 · pg-boss 12.37.1, kept in `src/db/` with the other drivers; its schema with fixed table names, never changed while it runs; a failed job keeps a code
- **Origin:** E00-T07b's Ready pass, in E00-T07a's Done pass, 2026-10-10: architect choices inside
  D-102 (owner: pg-boss now), from a probe of 12.37.1 as the app role (`handoffs/E00-T07b.md`).
- **What:**
  - pg-boss **12.37.1** exactly (schema version 45), with the peer it requires, `@opentelemetry/api`,
    whose calls do nothing without a tracing SDK, and Chairside installs none.
  - It lives in `src/db/queue.ts`: lint already allows a `pg-…` package only in `src/db/`. This
    replaces D-077's "the worker's folder joins the list for pg-boss"; D-071's "the worker's job
    handler joins these lists" moves to the first job that opens a tenant transaction (E02).
  - Its migration is pg-boss's own SQL without its `BEGIN;`/`COMMIT;` and without the two
    statistics partitions it names after the day it runs; the app role gets the rows of the tables
    the worker uses. It runs with `migrate: false`, no statistics, no reindexing, no partitioned
    queue, and always an `'error'` listener.
  - A failed job keeps the code `job_failed`, never its error; the worker does not start while
    `databaseProblem()` names a problem (E00-T07a).
- **Why:** the app role cannot create tables, and pg-boss's defaults would try (statistics: two days
  after the migration); a dated table name defeats the meta-test's allow-list; pg-boss keeps a
  failed job's error for days, in a table every clinic shares.
- **Revisit if:** pg-boss is upgraded (a new migration, from its `getMigrationPlans`); its statistics
  are wanted; a job must be sent in a data change's transaction (E02-T06).

### D-105 · E00-T07b Done: its one timing-dependent test becomes E00-T07d, E00-T07c's three `data` refusals become E00-T07e, and staging runs on paid plans (owner)
- **Origin:** E00-T07b's Done pass, 2026-10-11 (PR #50 merged). The first run on `main`
  (38138989218) is red, and the owner answered three questions in that pass
  (`handoffs/E00-T07b.md`, the architect's Done-pass section).
- **What:**
  - **`main` is red on one test, and that test is E00-T07d.** `queue.test.ts` › "keeps only
    pg-boss's words in the row of a job whose handler runs past its time" asserts the handler ran
    exactly three times; on `main` it ran six. The code is byte-identical to the pull request's head
    (`782c5ed`, run 38093609496, green), so the expectation, not the product, depends on timing: the
    retry is claimed while the previous run's handler is still ending, the overlap the task's own
    critical review wrote up (its suggestion 1). **Owner, 2026-10-11:** a task of its own, first, and
    its own pull request. Rule 8's "let the owner decide" is settled here, so its builder does not
    stop again.
  - **E00-T07c is split.** Its three `data` refusals from E00-T07a (the health check judging
    `current_user`, `BETTER_AUTH_TRUSTED_ORIGINS` not refused, the clinic cookie's Secure read from
    the `https://` prefix) become **E00-T07e**, which needs no Render account; E00-T07c keeps the
    host, its database, the monitor and the runbook. Order: T07a → T07b → T07d → T07e → T07c. The id
    E00-T07c and its title are unchanged, so every document that names it still points at staging.
    **Owner, 2026-10-11:** yes, now, right after E00-T07d.
  - **Staging runs on the smallest paid plans for the web, the worker and the database**
    (**owner, 2026-10-11**), which closes the board's standing action: nothing sleeps, the database
    keeps its data and its backups, and `clinic:create` can be run on the host.
- **Why:** three `data` findings about login and tenant isolation were waiting behind a money
  decision and the whole of E01; a flaky test on `main` turns later runs red and hides the next real
  failure; a free Render database is deleted after 30 days, so staging's clinic would be remade every
  month and `clinic:create` could not be run there at all.
- **Revisit if:** E00-T07d finds the overlap is the product's fault after all (then E02-T06 and
  E02-T07's folded-in work moves earlier); staging's bill is higher than the owner expects; a later
  pg-boss gives a queue a retry delay by default.

### D-106 · The red run on `main` was a second scheduled job at a minute boundary, not a retry overlap; the job-past-its-time case follows one job
- **Origin:** E00-T07d, 2026-10-11, from a probe of pg-boss 12.37.1 against `<db>_test`
  (`handoffs/E00-T07d.md`). It answers D-105's "Revisit if".
- **What:**
  - A pg-boss schedule (`* * * * *`, the only way a test sends a job today) sends a job **at every
    minute boundary its queue is worked over**, besides the one it sends at once. So any case of
    `tests/integration/queue.test.ts` whose window crosses a boundary gets a second job.
  - Measured on a queue with `expireInSeconds: 1`: every job runs **exactly three times** (a claim
    and its two retries; `pgboss.job.retry_count + 1` counts the claims), with a retry delay of 0 s
    as with 3 s. So the six runs of the red run (38138989218) were **two jobs of three runs**, not
    three attempts of two runs: the retry overlap D-105 named is not what reddened `main`, and a
    `retryDelay` would not have fixed it.
  - The case therefore follows **the first job its handler ran**, by that job's id: it waits for
    pg-boss to have failed that job for good (after which no run of it can follow) and reads the
    number of runs off `retry_count`. No count of runs is written in the test any more.
  - **The overlap itself stays a real risk for E02** (E02-T06 and E02-T07's Do items, `message`): a
    handler that *ignores* its abort signal does run on while its retry is claimed. Those items
    stand unchanged; only the diagnosis of this one test's red run was wrong.
- **Why:** a test that waits for a number of handler runs measures the wall clock, not the product;
  the number of jobs a minute-cron sends is nobody's promise.
- **Revisit if:** pg-boss's schedule sends occurrences differently (an upgrade); the file's other
  cases, which all expect `jobsOf(queue)` to hold exactly one row, are made boundary-proof too (a
  Discovered line of this task); E02 gives a test a way to send one job without a schedule.

### D-107 · E00-T07d Done: every case of the queue test file follows its own job (owner); a test that pg-boss's clock drives never counts a queue
- **Origin:** E00-T07d's Done pass, 2026-10-11 (PR #52 merged; `main` green, run 38169317311).
  D-106's "Revisit if" is met: fix round 1 found the file's first case red at a minute boundary on
  the task's own pull request (run 38153768052), and the owner widened the task to the whole file
  (option 1, `handoffs/E00-T07d.md`).
- **What:**
  - Every case of `tests/integration/queue.test.ts` follows the job its handler got, by id; a job a
    boundary adds is only checked to be waiting. No case reads its queue as one row.
  - **D-106's wording, corrected here** (D-106 stays as written): "No count of runs is written in
    the test any more" holds for a queue's runs. The job a case follows is pinned to three runs, a
    claim and pg-boss's two default retries (`retry_limit` 2, migration 0005): deterministic, and it
    pins that default.
  - **A convention** (`test-strategy.md`, principle 3): a test whose jobs pg-boss sends on the
    database's clock follows the job it means, by id, and never counts a queue's jobs or runs. A
    review check.
- **Why:** a count of a minute schedule's jobs measures the wall clock: the file went red about one
  run in six to ten with nothing wrong, and a red run on `main` hides the next real failure (D-105).
- **Revisit if:** `tests/integration/worker.test.ts`'s two stop-signal cases, which still read their
  scheduled queue as one row (rare: fix round 2's probes of the same shape never met a second job),
  go red with two jobs: they follow their job the same way; E02 gives a test a way to send one job
  without a schedule (D-106).

### D-108 · The calendar reads its day again when it is used, never on a timer (owner); E01-T04 split in two; the day helpers in one place
- **Origin:** E01-T04's Ready pass, inside E00-T07d's Done pass, 2026-10-11 (`handoffs/E01-T04a.md`).
  D-041's refresh every 30 seconds would keep a session alive on a screen nobody uses, which D-067
  ("nothing renews the session in the background") and `security-privacy.md` section 2 (sessions
  end after 30 minutes of inactivity, clinic computers are shared) do not allow.
- **What:**
  - **Owner, 2026-10-11:** the calendar reads its day again when someone uses it (the window
    regains focus or becomes visible, a pointer, a key or a touch on the page), at most once every
    30 seconds, and whenever the day changes. Never on a timer: a page nobody touches asks the server
    nothing, so the 30-minute sign-out holds. This replaces D-041's mechanism; E02-T09's "within its
    refresh interval" becomes "the next time someone uses the calendar".
  - **E01-T04 is split in two:** E01-T04a, the day view (the day's data from four modules, the grid,
    the hours, Previous / Today / Next), and E01-T04b, the provider filter, a linked provider's own
    column, the "now" line and the reading on use. As one task, about 700 lines of product code,
    against the Definition of Ready's 400.
  - `isCalendarDay`, `dayInZone`, `addDays` and `isoWeekday` move to `src/lib/calendar-day.ts`; the
    seed and the patients module use them from there (E01-T02a's leftover: no third copy).
- **Why:** patient data safety beats a calendar that changes while nobody looks (`intent.md`, "How to
  decide", 1); a timer that does not count as use needs the proxy to tell it apart, a change to login
  for one screen; in E01 only staff change appointments, and the database refuses a double booking
  (D-020).
- **Revisit if:** E02 (patients confirm and cancel by link) needs a screen to change while nobody
  touches it; the receptionist trial (Q-09) finds the calendar stale.

### D-109 · E00-T07e Done: the auth library's origin and CSRF checks stay on whatever the environment says, as E00-T07f, right before staging (owner)
- **Origin:** E00-T07e's Done pass, 2026-10-12 (PR #54 merged; `main` green, run 38190640837), from
  its review's `data` line. The detail: E00-T07f's section and `handoffs/E00-T07f.md`.
- **What:**
  - better-auth 1.7.7 skips its origin check, and with it its CSRF checks, while `NODE_ENV` is `test`
    or `TEST` holds anything but `false` (even `0`), on a host too: a sign-in is then taken from any
    site, which D-063's "the only trusted origin" does not allow. Vitest sets both, so no test runs
    the check today.
  - **E00-T07f** gives `createAuth()` the library's own two switches, `advanced.disableOriginCheck`
    and `disableCSRFCheck`, as `false`: an explicit value comes before the library's test detection,
    so the checks run on every host and in every test. No fifth start-up refusal: vitest sets `TEST`
    and runs every test with `NODE_ENV=test` (architect).
  - **Owner, 2026-10-12:** E00-T07f runs right before E00-T07c, once the owner has the Render
    accounts; the rest of E01 goes first. Order: T07e → T07f → T07c.
- **Why:** the same hole as `BETTER_AUTH_TRUSTED_ORIGINS` (E00-T07e) through two other settings; one
  change closes both, where a refusal would refuse the tests; no host exists before staging, and
  staging holds invented data only.
- **Revisit if:** a later better-auth decides these checks another way (its notice says
  `disableOriginCheck` will stop switching the CSRF check); E01 is done before the accounts exist
  (then the owner places E00-T07f again).

### D-110 · E01-T08 split in two, the first beside E01-T04a in a second checkout (owner); a clinic's zone is a name the database and Intl both know; the settings accessor moves to E02-T06, the guard on `status` to E02-T01
- **Origin:** E01-T08's Ready pass, 2026-10-12 (`handoffs/E01-T08a.md`). **Owner, 2026-10-12:**
  E01-T08 runs at the same time as E01-T04a, in a second checkout; each edits only its own board row
  and its own handoff note; the second to merge rebases on `main`. And E01-T08a may change
  `staff-pages.test.ts` for `/settings` (agent rule 8). The rest is the architect's.
- **What:**
  - **E01-T08 is split in two:** E01-T08a, the Settings page and the clinic's details, beside
    E01-T04a; E01-T08b, opening hours and closed days, after E01-T04a, whose reads of those tables it
    uses and whose calendar its criteria check. As one task about 950 lines of product code, against
    ~400.
  - **A clinic's zone** is one of PostgreSQL's region names, or `UTC`, stored in PostgreSQL's
    spelling, and one Intl knows: never an offset or an `Etc/` zone. A probe on Node 24 (ICU 77.1) and
    the `postgres:18` image: Intl spells 18 zones the old way (`Europe/Kiev`), which the database does
    not know, and lacks `UTC` and `Europe/Kyiv`; the database reads the text `+01:00` as an hour west
    of UTC, Intl as an hour east. One function in `tenancy`, for Settings and `clinic:create`. This
    replaces E01-T08's "the name Intl resolves".
  - **The typed accessor for `clinics.settings`** moves to E02-T06, its first reader: E01 stores no
    key in it.
  - **Staff never change `clinics.status`**, the clinic's pause (D-030): E01-T08a's save names its
    columns, and E02-T01 grants the app role UPDATE on `clinics` by column, `status` left out.
- **Why:** a task twice the size, two builders writing the same `tenancy` files at once; the zone must
  mean the same in SQL (`AT TIME ZONE`) and on the page; code nobody runs waits for its first reader;
  the pause means nothing before E02-T07, and E02-T01 writes a critical migration anyway, where one
  grant would have made E01-T08a critical.
- **Revisit if:** Node's Intl comes to spell zones as the database does, or the database image ships
  the old names; the parallel run costs more in rebases than it saves (the board's line goes).

### D-111 · E01-T08a Done: E01-T08b split again, its opening hours beside E01-T04b (owner); the clinic's phone shown with its country code; WhatsApp's values made one line
- **Origin:** E01-T08a's Done pass, 2026-10-12 (PR #59; `handoffs/E01-T08a.md`, `handoffs/E01-T08b.md`).
  **Owner, 2026-10-12:** E01-T08b runs beside E01-T04b in the clone, under D-110's rules (the board's
  line). The rest is the architect's.
- **What:**
  - **E01-T08b is split in two:** the opening hours and the phone below (E01-T08b), then the closed
    days on the same tab (E01-T08c). Together about 700 lines of product code by estimate, against ~400.
  - **The clinic's phone is shown in Settings with its country code** (`+389 70 001 402`), no longer as
    the clinic writes it: shown nationally, a phone left as it was while the phone country changed was
    read as a number of the new country (E01-T08a, `message`).
  - **WhatsApp's variable values are made one line** (E01-T08a review, `message`): Meta refuses a
    parameter holding a new-line, a tab, more than four spaces in a row, or nothing. E02-T03 makes each
    run of white space one space and fails closed on an empty value; `messaging.md` says so.
- **Why:** a small diff can be reviewed, and E01-T08a's parallel run cost one conflict of two lines; a
  "+" number reads the same in every country, with no field added; one rule where WhatsApp's values
  are made covers every name, the clinic's, a patient's, a provider's.
- **Revisit if:** a clinic wants its number shown as it writes it (then keep a phone nobody touched by
  what the page showed); Meta's documents give other limits (E03-T03 checks them).

### D-112 · E01-T08b Done: E01-T08c beside E01-T05, booking ahead of E01-T09 and E01-T03 (owner); the second to merge is checked on the merged tree
- **Origin:** E01-T08b's Done pass, 2026-10-13 (PR #62; `handoffs/E01-T08b.md`, `handoffs/E01-T08c.md`).
  **Owner, 2026-10-13:** E01-T08c runs in the clone beside E01-T05 in the main checkout, under D-110's
  rules (the board's line). The rest is the architect's.
- **What:**
  - **E01-T05 moves up:** booking runs beside E01-T08c, ahead of E01-T09 and E01-T03 in the epic's
    order. It depends only on Done tasks (E01-T04a, E01-T02b) and books with the seed's treatment
    types, which E01-T09 makes editable later. E01-T04b's Done pass makes it Ready.
  - **The second to merge** has `main` merged into its branch, never rebased (no force-push, agent
    rule 14), and passes `pnpm check` on the merged tree before it is pushed. This replaces D-110's
    "rebases on `main`".
- **Why:** booking is the most used action and the one a receptionist judges first (R-09); the two
  tasks write different modules (`scheduling`, `tenancy`), their likely meeting points the message file
  and the permission test. In the second round git merged `main` with no conflict and the tree did not
  type-check (an E01-T08b test against E01-T04b's locale, fixed in `43db241`): a clean merge is not a
  checked one.
- **Revisit if:** a merge costs more than the parallel run saves (then one task at a time, and the
  board's line goes); E01-T05 needs a setting that only E01-T09 makes.

### D-113 · E01-T04b Done: E01-T05 split in two, an existing patient first; only active patients are booked (owner); the nested-form guard moves to E01-T06
- **Origin:** E01-T04b's Done pass, 2026-10-13 (PR #63; `handoffs/E01-T04b.md`, `handoffs/E01-T05a.md`).
  **Owner, 2026-10-13:** only active patients can be booked; an archived or deceased one shows in the
  drawer's search with their label and cannot be picked, and an archived one is made active on the
  profile first (E01-T03). The rest is the architect's.
- **What:**
  - **E01-T05 is split in two:** E01-T05a, booking an existing patient from New appointment (the
    scheduling module's first write, the drawer, the search, the treatment chips, start, length and
    provider, an overlap refused, the block on the grid at once), in E01-T05's place beside E01-T08c
    (D-112); E01-T05b after it: the overlap warning with "Book anyway" and one booking per click, a
    click on an empty slot, a new patient in one go. As one task, about 850 lines of product code by
    estimate against the Definition of Ready's 400; E01-T05a about 500 with comments.
  - **Only active patients are booked** (owner): the booking action refuses another. `scope-v1.md`
    says so, with the drawer's two other differences from the demo (no treatment chosen by default;
    the open-treatment hint with treatment plans, M6).
  - **The guard that keeps a form's `submit` inside its drawer or dialog moves to E01-T06**, the first
    task with a staff form inside another's React tree (the cancel dialog over the move form):
    E01-T05b's new patient is fields of the booking form, not a form of its own.
- **Why:** a slice that books end to end first (`intent.md`, "How to decide", 4), each part one
  session; E02 sends nothing to an archived or deceased patient (E02-T05), so such a booking would get
  no reminder, silently, the failure `intent.md` names worst.
- **Revisit if:** E01-T05a runs far over its estimate (then E01-T05b is split again before it starts); a
  returning archived patient must be booked faster than the profile allows (E01-T03); E01-T05b's new
  patient needs a form of its own after all (then the guard comes back to it).

### D-114 · E01-T05a Done: E01-T05b split again; a warning line for breaks, hours and closed days, Book under the fields, no archive while visits are ahead (owner); a visit booked after its start gets no message
- **Origin:** E01-T05a's Done pass, 2026-10-19 (PR #67; `handoffs/E01-T05a.md`, `handoffs/E01-T05b.md`).
  **Owner, 2026-10-19:** Book stays under the drawer's fields, not in the demo's bar along its foot;
  the drawer warns in one line when a booking falls in the provider's break, outside the opening
  hours or on a closed day, and Book still books it; a patient with a visit booked ahead is not
  archived or marked deceased until it is cancelled or moved (E01-T03). The rest is the architect's.
- **What:**
  - **E01-T05b is split again** (D-113's "Revisit if": E01-T05a came to about 1,350 lines of product
    code with comments, against 500): E01-T05b, the overlap warning with "Book anyway", one booking
    per click and the warning line; E01-T05c, a click on an empty slot, and a double click's second
    press changes nothing in a drawer or dialog; E01-T05d, a new patient in one go. Each is sized
    from the lines E01-T05a measured, about 220–300.
  - **A visit booked after its start is allowed** (a walk-in entered after the visit; E01-T05a
    builder, `message`): nothing refuses a start before now, and no booking confirmation or reminder
    goes out for it (`messaging.md`, "Booking confirmation"; `test-strategy.md`, "Message timing").
- **Why:** each part one session (the Definition of Ready), sized from what was built, as the
  drawer's estimate missed by most. A warning costs no click and catches a wrong pick before a
  reminder goes out for it; an archive that left visits ahead would leave them without a reminder,
  silently (D-113's reason). Refusing a past start would stop the desk recording a walk-in; the
  message rules are where a wrong message is stopped.
- **Revisit if:** E01-T05b runs far over its estimate again (then E01-T05c and E01-T05d are sized
  again first); the receptionist trial (Q-09) finds the warning line noise.

### D-115 · E01-T08c Done with its last review's change open: the fix is E01-T08d, at the end of E01 (owner); the closed days' layout kept (owner)
- **Origin:** E01-T08c's Done pass, 2026-10-19 (PR #66, merged by the owner on 2026-10-14 with its
  delta review's required change open; `handoffs/E01-T08c.md`). **Owner, 2026-10-19:** the fix runs
  not now but at the end of E01, before its hard look (E01-T11); the closed days' layout, which the
  demo lacks, is kept; each Remove stays teal, as every staff form's button. The rest is the architect's.
- **What:**
  - **E01-T08d, new:** a double click's second press on the closed days changes nothing, wherever the
    page scrolls after the first (the delta review's `message` change: with the list's heading above
    the window, the focus after a Remove scrolls another day's Remove under the pointer before the
    guard starts). In E01's order after E01-T10, before E01-T11, whose tester then looks at it.
  - **The Done pass ran on a row still "In progress"**, as its pull request was merged and the board
    named the pass: the open change was weighed as a leftover (`message`, so its own task, rule 15).
  - **The layout** (a section under the week: each day with its label and a Remove, the add form under
    a line) is the reference for the screen (`design-reference.md`, "Screens the demo does not have").
- **Why:** no reminder reads a closed day before E03-T06 (D-029) and no clinic uses the app before the
  pilot, so the fix costs the same at the end of E01 and booking goes on first (D-112). A `message`
  leftover is always work, so it is a task, not a note.
- **Revisit if:** a clinic keys its closed days before E01-T08d is merged (then it runs first); E01-T05c's
  double-click guard in `src/ui/` turns out to fit the list as well (then E01-T08d builds on it).

### D-116 · Next.js 16.4.2 and Zod 4.6.7 before the next merge, as E00-T13 (owner); one copy of Zod by the lockfile alone
- **Origin:** E01-T05c's test, 2026-10-26 (`handoffs/E01-T05c.md`, its tester's question; `pnpm audit
  --prod` red on `main`'s Monday run 40312088104 and E01-T05c's run 40320367013). **Owner, 2026-10-26:**
  "Yes: upgrade next to 16.4.1 or later and zod to 4.6.6 or later as a small task of its own before the
  next merge." The versions and the rest are the architect's (`handoffs/E00-T13.md`).
- **What:**
  - **E00-T13, new, first on the board:** `next` and `eslint-config-next` exactly 16.4.2, `zod` exactly
    4.6.7, `package.json` and the lockfile only; a needed code or test change stops it for the owner.
    E01-T05c, Tested, is merged after it, with `main` merged into its branch for a new run (D-112).
  - **One copy of Zod** (D-068 still holds): `better-auth`'s range `^4.5.4` takes 4.6.7, and `pnpm add`
    moves it there without `overrides`. `better-auth` 1.7.7, `next-intl` 4.14.9 and React 19.2.8 stay.
- **Why:** two critical remote code executions and two highs in production dependencies (D-075). 16.4.1
  is the security release; 16.4.2 (2026-10-15) adds its Turbopack fixes; 16.4.3 (2026-10-23) changes how
  `proxy.ts` loads, where the session is renewed (D-067), too new to take untried (as D-088 left radix-ui
  1.7.0). Zod 4.6.7 is 4.6.6, which holds the fix, republished a day later. Probed on `0ec5ae0`: the
  audit, format, lint, types, unit tests and the build pass with no code change.
- **Revisit if:** a check fails on the upgrade (the owner chooses a fix or another version); 16.4.3 or a
  later 16.4 has been out a few weeks at the next dependency change (move to it); a new advisory.

### D-117 · E00-T13 takes a test-only fix for the D-093 check on Next.js 16.4.2 (owner)
- **Origin:** E00-T13's builder, 2026-10-26 (`handoffs/E00-T13.md`): on 16.4.2 two D-093 checks in
  `tests/e2e/form-memory.spec.ts` were red every run, a test change D-116 left to the owner. **Owner,
  2026-10-26:** "option 1 from the builder's note: drop or rewrite the :188 debug-data check, make the
  page server answer no-cache so Firefox's control proves D-093 again, update the 16.3.8 comments and
  AGENTS.md."
- **What:** E00-T13's diff may also name `tests/e2e/form-memory.spec.ts`,
  `tests/e2e/components-page-server.ts` and `AGENTS.md` (D-116 said the package files only). The
  check that `next dev` 16.3.8's debug data in IndexedDB cannot stall a page after Back is dropped:
  16.4 keeps that data in memory, so it has nothing to hold. The check's own server answers the page
  `no-cache`, as 16.3.8's `next dev` did, in place of 16.4's `no-store`. `AGENTS.md` takes the block
  `next dev` 16.4.2 writes.
- **Why:** with `no-store` Firefox keeps no form state, so its control could not show the attribute
  at work; the guard checks and the product are unchanged (production staff pages stay `no-store`).
- **Revisit if:** a later Next.js stores page data in the browser again, or answers `next dev`'s pages
  otherwise (read `components-page-server.ts`, 1. and 2.).

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

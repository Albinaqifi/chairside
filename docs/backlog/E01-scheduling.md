# E01 · Scheduling (milestone M1)

**Outcome:** the front desk can run a working day in Chairside: patients, a calendar per
provider, booking, moving, cancelling, arriving, completing. No messages yet.

**Why now:** appointments are what every message is about. And booking speed is the first
thing a receptionist judges (risk R-09), so it should be in front of a real one early.

Order: T01a → T01b → T02a → T02b → T04a and T08a side by side (two checkouts, D-110) → T04b and T08b
side by side (D-111) → T05a and T08c side by side (D-112, D-113) → T05b → T05c → T05d → T09, T03 → T06 →
T07, T10 → T08d → T11. With E00 (D-087, D-090, D-091, D-093, D-096, D-108, D-110, D-111, D-112, D-113,
D-114, D-115):
E00-T05a → T01a → T01b → E00-T04c → E00-T04d → E00-T04e → T02a → T02b → E00-T06b → E00-T05b → E00-T07 →
T04a and T08a → T04b and T08b → T05a and T08c → T05b → T05c → T05d → T09 and the rest, so a receptionist sees a patient list before
Playwright and staging exist. T01 is split in two (D-091): the schema and the provider link (T01a), the seed (T01b). T02 is
split in two (D-096): the list and the search (T02a), adding a patient (T02b); editing a patient's
details moved to T03, the profile. T04 is split in two (D-108): the day view (T04a); the provider
filter, a provider's own column, the "now" line and the reading on use (T04b). T08 is split in two
(D-110): the Settings page and the clinic's details (T08a), beside T04a; the opening hours and closed
days (T08b), after T04a, whose calendar shows them. T08b is split again (D-111): the opening hours
(T08b), beside T04b; the closed days (T08c), on the same tab, after it. T05, booking, moves up beside
T08c, ahead of T09 and T03 (owner, D-112). T05 is split in two (D-113): booking an existing patient
from New appointment (T05a), beside T08c; the overlap warning with "Book anyway", a click on the grid
and a new patient in one go (T05b), after it. Only active patients are booked (owner, D-113). T05b is
split again (D-114), as T05a came to far more lines than estimated: the overlap warning with "Book
anyway", one booking per click and a warning for breaks, hours and closed days (T05b); a click on an
empty slot, and a double click's second press changes nothing in the drawer (T05c); a new patient in
one go (T05d). T08c was merged with its last review's change open, a double click on a closed day's
Remove while the list's heading is above the window: it is T08d, after T10 and before T11 (owner, D-115).

---

### E01-T01a · Schema: providers, treatment types, patients, appointments, hours

- **Role:** builder · **Risk:** critical (migrations and policies; the permission check) · **Depends on:** E00-T03, E00-T05a
- **Read:** `data-model` (Conventions; sections 1 and 2 incl. "No double booking" and the state machine) · D-018, D-019, D-020, D-033, D-040, D-043, D-062, D-063, D-091 · Q-15 · the architect section of `handoffs/E01-T01a.md`

**Why.** The tables the whole scheduling epic uses, with the constraints that make double
booking and cross-clinic links impossible, and the link that gives a person their provider's
permissions. The first half of E01-T01 (D-091); the seed's rows are E01-T01b.

**Do.**
- Migrations for `providers`, `provider_breaks`, `treatment_types`, `patients`,
  `appointments`, `clinic_hours`, `closed_days`, as in `data-model.md`, each with `clinic_id`,
  policy, composite foreign keys and a check for each list of values (D-018's statuses among
  them). Grants: select, insert and update; delete only on `provider_breaks`, `clinic_hours` and
  `closed_days`. Patients and appointments are archived, cancelled or anonymised, providers and
  treatment types made inactive: never deleted.
- **Columns:** `patients.import_job_id` comes with `import_jobs` (E04-T01) and
  `appointments.source_message_id` with `messages` (E02-T01), not now (D-091).
  `appointments.created_by` is the user who booked it (`users.id`), as `audit_log.actor_id` is.
  `patients.language` is a two-letter code, checked by its form, not a list (`en` in development,
  D-053). The guardian follows D-033 (Q-15: the owner accepted building on it, 2026-10-06).
- The exclusion constraint on appointments, with the `overlap_ok` exemption. A time range holds
  its start, not its end, so back-to-back visits do not overlap.
- `pg_trgm`, and the trigram indexes E01-T02's search uses: the full name
  (`first_name || ' ' || last_name`) and `phone_e164`.
- Drizzle schemas in the owning modules (`scheduling`, `patients`, `tenancy`).
- **The provider link** (E00-T04b review suggestion 2, `slice`): `memberships.provider_id` with
  its foreign key `(clinic_id, provider_id)`. `clinics_for_user()` also returns the linked
  provider's kind (D-091), so `ClinicChoice` carries it; `allowed()` (`src/app/_lib/actions.ts`)
  and `membershipExtras()` (`src/app/(staff)/navigation.ts`), which say `providerKind: null`
  today, both read it there, and so will T04 (a dentist opens on their own column) and T10 (a
  dentist sees their own patients).

**Out of scope.** The seed's rows (E01-T01b). Any other function, and any screen. Message,
consent and task tables (E02). What making a linked provider inactive does (E01-T09).

**Acceptance.**
- [ ] The meta-test passes with the new tables, and inside clinic A no new table shows, changes or
      takes a row of clinic B (integration tests).
- [ ] Integration tests prove: two overlapping appointments for one provider are refused; back to
      back is allowed; overlap is allowed for two providers, when one is cancelled or no-show, and
      with `overlap_ok`; restoring a cancelled appointment into an overlap is refused.
- [ ] An appointment cannot reference another clinic's patient, provider or treatment type; a
      break or a membership cannot reference another clinic's provider (integration tests).
- [ ] A value outside each list (statuses, source, kind and the rest) is refused by the database
      (tests).
- [ ] A person linked to a provider gets that provider's kind in both the sidebar and the action
      wrapper's permission check: an owner linked to a dentist sees In the chair and may run a
      `visit.record` action, unlinked does not (tests). `clinics_for_user()` still returns only
      that user's active memberships, each with its own provider's kind or none (integration test).
- [ ] `data-model.md` matches the migrations exactly (any difference is fixed in the doc and logged).
- [ ] `pnpm check` and `pnpm build` pass.

---

### E01-T01b · The scheduling seed: providers, patients and a week of appointments

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T01a
- **Read:** `data-model` (section 2) · D-033, D-040, D-044, D-049, D-090, D-091 · demo lines 1369–1404 (the sample clinic's providers and patients; their emails and phones are not copied: the fake-data rules) and 1518 (treatments) · the architect sections of `handoffs/E01-T01b.md`

**Why.** Every scheduling screen after it (T02's patients, T04's calendar, T10's Today) needs a
clinic that looks like a working week, from one command. The second half of E01-T01 (D-091).

**Do.**
- **A seed file** after E00-T05a's, which stays as it is. Harbour Street Dental: the demo's three
  providers (two dentists, one hygienist) with chairs, hues and a lunch break each; open Monday to
  Friday, 08:00 to 18:00; a closed day after the seeded week; the demo's ten treatment types with
  their lengths; about 40 patients (some without a phone, one with a guardian, two siblings
  sharing a phone, one archived); a week of appointments. The second clinic: the same hours, one
  provider, a few patients and appointments. Rows are written compactly: a line per patient, the
  week from a small plan per provider and day.
- **The week:** Monday to Friday of the week the seed runs in (of the next week on a Saturday or
  Sunday), in the clinic's time zone; statuses that fit the day: past days completed, no-show or
  cancelled; the day itself mixed by the time of day (earlier visits completed, no-show or arrived,
  later ones booked, confirmed or cancelled), so any weekday holds every status; later days booked,
  confirmed or cancelled. Rows depend on the day only, never on the hour the seed runs. A confirmed
  visit has `confirmed_at` and `confirmed_via`, a cancelled one `cancelled_at` and `cancelled_by`, a
  completed one `completed_at`, each a moment taken from the day. No two appointments of one
  provider overlap unless one has `overlap_ok`, whatever their statuses, and none lies outside
  opening hours or in its provider's break.
- **The day:** a parameter of `seedDatabase()` that a test can set; without it the seed reads the
  clock once, when it starts, so E00-T05a's calls (`seedDatabase(urls)`) stay as they are. No time
  library: the clinic's day comes from `Intl.DateTimeFormat` with its `timeZone`, and each moment is
  written as the local date and time with the zone's name (`2026-10-26 09:00 Europe/Skopje`), which
  PostgreSQL turns into the moment. Never the computer's zone (`getDay()`, `setHours()`): CI runs
  the tests again in `Pacific/Auckland`.
- **The links:** the seeded dentist's and hygienist's memberships (E00-T05a's) point at their
  providers. The seed only inserts today, so this is a new step that sets a link where none is set;
  the owner stays unlinked.
- **The fake-data rules:** names from the invented lists, in both scripts (D-049); treatment names
  and providers' short names join new invented lists in `fake-data.ts`: extend a list, never narrow
  the check (E00-T05a review suggestion 2). Phones from the block, emails at `example.test`,
  `language` `en` (D-053). The check reads every row of the new file, the week's included: the
  cases of `fake-data.test.ts` stay as they are, and a new case may read the week's rows for a
  fixed day.
- **Fixed ids** in `seeded.ts`'s form, one per row, each used once across every seed file: a
  repeated id drops a row without a word, and an id with a 0 version or variant digit is refused by
  `z.uuid()` (E00-T05a tester note 2).
- **The tests:** the database cases are new cases in `tests/integration/seed.test.ts`, after its
  one seeding: the integration files run one at a time in no fixed order, and a second file that
  seeds would make that file's first check fail whenever it ran first. E00-T05a's two expected
  summaries there (the first run's and the second run's) gain the new file's entry; nothing else in
  that test changes (owner, 2026-10-06).
- `README.md`: what the seed holds now.

**Out of scope.** Tables and the provider link (E01-T01a). Linking the seeded owner. Messages and
every later row (each schema task brings its own). Any screen.

**Acceptance.**
- [ ] `pnpm db:reset` twice on one day gives the same rows and ids, apart from password hashes,
      each password row's own id and the times rows were written (tester, comparing the two);
      `pnpm db:seed` once more adds nothing and ends without an error.
- [ ] For a fixed weekday, the rows the new file gives are that day's week, hold every status and
      at least one appointment that day; for a Saturday and for a Sunday, they are the next week.
      For each of the seven days, no two appointments of one provider overlap unless one has
      `overlap_ok`, and none lies outside opening hours or in its provider's break (unit tests, no
      database; CI runs them in `Pacific/Auckland` too).
- [ ] After the seed, every row of the new file is in the database, none refused or dropped
      (counts per table), and `clinics_for_user()` gives the seeded dentist and hygienist their
      providers' kinds, the seeded owner none (new cases in `seed.test.ts`).
- [ ] The patients include one without a phone, one archived, one with a guardian, two sharing a
      phone, and names in both scripts (a test reads the seed file).
- [ ] No id is used twice across the seed files, and each passes `z.uuid()` (unit test).
- [ ] The fake-data check reads every row of the new file, and fails on a treatment name or a
      provider's short name that is not in the lists (tester: one change of each, each restored).
- [ ] `pnpm check` and `pnpm build` pass.

---

### E01-T02a · Patients: the list and the search

- **Role:** builder · **Risk:** critical (permissions: the test of every action and every role,
  D-093; a migration: the trigram indexes removed, D-096) · **Depends on:** E01-T01a, E01-T01b,
  E00-T04a … E00-T04e
- **Read:** `scope` (Navigation and roles; Patients list and profile) · `design-ref` (demo lines
  316–347; logic 1849–1858) · `data-model` (`patients`, `appointments`) · `test-strategy`
  (Permissions) · D-015, D-021, D-091, D-093, D-095, D-096, D-097 · the architect section of
  `handoffs/E01-T02a.md`

**Why.** Staff must find a patient in seconds by name or phone. The first half of E01-T02 (D-096):
the clinic's patients, listed and found; adding one is E01-T02b, editing one E01-T03. It is the
first screen with patient rows, so two guards come with it: the logger's safety net, and the test
that every action asks for the permission `scope-v1.md` gives each role.

**Do.**
- **The logger's safety net** (E01-T01a critical review, `data`), before this task's code handles
  patient rows: `src/lib/personal-fields.ts` also drops a field whose name ends in `e164`
  (`phone_e164`, `phoneE164`), the patient phone column, and `title` (an appointment's label, such
  as a treatment), unless a log field of that name must stay (then say why in the note); a
  `logger.test.ts` case for each.
- **The trigram indexes go** (owner, D-096): a migration drops `patients_full_name_trgm_idx`,
  `patients_phone_e164_trgm_idx` and `pg_trgm`, which 0002 created for them alone; `schema.ts`
  loses them and its comment that the search uses them. Under Row-Level Security an index serves
  only leakproof operators, and `LIKE`, `ILIKE` and pg_trgm's `%` are not (E01-T01a review,
  `speed`).
- **The search**, a function of the `patients` module (`src/modules/patients/index.ts`): the
  clinic's patients whose full name holds what is typed, or whose phone holds the digits typed,
  however they are written (`+389 70 001 234`, `00389…`, `070 001 234`: a leading `00` or `0`
  dropped). At most 50 rows, by last name, then first name; with nothing typed, the first 50.
  Every status, an archived or deceased patient marked. It reads the clinic's patients through the
  clinic's own key, which the 300 ms criterion measures. No value is cast to a name in its query
  (`$1::regconfig`, `::regclass`): `withoutQueryValues()` cleans SQLSTATE class 22 and 42601 only,
  so such a value would stay in a logged error (Discovered, E00-T03 test, `data`).
- **The rows** (demo lines 316–347): name; age and phone; last visit; next visit. The age at the
  clinic's today. The phone as the clinic's people write it, formatted on the server with
  libphonenumber-js (D-097): the national form for the clinic's own country, the international one
  otherwise. Last visit, the last completed appointment's date; next visit, the next booked or
  confirmed one's date and time: from a function of the `scheduling` module
  (`src/modules/scheduling/index.ts`), never its tables read from `patients` (module rule 1).
  Above the rows: the count of the clinic's patients, the filter "All" (other filters arrive with
  their epics), and "Import from Excel" to the import page for whoever the sidebar shows Import to
  (`import.run`); an empty state when nothing matches. The demo's care plan, treatment and offers
  columns wait for their epics, with nothing in their place.
- **The search box keeps nothing in the browser** (E00-T04d review, `data`, D-095): it is in no
  staff form, so it is `autoComplete="off"` itself, and its words go in the request's body (a
  `staffRead` action for every member: every member sees every patient, Q-11, D-096), never in
  the page's address (`?q=…`), which the browser's history and the host's request log keep.
- **Dates and times in the clinic's time zone** (`clinics.timezone`, D-015), set once in
  `src/i18n/request.ts` for every page, so later screens reuse it; next-intl's provider passes it
  on to client components. Today none is set: next-intl warns and uses the computer's zone, so the
  server and the browser can show one visit at different times (Discovered, E00-T04a). The zone is
  read in the clinic's transaction (D-091), and that file also runs for the login page and the
  clinic picker, where `currentStaff()` redirects (the note says more).
- **Every action, every role** (E00-T04c critical review, `data`, D-093): the one table-driven test
  `test-strategy.md` asks for, a unit test in `src/app/`. It finds every action itself: it imports
  every file under `src/app` whose first statement is `'use server'` (lint makes each value export
  there a wrapper-made action), and it fails when any other file there, tests and
  `_lib/actions.ts` aside, calls `staffAction`, `staffRead` or `userAction`. Its own table gives
  each action the row of `scope-v1.md`'s table it belongs to, written from `scope-v1.md`, never
  from `PERMISSION_TABLE`; a `userAction` is listed as one. It calls each staff action as each
  member (an owner, an owner linked to a dentist, a dentist, a hygienist, the front desk, the front
  desk with import, the front desk with export), with `currentStaff()` and `withTenant` stand-ins
  as in `dev/components/actions.test.ts` and an input no schema takes: a member the row refuses
  gets `forbidden`, one it allows anything else (the wrapper checks the permission before the
  input). An action without an entry fails it, and so does an entry without an action.

**Out of scope.** Adding a patient (E01-T02b); editing one, and the profile (E01-T03). Consent
switches (E02). The care plan, treatment and offers columns, and the other filters.

**Acceptance.**
- [ ] Search finds a seeded patient by part of the name, and by part of the phone typed as digits
      only, with spaces, with `+389` or in the national form (`070 …`) (integration test).
- [ ] Search over 20,000 generated patients returns in under 300 ms (integration test).
- [ ] A user of the second clinic finds none of the first clinic's patients (integration test).
- [ ] A visit's date and time show in the clinic's time zone whatever the computer's zone (test);
      the login page and the clinic picker still open, signed out and before a clinic is chosen.
- [ ] The logger drops a field named `phone_e164`, `phoneE164` or `title` (`logger.test.ts`).
- [ ] After `pnpm db:reset` neither trigram index nor `pg_trgm` exists (tester, in the database),
      and `data-model.md` says so.
- [ ] One test runs every staff action as every member and matches `scope-v1.md`'s table; an action
      added without an entry fails it, and so does a wrapper called outside a `'use server'` file
      (tester: a scratch file each, removed after).
- [ ] The search box is `autocomplete="off"` (unit test, as `demo-form.test.ts`'s); after a search
      the address holds none of its words (tester).
- [ ] The list as the demo's for the columns that exist, an archived patient marked (screenshot in
      the handoff note).
- [ ] `pnpm check` and `pnpm build` pass.

---

### E01-T02b · Patients: add a patient

- **Role:** builder · **Risk:** normal (no migration, policy or wrapper; `StaffForm` changes in its
  comment only, D-098) · **Depends on:** E01-T02a
- **Read:** `scope` (Patients list and profile) · `data-model` (`patients`) · `design-ref` (the
  list's header, demo lines 316–322; the demo has no patient form: "Screens the demo does not
  have") · D-033, D-040, D-053, D-092, D-093, D-095, D-096, D-097, D-098 · the architect section of
  `handoffs/E01-T02b.md`

**Why.** The front desk adds a patient who is not in the list yet. The second half of E01-T02
(D-096). E01-T03 edits a patient in this task's form; E01-T05's quick new patient and E04's import
write through its module function.

**Do.**
- **`patients.create`** in the module (`src/modules/patients/index.ts`): one patient of the
  transaction's clinic, its id returned; a mistake of the desk is returned as a code, never thrown,
  and the action turns it into `refuse(code)`.
  - **The phone** (D-097), read with the clinic's own `default_country` (`clinicPlace(tx)`), never
    with a country the page sends: in the national form it takes that country, with `+` or `00` its
    own; stored as E.164. It is trimmed, and the invisible marks a copied number carries removed
    (`\p{Cf}`: WhatsApp, Teams and Outlook wrap a number in direction marks), before it is read.
    Refused as `phone_impossible`: a length no number of its country has, letters, a calling code
    no country has, an extension (`ext. 5`: the package splits it off, and no message reaches it),
    an E.164 form of more than 15 digits (the column's check; the package lets
    `+49 30 1234567890123` through), and a number read with its trunk 0 still in it: its
    `nationalNumber` starts with `0` and `isValid()` is false (`070 001 23`, a digit missing: the
    package keeps the 0 and calls it possible, `+38907000123`, though no Macedonian number has 7
    digits after its 0). A valid number whose own digits start with 0 is kept (`+39 06 1234 5678`,
    a line in Rome), and so is a possible number the package does not know (`+389 99 123 456`), so
    a new range is never refused at the desk: `isValid()` alone never refuses. A clinic country the
    package does not support is the clinic's fault, not the desk's: an Error, answered `internal`,
    never `phone_impossible`.
  - **The email** trimmed and lower-cased, then checked. **An optional field** sent empty (a form
    sends `''`) is stored as null, `notes` as `''` (its column is not null).
- **The page** `/patients/new`, opened by "New patient" beside "Import from Excel" on the list, for
  whoever has `patients.manage` (every member): a `StaffForm` with first name, last name, date of
  birth, phone, email, language, guardian name (a line under it says the phone and email are then
  the guardian's, D-033) and notes (labelled "not a clinical record"). Language: the browser's own
  select of a new `languages` group in the message file, its keys the codes stored (`en` alone
  until the translation pass: the name of the one language there is, not a new language, D-053),
  the first selected; the module stores any two lower-case letters. A page, not a drawer: E01-T05's
  booking drawer is the quick way to add a patient while booking.
- **Where a problem shows** (D-098): what the input alone settles is the schema's, at its field (a
  name missing, an email that is no email, a date that is no date). The date of birth is the
  browser's date field, which sends a date it cannot read (half typed) as `''`: it is stored as
  none, like a field left empty, by design. The phone needs the clinic's country, so its problem is
  the handler's refusal, shown above Send through `StaffForm`'s `refusals`, in words that name the
  phone and never repeat the number. How `StaffForm` shows an answer does not change (only its
  comment does, below). The schema's problems come first; the phone's refusal shows once they are
  fixed.
- **A likely duplicate, shown before Send** (D-033): when what is typed matches a patient of the
  clinic with the same name and date of birth, or the same name and the same phone or email (the
  same name: the same first and last name, each trimmed and compared in any case, with `lower()`,
  as the search compares), a warning above Send names that patient (name and date of birth); Send
  still saves. A shared phone alone is never a warning (siblings). The check is a `staffRead` for
  every member, called as a field is left, with the frame's clinic and its words in the request's
  body (D-092, D-095); it saves nothing, and it is no record view, so it writes no audit row
  (D-098). It reads the typed phone with `patients.create`'s reader, so it compares E.164 numbers;
  an impossible phone matches no one. The date of birth it shows is a calendar date, formatted in
  UTC (`CLAUDE.md`, D-098).
- **After a patient is created** the page goes to the list (the form's `onDone`, `router.push`),
  which reads the clinic's patients again: its count includes them, and so do its rows while the
  clinic has no more than 50 (the seed's clinic has 40). The action calls
  `revalidatePath('/patients')` when it succeeds, or Back would show the list from before, kept by
  the router. Never `redirect()` in the handler: the wrapper answers a throw `internal`. The action
  answers the new id only. `StaffForm`'s sent-once guard covers a double click (E00-T04c), so no
  client-made id is needed (E00-T03 test's double-submit line, its E01-T02 part).
- **The list shows each render's rows** (E01-T02a critical review, `slice`): `PatientList` keeps
  the rows of its first `initial` in its state, so Patients clicked again, or a refresh in place
  (`router.refresh()`), shows the first load's rows until something is typed (after a create the
  list is a new one: opening the form unmounted it). A later render of the page shows its count
  and rows when nothing is typed, and searches again when something is. Its key by the page's
  clinic stays (D-098).
- **Audit:** `patient.created`, with no personal value in its row (`audit.record` refuses a
  personal field name).
- **Nothing typed about a patient stays in the browser** (E00-T04d review and delta review, `data`,
  D-095): no field of the patient form sets an `autocomplete` of its own (WebKit gives such a field
  back after Back). `staff-form.tsx`'s comment says so, in place of "a field that needs the
  browser's suggestions sets its own" (the comment only).
- **The logger's net** (E01-T02a test, `data`): `src/lib/personal-fields.ts` also drops a field
  whose name ends in `title` (`appointmentTitle`), `treatment` or `treatmentType`, with a
  `logger.test.ts` case each. The patient search's input is renamed from `query` to `text`, a name
  the net already drops (**owner, 2026-10-08:** the two lines of `search-answer.test.ts` that name
  it change that name and nothing else, agent rule 8). Only the read's input is renamed
  (`actions.ts`, `search-answer.ts`, the page's `forPage`): `PatientTable`'s own `query` prop keeps
  its name, so `patient-list.test.ts` does not change. `query` itself stays out of the net: a
  failed query's error keeps its SQL (placeholders only) under that name, which two
  `logger.test.ts` cases expect.
- Its actions in E01-T02a's permission test, under "Calendar, patients, booking".

**Out of scope.** Editing a patient, and the profile (E01-T03). Merging duplicates (E04-T06).
Consent switches (E02). A refusal marked at its field (Discovered, D-098). A search that treats
Latin and Cyrillic as one (the owner's, later).

**Acceptance.**
- [ ] A phone typed in the national form (`070 …`), with `+389` or with `00389` is stored as the
      same E.164 number, and one pasted with direction marks reads as typed; a possible number the
      package does not know is kept, and so is a valid foreign number whose digits start with 0
      (`+39 06 1234 5678`, in the reader's unit test only: rows that tests store take phones from
      the seed's block, agent rule 5) (unit and integration tests).
- [ ] An impossible phone (too long, too short, letters, an extension, more than 15 digits as
      `+49 30 1234567890123`, a digit missing as in `070 001 23`) is refused: no patient row, no
      audit row, and the message above Send names the phone (integration test; unit test of the
      form's text).
- [ ] An email is stored lower-cased and an invalid one is refused at its field; an optional field
      left empty is stored empty, never answered "Fill this in." (unit test).
- [ ] Typing the name and date of birth of a patient already in the list shows the warning, and
      Send still saves; in the second clinic the same typing shows none, the check finding none of
      the first clinic's patients (the check's integration test, in each clinic's transaction;
      tester, in a browser).
- [ ] Two siblings with the same phone and their own first names are created with no warning (test).
- [ ] Every create writes one audit row with no personal value in it (integration test).
- [ ] After a patient is created the list (the seed's clinic) counts and shows them, an earlier
      list reached by Back too; the form holds nothing of them, and a second Send creates no second
      patient (tester, in a browser, on `pnpm build` and `pnpm start`).
- [ ] On the list, Patients clicked again shows the clinic's current count and rows (tester).
- [ ] The warning's date of birth shows its own day with the formatter in `America/New_York`
      (1 January; unit test).
- [ ] No field of the patient form has an `autocomplete` of its own (unit test, as
      `demo-form.test.ts`'s).
- [ ] The logger drops `appointmentTitle`, `treatment` and `treatmentType`, its other cases
      unchanged (`logger.test.ts`); the search sends what is typed as `text`
      (`search-answer.test.ts`).
- [ ] The permission test passes with this task's actions in its table.
- [ ] `pnpm check` and `pnpm build` pass.

---

### E01-T03 · Patient profile, and editing a patient's details

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T02b, E01-T05a (the booking's patient
  check, `patients.patientStatus`)
- **Read:** `scope` (Patients list and profile) · `design-ref` (demo lines 348–446; logic
  1860–1880) · D-033, D-040, D-095, D-096, D-113, D-114 · `handoffs/E01-T02b.md` (the patient form) ·
  `handoffs/E01-T05a.md` (the reviewer's suggestion 1)

**Why.** One place that answers "what is going on with this patient?", and where their details are
put right. Editing came from E01-T02 (D-096): it shows the same record.

**Do.**
- Profile page: header (name, age, phone, email, patient since), buttons "Book appointment"
  (opens the new-appointment drawer once T05 exists; until then disabled), next appointment
  card, visit history (completed appointments), notes, status, guardian.
- Sections that later epics fill are **not rendered as fake content**: Messages (E02), Care
  plan (E05), Treatment plan (E06), Communication switches (E02).
- Opening a profile writes a "viewed patient record" audit row.
- **Editing the details** (from E01-T02, D-096): `/patients/<id>/edit`, reached from the profile:
  E01-T02b's form with the patient's values, and their status (active, archived, deceased).
  `patients.update` in the module, the phone and email read as on create. Audit: `patient.updated`,
  naming the fields that changed, never their values; opening the edit page is a record view too.
  A row of the patients list opens the profile.
- **A patient with visits ahead stays active** (E01-T05a review, `message`; owner, 2026-10-19,
  D-114): setting archived or deceased is refused while the patient has a visit ahead that holds the
  chair (not cancelled or a no-show), above the button, and the page lists those visits; the desk
  cancels or moves them first (E01-T06: until it exists, such a patient stays active). Nothing
  changes by itself. Such a visit would get no reminder (E02-T05), silently: D-113's reason. The
  booking (`patients.patientStatus`, E01-T05a, read without a lock today) and this edit take turns on
  the patient's row, so an archive and a booking at once cannot leave a visit ahead of a patient who
  is not active.
- A patient id of another clinic, or of none, answers not found on both pages.

**Acceptance.**
- [ ] The profile shows real data for seeded patients; an archived or deceased patient is clearly marked.
- [ ] Opening a profile, or the edit page, creates one audit row per view.
- [ ] Layout matches the demo's two-column profile for the sections that exist (screenshot in the handoff note).
- [ ] No placeholder or invented data is shown for sections that do not exist yet.
- [ ] Every edit writes one audit row naming the fields that changed, never their values
      (integration test).
- [ ] A patient of the other clinic answers not found on both pages, and no row is written
      (integration test).
- [ ] No field of the edit form has an `autocomplete` of its own (unit test).
- [ ] Archived or deceased is refused, nothing written, while a visit ahead holds the chair, and the
      page lists it; with only cancelled or no-show visits ahead, or none, it is saved (integration).
- [ ] An archive and a booking of that patient at once: one waits for the other, and no visit ahead
      holds the chair for a patient who is not active (integration).

---

### E01-T04a · Calendar: the day view

- **Role:** builder · **Risk:** normal (a screen that reads: no table, policy, permission, wrapper
  or login changes) · **Depends on:** E01-T01a, E01-T01b, E00-T04a … E00-T04e (all Done)
- **Read:** `scope` (Calendar) · `design-ref` (demo lines 215–283; logic 1812–1834, 1845–1846,
  2092–2096; status colours 1377–1385; "Provider colours") · `data-model` (sections 1 and 2: opening
  hours, closed days, providers, breaks, appointments) · D-015, D-018, D-019, D-020, D-098, D-108 ·
  the architect section of `handoffs/E01-T04a.md`

**Why.** The calendar is where the front desk lives: before anyone books (E01-T05) or moves
(E01-T06) an appointment, they must see the day. Split from E01-T04 (D-108).

**Do.**
- **The page.** `/calendar` shows one day of the clinic: today in the clinic's zone, or the day its
  address names (`?day=YYYY-MM-DD`; anything else shows today). Previous, Today and Next are links to
  the day before, today and the day after; the address holds the day and nothing else. The title is
  the day, a date of the calendar formatted in UTC (`CLAUDE.md`, Dates and times); the line under it
  counts the day's appointments and its columns (the demo's `calSub`, without "waiting on a reply",
  which needs E02).
- **The read.** A `staffRead` naming `calendar.manage`, read by the page with `forPage`: for that
  day, the providers in `sort_order` (the active ones, and an inactive one with an appointment that
  day, so no appointment is ever hidden), each with its appointments that overlap the day and its
  breaks of that weekday; the clinic's hours that weekday and the day's `closed_days` row; each
  appointment's patient's name. Each table through a new function of its own module; the read puts
  them together, since the patients module already reads scheduling's (module rule 1). No audit
  row: a calendar is a list, not a record view (D-098).
- **The clinic's zone, never the computer's.** The day runs from the clinic's local midnight to the
  next; a block's place and its time come from its local start and end in that zone, so a day of 23
  or 25 hours places each block at its local time. Times through next-intl's formatter (D-015).
- **The grid** (demo lines 245–282, logic 1814–1831): a column per provider, its header the initials
  (first letters of the name's first and last words) in a circle of its tint, the name, and
  `chair · N% booked`; hour labels and half-hour lines; each appointment a block by its local start
  and length, with its time, its patient's name, its title and a tag line: its note when it has one,
  else its status's name, none for confirmed and completed (the demo's rule). By status: booked
  tagged "Booked", confirmed plain, arrived outlined in the provider's strong tint, completed faded,
  cancelled and no-show struck through on red; "No reply yet" needs a sent reminder (D-018) and comes
  with E02-T12. Two blocks of one column that overlap (a cancelled visit rebooked, "book anyway",
  D-020) sit side by side, each readable. Each break of the provider that weekday hatched, with its
  label (D-018). A legend of the statuses under the grid. The grid runs from the clinic's earliest
  opening to its latest closing in the week, in whole hours, widened to any appointment or break of
  the day outside them; 08:00 to 18:00 when the clinic has no hours.
- **Opening hours and % booked** (scope ✏️). Time outside the day's hours is shaded; a closed day (no
  hours that weekday, or a `closed_days` row) is shaded whole and says so, with the closed day's label;
  an appointment on it still shows. A column's % booked: the minutes of its appointments that are not
  cancelled or a no-show, inside the day's hours, over the hours' minutes less the provider's breaks,
  rounded; it may pass 100 when visits overlap; none on a closed day. A pure function, with its tests.
- **Provider colours in the theme:** the four tints of `design-ref` "Provider colours" as formulas
  over a hue set on the element from `providers.color_hue`, such as
  `--color-provider-tint: oklch(0.95 0.03 var(--provider-hue))`, in an `@theme inline` block. In a
  plain `@theme` block the variable is resolved on `:root`, where no hue is set, and gives no colour
  (E00-T04a review). The shade for outside hours is derived from a token the design has, named in
  the note.
- **The day helpers in one place** (D-108): `isCalendarDay`, `dayInZone`, `addDays` and `isoWeekday`
  move from `src/db/seed/seed-day.ts` to `src/lib/calendar-day.ts` with their tests, none dropped; the
  seed imports them from there, and `src/modules/patients/list.ts` drops its own `dayInZone` for it.
  `CLAUDE.md`'s `src/lib/` line names the file.

**Out of scope.** What a click on a block or an empty slot does (E01-T05 and E01-T06 add it, with
their drawers); "New appointment" and the hint "Click an empty slot to book" (E01-T05); the Day / Week
switch (E01-T07). The provider filter, a linked provider's own column, the "now" line and the reading
on use (E01-T04b). "No reply yet" (E02-T12). Drag and drop (later). An index for the day's query
(E07-T08). Adding the calendar to the accessibility check's pages, which hold no E01 screen yet.

**Acceptance.**
- [ ] With the seed (`pnpm db:reset`), the front desk's calendar shows, on each day of the seeded
      week, every Harbour Street appointment of that day in its provider's column, at its local start,
      as long as it lasts, with its status's look, and the lunch breaks hatched; nothing of the other
      clinic (the read's integration test with rows of two clinics; the screenshots).
- [ ] Each block's place and time are its local start and length in the clinic's zone, also on the
      days the clocks change and the day after each: 2026-03-29 and 2026-10-25 in Europe/Skopje,
      2026-03-08 and 2026-11-01 in America/New_York, a zone behind UTC; there an appointment at 23:30
      local is on its own day, not the next (tests that name their zones, whatever the computer's).
- [ ] Two overlapping appointments of one column both show, side by side, and so does a cancelled one
      with the visit rebooked in its place (test).
- [ ] Time outside the day's hours is shaded; a weekday without hours and a `closed_days` date are
      marked closed, the latter with its label (the seed's Monday after the week); an appointment on a
      closed day still shows (test).
- [ ] % booked: 0 with no appointments; a cancelled or no-show visit counts nothing; a visit partly
      outside the hours counts its inside part; a break is not open time; overlapping visits may pass
      100; a closed day shows none (unit tests).
- [ ] Previous, Next and Today go a day back, a day on and to the clinic's today; a `?day=` that is
      not a date of the calendar shows today; the address holds the day alone (test).
- [ ] An inactive provider with an appointment that day has its column; one without has none
      (integration test).
- [ ] The four day helpers are defined once, in `src/lib/calendar-day.ts`, and every test case of
      theirs still runs there (the note lists the moved cases).
- [ ] Visual match with the demo's day view: screenshots of the seeded day beside the demo's in the
      handoff note, and "Try it" steps for the owner.
- [ ] `pnpm check`, `pnpm build`, `pnpm test:e2e` (all three browsers) and `pnpm audit --prod` pass.

---

### E01-T04b · Calendar: the filter, a provider's own column, the "now" line and a fresh day

- **Role:** builder · **Risk:** normal (a screen: the membership's provider, read in the clinic's
  transaction, only picks the columns shown first; no table, policy, permission, wrapper, proxy or
  session change) · **Depends on:** E01-T04a (Done)
- **Read:** `scope` (Navigation and roles; Calendar) · `design-ref` (demo lines 228–232, 273–275;
  logic 2094–2096) · D-049 (the 24-hour clock), D-067, D-091, D-098, D-108 · the architect section of
  `handoffs/E01-T04b.md`

**Why.** A dentist wants their own day, a receptionist the columns they book for, and both a day that
is not stale when they look at it, without a screen that keeps itself signed in (owner, D-108). Split
from E01-T04 (D-108). With two answers of the owner on E01-T04a's day view (2026-10-12): the 24-hour
clock, as D-049 and the demo have it, before booking (E01-T05) adds times to choose; no lunch on a
closed day.

**Do.**
- **The provider filter** (demo lines 228–232, logic 2094): a chip per column of the day, the
  provider's short name (`providers.short_name`) beside a dot of its strong tint, a button whose
  pressed state says whether its column shows; a click turns the column off or on. At least one column
  of the day always shows: its last one on cannot be turned off, and a day on which the choice would
  show none shows all. The choice holds over Previous, Today and Next; it is the page's state, keyed by
  the page's clinic (D-098), so a reload starts again. The line under the title counts the columns
  shown and their appointments.
- **A provider's own column.** A member whose membership is linked to a provider
  (`memberships.provider_id`) opens the calendar on that column alone and can turn the others on; an
  unlinked member opens on all. The link is read by the calendar's read in the clinic's transaction,
  added to what `activeMembership()` returns, not through `clinics_for_user()` (D-091, "Revisit if");
  E01-T10 reads the same.
- **The "now" line** on today (demo lines 273–275): a line with a dot at its start, at the clinic's
  current time in its zone, by the browser's clock, moved each minute by the browser without a request.
  None on any other day, nor while the time is outside the grid.
- **A fresh day when used** (owner, D-108): the page reads its day again when the window regains focus
  or becomes visible, or a pointer, a key or a touch is used on it, at most once every 30 seconds after
  its last read; never on a timer. The filter's choice survives the read. A session that has ended
  sends the next use to the login page.
- **No break on a closed day** (owner, 2026-10-12): a day with a `closed_days` row or without hours
  shows no break; its appointments still show.
- **The 24-hour clock** (D-049; owner, 2026-10-12): every time of day on every page as "09:00" and
  "14:30", the calendar's hour labels as "08:00"; set once, for every page and client component, where
  the request's configuration is (`src/i18n/request.ts`), not at each call. Dates stay as they are
  ("Monday, October 12"). The tests that expect "9:00 AM" expect the 24-hour time instead: the format
  only, no case removed or loosened (agent rule 8; the owner's answer). `CLAUDE.md`'s "Dates and times"
  says so.

**Out of scope.** A refresh while nobody uses the page (D-108: E02 may ask again). The calendar in the
accessibility check and in a journey (E01-T11). Times in messages (E02-T03). Anything E01-T04a leaves
out: a click on a block or a slot (E01-T05, E01-T06), the week view (E01-T07).

**Acceptance.**
- [ ] The chips hide and show their columns, each a button that says whether its column shows; the
      last one on stays on; a day on which the choice would show none shows all; the choice holds over
      Previous, Next and Today; the line under the title counts what shows (tests).
- [ ] The seed's dentist and hygienist open on their own columns and can turn the others on; the owner
      and the front desk open on all (an integration test of the read as each; a test of the page).
- [ ] An appointment changed in the database shows on the next use of the page once 30 seconds have
      passed since its last read, and not on a use before; a page left alone for a minute sends no
      request (an end-to-end check that counts requests, the browser's clock moved by Playwright).
- [ ] With the session ended, the next use of the page shows the login page (end-to-end check).
- [ ] The "now" line is at the clinic's time on today, moves within a minute without a request, and is
      absent on any other day and outside the grid (tests, the browser's clock set, a zone behind UTC
      among them).
- [ ] A closed day, by its `closed_days` row or without hours, shows no break and still shows its
      appointments (test).
- [ ] Every time of day is in the 24-hour clock: the calendar's blocks and hour labels, the patient
      list's next visit, on the server and in the browser; dates unchanged (tests).
- [ ] `pnpm check`, `pnpm build`, `pnpm test:e2e` (all three browsers) and `pnpm audit --prod` pass.

---

### E01-T05a · Book an existing patient: the new-appointment drawer

**As built** (Done 2026-10-19, PR #67; D-114): as planned, about 1,350 lines of product code with
comments against 500 estimated, so E01-T05b is split again. Also: a start the clocks skip is refused
(`start_skipped`), and one they repeat is the second, in standard time; a day already past can be
booked (a walk-in entered after the visit), and no message goes out for it (D-114). The double-click
guard covers the corner Close too (the tester's finding 1): a pointer's press on Close within half a
second of the opening is dropped, so Escape and a key on Close always close it, and a pointer on
Close from half a second on. Book sits under the fields, not in the demo's footer bar (owner,
2026-10-19). The text below is the plan as it was.

- **Role:** builder · **Risk:** normal (a screen and the scheduling module's first write, through
  `staffAction`: no change to a wrapper, `StaffForm`, a policy, a permission, a table or a migration)
  · **Depends on:** E01-T04b (Done), E01-T02b (Done)
- **Read:** `scope` (Calendar; New appointment drawer) · `design-ref` (demo lines 237, 1323–1362;
  logic 1619–1621, 1958–1964, 2116–2135; "Layout": the drawers) · `data-model` (`appointments`, "No
  double booking") · D-020, D-093, D-095, D-098, D-108, D-113 · `handoffs/E00-T04e.md` (the tester's
  note 1) · the architect section of `handoffs/E01-T05a.md`

**Why.** Booking is the single most used action and the first thing a receptionist judges (R-09): it
must be fast. This first slice books an existing patient at a free time, end to end; overlaps with
"Book anyway", a click on the grid and a new patient follow in E01-T05b (D-113).

**Do.**
- **`scheduling.createAppointment(tx, booking, now)`** books one appointment in the clinic of the
  transaction: a patient, an active provider and an active treatment type, whose name is its title; a
  start, a local time on a day of the clinic (minutes from the day's local midnight, as the calendar's
  are; the clinic's zone passed in, as `appointmentsOnDay` takes it), and a length in minutes; status
  `booked`, `source` `staff`, `overlap_ok` false, `created_by` the acting user. It refuses, writing
  nothing, a time that overlaps another appointment of the provider that is not cancelled or a no-show,
  one booked with `overlap_ok` too (`overlap`), and a provider or a treatment type that is not active
  or not the clinic's. Two bookings of one provider at once take turns, so the second sees the first.
  With it, the clinic's active treatment types, by name.
- **The booking action** (`calendar.manage`: every member, `scope-v1.md`'s "Calendar, patients,
  booking"), with one `appointment.created` audit row of ids. It refuses a patient who is not active
  (owner, D-113), asked of the patients module. When it is done, its answer brings the calendar's day
  again (Next.js 16's `refresh()`, or `revalidatePath` as `createPatient` does).
- **The drawer** (`Sheet`, demo lines 1323–1362), opened by **New appointment** in the calendar's
  header (demo line 237) at once, from the page's own state, never a navigation: a read on use on its
  way holds a navigation (E01-T04b tester, `speed`). Under its title the day the calendar shows and the
  time chosen ("Monday, October 12 · 10:30–11:00"). The **patient** field, focused first, with up to
  five suggestions from the patient search as one types (a name or a phone, `searchPatients`), each
  with its phone; an archived or deceased patient shows with their label and cannot be picked (owner,
  D-113). The **treatment** chips, buttons pressed or not, none chosen until one is picked, each setting
  the length to its own. **Start** (each quarter hour of the grid; on today the next quarter hour after
  the clinic's now while that is inside the day's hours, else the day's opening, or the grid's start),
  **length** (15, 30, 45, 60, 90 and 120 minutes, and the treatment's own) and **provider** (the active
  ones; first the first column shown), each the browser's own select. **Book** names the time and the
  provider's short name, as the demo's does (logic 2127).
- **After a booking** the drawer closes, a toast names the patient and the time (the demo's, logic
  2134), and the block is on the grid at once, in its provider's column, turned on if the filter had it
  off (logic 2133). A double click on Book books once.
- **The patient search keeps nothing in the browser** (E00-T04d review, `data`, D-095): inside the
  booking form, no `autocomplete` of its own; outside it, `autoComplete="off"`; its words go in the
  search's request body, never in the page's address, and are no field of the booking.
- **Fully usable by keyboard:** the arrow keys move through the suggestions, Enter picks one and never
  sends the form, Escape closes the list, then the drawer; Tab reaches every field and Book.
- **A double click on New appointment leaves the drawer open** (E00-T04e test, `speed`): today the
  second click lands on the overlay, which closes it on a click (Radix acts on the `click` after a
  pointer down outside), so a receptionist who double-clicks "New appointment" sees the drawer flash
  and go. The drawer's and the dialog's content (`src/ui/sheet.tsx`, `dialog.tsx`) ignore a pointer
  down outside them for as long as a double click lasts after they open (half a second, Windows'
  default); after that a click on the overlay closes them, and Escape and the close button always do.

**Out of scope.** E01-T05b's: the overlap warning before Book and "Book anyway", a click on an empty
slot, a new patient. The "text a booking confirmation" tick box (E02-T11, D-045). The open-treatment
hint (it needs treatment plans, E06). A warning for a time outside the hours, in a break or on a
closed day (the grid shades them). A day other than the one the calendar shows (the demo's drawer has
none). A form inside another form's drawer or dialog (E01-T06, D-113). The drawer in the accessibility
check and in a journey (E01-T11).

**Acceptance.**
- [ ] From New appointment, booking an existing patient takes: type part of the name, pick them, pick
      a treatment, Book; start, length and provider come filled in, the treatment sets the length. No
      more required steps (e2e).
- [ ] By keyboard alone, the focus first in the patient field: the arrow keys and Enter pick a
      suggestion, Enter there never sends the form, Tab reaches every field and Book (e2e, three
      browsers).
- [ ] After Book: the drawer closed, the toast, the block on the grid without a reload, in its
      provider's column also when the filter had it off; a double click on Book books one (e2e).
- [ ] The row as stored: the patient, provider and treatment chosen, the treatment's name as title,
      `booked`, `staff`, `overlap_ok` false, `created_by` the user; its start and end at the local time
      chosen in the clinic's zone, on the days the clocks change too (integration, Europe/Skopje and
      America/New_York); one `appointment.created` audit row, ids only (integration).
- [ ] A time that overlaps another visit of the provider (not cancelled or a no-show; one booked with
      `overlap_ok` too) is refused with a message above Book that asks for another time, nothing
      written; of two bookings of the same time at once, one is booked and the other gets that message
      (integration tests; the message in a component test).
- [ ] An archived or deceased patient shows with their label and cannot be picked (component test);
      the action refuses them, an inactive provider or treatment type, and another clinic's patient,
      provider or treatment type, with nothing written (integration).
- [ ] Every role can book: the permission test has the action under `calendar.manage`.
- [ ] The patient search has no `autocomplete` but `off` (unit test); after a search the address
      holds none of its words, and the booking's request none either (tester).
- [ ] A read on use while the drawer is open keeps everything typed and chosen in it (e2e, the
      browser's clock moved).
- [ ] A double click on "New appointment" (80, 150 and 250 ms between the clicks) leaves the drawer
      open in Chromium, Firefox and WebKit; a click on the overlay a second later closes it (tester,
      in a browser).
- [ ] `pnpm check`, `pnpm build`, `pnpm test:e2e` (all three browsers) and `pnpm audit --prod` pass.

---

### E01-T05b · Booking: overlaps and "Book anyway", one booking per click, a warning for breaks and hours

**As built** (Done 2026-10-20, PR #70): as planned, about 290 lines of product code with comments, on
the estimate. Also: the booking's answer brings the day again on `already_booked` as well as on an
overlap; the warnings sit in one box in the amber every warning of the app has (the "Needs a call"
panel's), not the demo's orange text (owner, 2026-10-20). Left as known: a drawer left open past
midnight on today's calendar still books its own day but warns of nothing, as the calendar then holds
the next day (a code comment says so). The text below is the plan as it was.

- **Role:** builder · **Risk:** normal (as E01-T05a's: the drawer and the scheduling module's booking,
  through `staffAction`; no change to a wrapper, `StaffForm`, a policy, a permission, a table or a
  migration: `overlap_ok` is migration 0002's) · **Depends on:** E01-T05a (Done)
- **Read:** `scope` (Calendar; New appointment drawer) · `design-ref` (demo line 1350; logic 1963,
  2125) · `data-model` ("No double booking") · D-020, D-098, D-108, D-113, D-114 · the architect
  section of `handoffs/E01-T05b.md`

**Why.** Clinics squeeze in emergencies, so staff book over another visit on purpose (D-020): the
drawer says so before Book, instead of refusing after it. A visit booked anyway is no longer held by
the database's constraint, so there one click must book once, or E02 reminds the patient of each
copy. And a time in a break, outside the hours or on a closed day is more often a wrong pick than a
choice: one line says so, before a reminder goes out for it (owner, 2026-10-19). Split from E01-T05
(D-113), then again (D-114).

**Do.**
- **The overlap warning before Book** (demo line 1350, logic 1963, 2125): while start, length and
  provider overlap another visit of that provider on the day shown that holds the chair (not
  cancelled or a no-show; one booked anyway too), the drawer names each, its patient and its time,
  above Book, and Book becomes **Book anyway**, still naming the time and the provider. It reads the
  day the calendar holds now (a read on use and a booking's answer bring it up to date), not the one
  read when the drawer opened; nothing typed or chosen changes with it (D-108).
- **Book anyway** books it with `overlap_ok` (D-020): the action takes the person's "anyway", a field
  of the form sent only while the warning shows, and `scheduling.createAppointment` then stores
  `overlap_ok` true when the time does overlap as it is written, else an ordinary booking, which the
  constraint guards. Without "anyway" an overlap is refused as in E01-T05a. An overlap the drawer did
  not show (a visit booked since the day was read) is refused so, and the answer brings the day
  again, so the warning then names that visit and Book anyway is one press away.
- **One booking per click** (E01-T01a tester note 1 and E00-T03 tester note 3, `message`): a booking
  of the same patient with the same provider at the same start as a visit that holds the chair is
  refused (`already_booked`, its text above Book), with or without "anyway", nothing written. It is
  checked under the provider's row lock, as the overlap is, so two at once take turns: a double click
  on Book anyway, or the same booking sent twice, keeps one row, and E02 reminds the patient once.
  The wrappers do not make an action idempotent.
- **A warning for a break, the hours or a closed day** (owner, 2026-10-19; the demo warns for lunch,
  logic 1963): while the time overlaps a break of the provider, runs outside the day's opening hours
  in part, or falls on a day the clinic is closed (a closed day, with its label, or a weekday without
  hours), the drawer says which, in the same place above Book, a line each. Book stays Book and books
  it: nothing is refused for it.

**Out of scope.** A click on an empty slot, and a double click in the drawer (E01-T05c); a new
patient (E01-T05d). The drawer kept open while Book's request is on its way (E01-T06, D-114). The
confirmation tick box (E02-T11).

**Acceptance.**
- [ ] An overlap shows the warning with the other visit's patient and time, and Book anyway; Book
      anyway books it with `overlap_ok` true; one that reaches the server after the other visit was
      cancelled is booked with `overlap_ok` false (component and integration tests).
- [ ] Without "anyway" an overlap is still refused (E01-T05a's cases stand). A visit booked by
      someone else after the day was read: Book is refused, then the warning names that visit
      without a reload, and Book anyway books it (integration; e2e).
- [ ] A double click on Book anyway books one appointment (e2e); the same booking sent twice, and
      twice at once, with or without "anyway", keeps one row, and the other gets `already_booked`
      with nothing written (integration).
- [ ] The warning for a break, a time partly outside the hours, a closed day and a weekday without
      hours, each named; none inside the hours; Book books each (component test; one case e2e).
- [ ] The warning and Book's label follow start, length and provider as they change; a read on use
      while it shows keeps everything typed and chosen (component; e2e, the browser's clock moved).
- [ ] `pnpm check`, `pnpm build`, `pnpm test:e2e` (all three browsers) and `pnpm audit --prod` pass.

---

### E01-T05c · Booking: a click on an empty slot, and a double click's second press changes nothing

- **Role:** builder · **Risk:** normal (a screen, and `src/ui/`'s drawer and dialog, as E01-T05a's
  guard; no action, wrapper, `StaffForm`, policy, table or migration) · **Depends on:** E01-T05b
  (Done)
- **Read:** `scope` (Calendar) · `design-ref` (demo line 260; logic 1819) · D-108, D-113, D-114 ·
  `handoffs/E01-T05a.md` (the tester's Discovered line 2; fix round 2's two Discovered lines) · the
  architect section of `handoffs/E01-T05c.md`

**Why.** The grid is where a receptionist sees a free time, and a click there is the quickest way to
book it (demo logic 1819). A double click is a desk habit on a calendar, and its second press lands
in the drawer the first one opened: today it takes the focus out of the patient field, and in
E01-T06's drawer it could press a status button (a no-show marked by mistake). Split from E01-T05b
(D-114).

**Do.**
- **A click on an empty slot** of a column (demo line 260, logic 1819) opens the booking drawer with
  that column's provider and the quarter hour the pointer is in, counted from the grid's top as the
  demo counts it (the grid's last quarter at its foot; always one the start select offers), on the
  day shown; a shaded time too, where E01-T05b's warning says why. It opens at once, from the
  calendar's state, never a navigation, as New appointment does: the drawer's choices are read when
  it opens (D-108), with the slot's start and provider in place of the first ones. A click on a block
  (an appointment, E01-T06's; a break) opens nothing, and nor does a click on the column of an
  inactive provider, shown for a visit it holds: no booking takes them (E01-T05a). The click is the
  pointer's, with the demo's `copy` cursor; the keyboard's and a screen reader's way stays New
  appointment.
- **A double click's second press changes nothing** (E01-T05a, fix round 2's Discovered lines:
  `speed`, the focus; `message`, E01-T06's buttons): for half a second after the drawer or the dialog
  opens, a pointer's press anywhere in it (a field, a chip, a select, Book) is dropped and moves no
  focus, wherever its opener sat (New appointment, an empty slot, E01-T06's block); the first field
  keeps the focus. Escape and keys always work, and a pointer from half a second on. In `src/ui/`,
  where E01-T05a's guard is, so E01-T06's drawer and dialog get it.
- **A double click on Book opens no second drawer** (E01-T05a tester, `speed`): the booking's answer
  can close the drawer before the second click, which then lands on the grid; a click on the grid
  within half a second of the drawer closing opens nothing.

**Out of scope.** A drag across slots to set the length (the demo has none). A block's click
(E01-T06). The week view's click (E01-T07). The closed days' Remove (E01-T08d, D-115).

**Acceptance.**
- [ ] A click on an empty slot opens the drawer with that column's provider and the quarter hour
      under the pointer, the grid's first and last quarter and a shaded time included; a click on a
      block (a visit, a break) opens nothing (e2e, three browsers; unit for the quarter hour); nor
      does a click on an inactive provider's column (component test).
- [ ] A double click (80, 150 and 250 ms between the clicks) on an empty slot and on New appointment,
      its second press on a chip, a select or Book: the drawer open, nothing chosen or sent, the
      focus in the patient field; Escape then closes it, and a press from half a second on picks as
      before (e2e, three browsers). The dialog drops such a press too (unit).
- [ ] A double click on Book: one booking, the drawer closed and not opened again (e2e).
- [ ] `pnpm check`, `pnpm build`, `pnpm test:e2e` (all three browsers) and `pnpm audit --prod` pass.

---

### E01-T05d · Booking: a new patient in one go

- **Role:** builder · **Risk:** normal (as E01-T05a's and E01-T05b's: the booking action and the
  drawer; the patient is written through `patients.create`, E01-T02b, with its own audit row in the
  same transaction; no wrapper, `StaffForm`, permission, policy or table changes) · **Depends on:**
  E01-T05b, E01-T05c (both Done)
- **Read:** `scope` (New appointment drawer) · `design-ref` (demo lines 1333–1336; logic 2120, 2131) ·
  `test-strategy` (Duplicates, retries, states: the same booking sent twice) · D-033, D-095, D-097,
  D-098, D-113, D-114 · `handoffs/E01-T02b.md` (the patient form) · the architect section of
  `handoffs/E01-T05d.md`

**Why.** A caller who is not a patient yet is booked in the same go (`scope-v1.md`, quick add):
today the desk adds them on the patients page, then comes back to book. Split from E01-T05b (D-114).
About 280 lines of product code with comments, sized from E01-T05b and E01-T05c.

**Do.**
- **"Add “…” as new patient"** as the suggestion list's last option (demo line 1335, logic 2120:
  shown once three characters are typed and no patient is picked, whether the search found anyone or
  not), by pointer and by keyboard: the arrow keys reach it as an option and Enter takes it, as a
  suggestion. It turns the patient field into first name, last name, phone and email, fields of the
  booking form, not a form of its own (D-113), the focus in the first one; a button (`type="button"`)
  goes back to the search, the typed text in it again.
- **What was typed fills the fields:** words split at spaces, the last one the last name and the rest
  the first name (one word: the first name); a text of only digits, spaces and `+ - ( )` (a phone
  searched for) goes to the phone field, the names empty. A pure function, unit-tested.
- Without a phone and an email the drawer says, in one line under them, that no reminder can reach
  the patient, and Book still books (`scope-v1.md`: allowed, flagged).
- **One transaction:** the booking action takes either the picked patient's id or the new patient's
  fields, never both (its schema; the new patient's names, phone and email checked as the
  new-patient page's are, each shown at its field). For a new patient the handler first asks
  `can(…, 'patients.manage')` as the pages do (every role has it today, `permissions.ts`; refused as
  a code of its own, a review check), then writes the patient through `patients.create` (the phone
  read with the clinic's country, `phone_impossible` above Book with the new-patient page's text,
  D-098; the language the new-patient page starts on, the message file's first), then books it: a
  refused booking writes no patient (a refusal rolls the handler back, `refuse()`). Two audit rows of
  ids: `patient.created`, which the handler writes through `audit.record` (actor `user`, the member's
  user id, the action's `now`; no metadata, as the new-patient page's), and the wrapper's
  `appointment.created`.
- **The same booking sent twice books one patient once** (`test-strategy.md`, Duplicates; `message`:
  two patients with one phone get two reminders). `already_booked` matches the patient's id, which a
  second send of a new patient would make anew, and with "anyway" book again. So the drawer makes the
  new patient's id (`newId()`, `src/lib/ids.ts`) once per opening and sends it; `patients.create`
  takes it (optional: E01-T02b's page and E04's import leave it out) and writes nothing when a
  patient by that id exists (`ON CONFLICT (id) DO NOTHING`, which waits for a send at the same moment
  to commit), saying so. The handler then writes no `patient.created` and books that patient as a
  picked one, its status checked (`patient_not_bookable` for an id of no active patient of the
  clinic): the same booking again is `already_booked`.
- The new patient's words go in the booking's request body, never the page's address, and no field
  sets an `autocomplete` of its own (D-095).

**Out of scope.** A likely-duplicate warning in the drawer: the suggestions list the name's matches
first (E01-T02b's page keeps its own). The date of birth, the guardian and the notes (the profile,
E01-T03). The language: the new-patient page's first, changed on the profile (E01-T03).

**Acceptance.**
- [ ] A new patient is added and booked in one go, the names from the words typed; one
      `patient.created` and one `appointment.created` row, ids only (integration; e2e, three
      browsers).
- [ ] "Add “…” as new patient" shows from the third character, with or without suggestions, is
      reached by the arrow keys and taken by Enter; back to the search brings the typed text back
      (component). Typed words split into the names, a phone into the phone field (unit).
- [ ] Without a phone and an email it books, and the drawer says no reminder can reach the patient
      (component; integration).
- [ ] An impossible phone is refused above Book with nothing written; an email that is no email is
      shown at its field; a refused booking (an overlap without "anyway") writes no patient and no
      audit row (integration).
- [ ] The same booking with a new patient sent twice, and twice at once, with and without "anyway":
      one patient, one appointment, one `patient.created`; the other refused as `already_booked`
      (integration).
- [ ] No field of the new patient has an `autocomplete` of its own (unit); their words are in the
      request's body and in no address (tester).
- [ ] `pnpm check`, `pnpm build`, `pnpm test:e2e` (all three browsers) and `pnpm audit --prod` pass.

---

### E01-T06 · Appointment drawer: details, move, status changes

- **Role:** builder · **Risk:** critical · **Depends on:** E01-T05b (the overlap warning a move
  reuses), E01-T05c (the guard against a double click's second press)
- **Read:** `scope` (Appointment drawer) · `design-ref` (demo lines 1197–1258; logic 1937–1957) · `data-model` (Appointment state machine) · `handoffs/E00-T04e.md` (the reviewer's suggestion 1) · `handoffs/E01-T05a.md` (the tester's Discovered line 1) · D-113, D-114

**Why.** Status changes drive messages later. Wrong transitions mean wrong messages.

**Do.**
- A pure function `nextAppointmentStatus(current, action, actor, facts)` implementing the
  state machine table, with exhaustive tests.
- `scheduling` functions: move (time and/or provider, re-checks overlap), confirm, arrive,
  complete, mark no-show, cancel (who, optional reason), undo/restore per the table.
  Each emits a domain event hook (a no-op now) that E02 uses to trigger message planning.
- Drawer: patient and treatment header, status pill, time and provider selects, status
  buttons, "Book next visit", "Patient profile".
- **A form inside the drawer or the dialog sends only itself** (E00-T04e review, `message`; moved
  here from E01-T05, the first form inside another's, D-113): React passes a `submit` on to every
  `onSubmit` above it in React's tree, through the portal too (React 19.2.8), and `StaffForm` sends
  from `onSubmit` with `new FormData(event.currentTarget)`, so the cancel dialog's form, opened from
  the drawer's move form, would also send the move. The drawer's and the dialog's content stop a
  `submit` from leaving them (`src/ui/`); `StaffForm` is not changed.
- **A drawer or dialog stays open while its form's request is on its way** (E01-T05a tester,
  `slice`; D-114): today Book, then Escape or Close before the answer, closes the booking drawer, and
  a refusal (an overlap, a patient no longer active) then shows nowhere. Escape, Close and the overlay
  wait for the answer, so a refusal always shows above its button: the booking drawer, this drawer
  and the cancel dialog. A drawer cannot see `StaffForm`'s send today (it sends from `onSubmit`, so
  `useFormStatus` does not see it): `StaffForm` tells its caller, the change this critical task's
  review covers.
- **The drawer keeps to controls the double click's guard stops** (E01-T05c tester; the double
  click criterion below, `message`): the
  guard (`src/ui/double-click-guard.ts`) drops a press by its `mousedown` and its `click`, so a control
  that acts on the pointer's press (Radix's Select or DropdownMenu trigger) would still act within the
  half second. The time and provider selects are the browser's own (`NativeSelect`) and the status
  controls are buttons; a control that acts on the press extends the guard first.

**Out of scope.** Message timeline, aftercare box, treatment plan list, "start visit" (later epics; do not render placeholders).

**Acceptance.**
- [ ] Every allowed transition works from the UI; every disallowed one is refused by the
      function (table-driven unit test covers all status × action pairs).
- [ ] No-show cannot be set before the appointment's start time.
- [ ] Moving onto an occupied slot behaves like booking (warning, explicit override).
- [ ] Restoring a cancelled appointment re-checks overlap.
- [ ] Every transition writes an audit row with old and new status.
- [ ] The event hook fires exactly once per successful change (test).
- [ ] Cancelling from the dialog over the drawer runs the cancel only: the drawer's move form sends
      nothing, one request and one audit row (tester, in a browser; the guard above, E00-T04e review).
- [ ] A double click on a block (80, 150 and 250 ms between the clicks), its second press on a status
      button: the drawer open and no status changed (e2e, three browsers; E01-T05c's guard).
- [ ] Escape, Close or the overlay while a request of the drawer or the dialog is on its way: it
      stays open and shows the answer, a refusal too; the booking drawer as well (e2e, the answer held).

---

### E01-T07 · Calendar: week view

- **Role:** builder · **Risk:** low · **Depends on:** E01-T04a, E01-T04b (its lanes follow the filter)
- **Read:** `scope` (Calendar) · `design-ref` (demo lines 284–314; logic 1835–1845)

**Do.** Week view with one lane per visible provider inside each day, appointment counts and
no-show counts in the day header; clicking a day or block opens that day (and the drawer).
Day / Week toggle.

**Acceptance.**
- [ ] The seeded week renders; counts are correct; lanes follow the provider filter.
- [ ] Clicking a block opens the day view with that appointment's drawer.
- [ ] Week boundaries follow the clinic's locale (Monday start where applicable).

---

### E01-T08a · Settings: the page and the clinic's details

- **Role:** builder · **Risk:** normal (a screen and a form: no table, migration, policy, permission,
  wrapper or login change) · **Depends on:** E01-T01a, E01-T01b, E00-T04a … E00-T04e, E00-T05b (all
  Done). Runs beside E01-T04a, in a second checkout (board, "Now"; owner, D-110)
- **Read:** `scope` (Navigation and roles; Settings) · `design-ref` (demo lines 746–757; logic
  1912–1914) · `data-model` (`clinics`) · D-015, D-097, D-098, D-101, D-110 · the architect section of
  `handoffs/E01-T08a.md`

**Why.** After `clinic:create`, only the database can change a clinic's details. Its name and phone
go into every message (E02), and its time zone places every visit and every send: a zone saved wrong
puts a reminder an hour off for half the year. Split from E01-T08 (D-110).

**Do.**
- **The Settings page** (`/settings`), the owner's alone (`settings.manage`): it renders
  `<PageClinic>`, answers anyone else with `notFound()` as the new-patient page does, and reads with a
  `staffRead` naming `settings.manage`. Its tabs (`Tabs`; the demo's, line 753) hold one tab now,
  **Clinic**; each later tab comes with its task (Opening hours E01-T08b, Providers and Treatment
  types E01-T09, Staff E04-T02, Message channels E03-T06), none shown before.
- **The Clinic tab:** one `StaffForm` with name, phone, address, email, time zone, language, currency
  and phone country, filled from the clinic's row, keyed by the page's clinic (D-098). The name is
  required; the phone is read with the form's own phone country (`readPhone`, D-097) and stored in
  E.164, and shown as the clinic writes it (`phoneAsWritten`), both exported from `@/modules/patients`,
  never copied; the email trimmed and lower-cased. Zone, language, currency and phone country are the
  browser's own select (`NativeSelect`), offering the values their checks take; a stored value the
  options lack is offered as it is, so a save never changes a field nobody touched. Country and
  currency names through `Intl.DisplayNames` (data, as a formatted date is), languages' from the
  message file.
- **The checks.** What the input alone settles is the schema's, at its field (D-098):
  `newClinicProblems()` for name, zone, country, currency and language, the one check `clinic:create`
  makes, and the phone read with the input's country. The zone's database check (below) is the
  handler's refusal, shown above the button, naming the field.
- **A zone both the database and Intl know, by its name** (E00-T05b review, `message`; D-110): one of
  PostgreSQL's region names (`pg_timezone_names`, `Area/Location`, none under `Etc/`) or `UTC`, found
  in any case and stored as PostgreSQL spells it (`europe/skopje` → `Europe/Skopje`), and one Intl
  knows. So no fixed offset: a clinic saved with `+01:00` never moves to summer time, and PostgreSQL
  reads that text as an hour west of UTC where Intl reads it east; nor `Etc/GMT-1`. Intl's own list is
  not the source: it lacks `UTC` and `Europe/Kyiv`, and spells 18 zones the old way (`Europe/Kiev`,
  `Asia/Calcutta`), which the database does not know. One function in `tenancy`, for this form and for
  `clinic:create`: `createClinic()` checks the zone in its transaction and stores PostgreSQL's
  spelling, the script naming `--time-zone` when it refuses and writing nothing; `newClinicProblems()`
  also refuses a zone Intl reads as an offset, before anything connects. `docs/runbook.md`'s
  `--time-zone` line says so.
- **The save** (`tenancy`): one function that sets the eight details and `updated_at` (from `now`) by
  name, never `status` (the clinic's pause, the operator's, D-030) or `settings` (E02-T06, E03-T06).
  One audit row, `clinic.updated`, its entity the clinic, its metadata the names of the fields
  changed (as values: a key that is a personal field name fails `audit.record`). The next page shows
  what was saved: the sidebar's clinic name, every time in the new zone.
- **One test changes (owner, 2026-10-12):** `tests/integration/staff-pages.test.ts` opens every staff
  page as a front-desk member and expects each to render; for `/settings` it now expects "not found"
  for that member, in each case that opens every page, and a new case opens it as an owner. No other
  expectation of it changes (agent rule 8).

**Out of scope.** The calendar and everything E01-T04a changes beside this task (D-110):
`src/app/(staff)/calendar/`, `src/lib/calendar-day.ts` and `src/db/seed/seed-day.ts` with their tests,
the day's reads it adds to `src/modules/scheduling/`, `src/modules/tenancy/` and
`src/modules/patients/` (and `list.ts`'s `dayInZone`), the provider tints in `src/app/globals.css`,
`CLAUDE.md`'s `src/lib/` line. Opening hours and closed days (E01-T08b: the calendar reads their
tables). `clinics.settings` and its typed accessor (E02-T06). The database's guard on `status`
(E02-T01). The demo's City field (one `address`) and "Booking link for patients" (D-024). Adding the
page to the accessibility check, which holds no E01 screen yet.

**Acceptance.**
- [ ] The owner's changes are saved and audited, one row per save; an empty name, an impossible
      phone, an email that is no email, and a currency, language or phone country the checks refuse
      are each shown at their field, with nothing saved (tests).
- [ ] The zone, in the form and in `clinic:create`: `+01:00`, `Etc/GMT-1` and `Europe/Kiev` (Intl
      knows it, the test database does not) refused; `europe/skopje` saved as `Europe/Skopje`; `UTC`
      and `Europe/Kyiv` taken (unit and integration tests).
- [ ] A dentist, a hygienist and the front desk cannot open Settings or change anything: the page
      answers "not found" and each action `forbidden` (`src/app/action-permissions.test.ts`, the page
      test above).
- [ ] A save changes its own clinic only, and of it only the eight details and `updated_at`: `status`
      and `settings` stay as they were, another clinic's row unchanged (integration test, two clinics).
- [ ] After another zone is saved, every appointment keeps its moment (`starts_at`, `ends_at`
      unchanged) and the next page reads the new zone (integration tests). The calendar's side is
      E01-T08b's.
- [ ] The clinic's new name shows in the sidebar on the next page; "Try it" steps for the owner.
- [ ] `pnpm check`, `pnpm build`, `pnpm test:e2e` (all three browsers) and `pnpm audit --prod` pass.

---

### E01-T08b · Settings: opening hours

- **Role:** builder · **Risk:** normal (a form on a table the app role already writes, migration 0002:
  no table, migration, policy, permission, wrapper or login change) · **Depends on:** E01-T08a (the
  page and its tabs), E01-T04a (the calendar that shows the hours; `tenancy`'s reads) (both Done).
  Runs beside E01-T04b, in the second checkout (owner, D-111)
- **Read:** `scope` (Settings; Calendar) · `design-ref` (demo lines 770–777; logic 1847, 1919) ·
  `data-model` (`clinic_hours`) · D-098, D-110, D-111 · the architect section of `handoffs/E01-T08b.md`

**Why.** The calendar shades the hours a clinic is closed and counts % booked from its opening hours
(E01-T04a); today only the seed sets them. And the clinic's phone goes into every message (E02): a
phone country changed in Settings must not change the number by itself (E01-T08a, `message`). Split
from E01-T08 (D-110), and again (D-111): the closed days are E01-T08c.

**Do.**
- **The Opening hours tab** (demo lines 770–777), after Clinic: each weekday, Monday first, open or
  closed (a `Switch`) with its opening and closing time; one `StaffForm` for the week, keyed by the
  page's clinic (D-098), filled from `openingHours()`. A time is the browser's own select
  (`NativeSelect`) in steps of 15 minutes from 00:00 to 23:45, as the demo's booking times are (logic
  1847): its value `HH:MM`, its label through next-intl's formatter, as the calendar's hour labels
  are, so E01-T04b's 24-hour clock reaches it. A stored time the options lack (08:10) is offered as it
  is, so a save never changes a weekday nobody touched (the zone's rule in E01-T08a).
- **The checks** are the schema's, each at its field (D-098): an open weekday needs both times, and
  its closing after its opening; a closed weekday's times are not read. Every field is a flat name the
  schema declares (`action-input.ts` shows any other key as `*`).
- **The save** (`tenancy`): one function that writes the week and nothing else: a row per open
  weekday, inserted or updated with `updated_at` from `now`; no row for a closed one
  (`data-model.md`). One audit row, `clinic.hours_updated`, its entity the clinic, its metadata the
  weekdays changed (their ISO numbers). The clinic's row is locked while it runs, as
  `saveClinicDetails` does, so two saves at once each name their own changes and neither ends on a
  duplicate weekday. The next page shows the new hours: the calendar's shading and % booked.
- **The clinic's phone keeps its number** (E01-T08a's builder, `message`; D-111): the Clinic tab shows
  the stored phone with its country code (`+389 70 001 402`), formatted by `@/modules/patients`, where
  the phone package is (D-097), never copied. A phone country changed in the same save then leaves the
  number as it was; a number typed without its code is still read with the form's country, as the
  line under Phone country says.

**Out of scope.** Closed days (E01-T08c). Lunch and other breaks: provider breaks, E01-T09 (D-018).
Quiet hours (E03-T06). Moving or warning about the appointments outside new hours (the calendar still
shows them). What E01-T04b changes beside this task (D-111): `src/app/(staff)/calendar/`,
`src/i18n/request.ts` (the 24-hour clock), `activeMembership()` and its callers, the patient list's
times and their tests, `CLAUDE.md`'s "Dates and times". The page in the accessibility check and in a
journey (E01-T11).

**Acceptance.**
- [ ] Opening hours saved per weekday, a closed weekday without a row; an open weekday without both
      times, or closing at or before its opening, refused at its field, with nothing saved; a weekday
      stored as 08:10 kept by a save that does not touch it; one audit row per save, naming the
      weekdays changed (tests).
- [ ] A dentist, a hygienist and the front desk cannot change the hours: the action answers
      `forbidden` (`src/app/action-permissions.test.ts`).
- [ ] A save changes its own clinic's hours only, another clinic's unchanged (integration test, two
      clinics); two saves at once both succeed, the second after the first, each naming only its own
      changes (integration test).
- [ ] Settings and the calendar together: a weekday closed and hours changed in Settings show on the
      calendar's day (its read after the save: closed, the shaded parts, % booked), and a zone saved in
      the Clinic tab moves the day's appointments to the new zone's times, each keeping its moment
      (integration tests).
- [ ] The clinic's phone is shown with its country code; with the phone country changed and the phone
      left as shown, the stored number stays; a number typed without its code is read with the new
      country (tests).
- [ ] `pnpm check`, `pnpm build`, `pnpm test:e2e` (all three browsers) and `pnpm audit --prod` pass.

---

### E01-T08c · Settings: closed days

**As built** (Done 2026-10-19, merged 2026-10-14, PR #66; D-115): as planned, about 380 lines of product
code with comments. Also: whenever the list's rows change, it takes no pointer click for a second
(`SETTLE_MS`), so a double click's second press reaches no Remove that a row's leaving moves under the
pointer (the tester's finding); the keyboard is never held, and after a Remove it is on the section's
heading. Merged with the delta review's change open: with the heading above the window, that focus
scrolls another day's Remove under the pointer before the guard starts. That is E01-T08d (owner,
D-115). The layout, which the demo lacks, is kept, and each Remove stays teal (owner, 2026-10-19). The
text below is the plan as it was.

- **Role:** builder · **Risk:** normal (a list and two small forms on a table the app role already
  writes, migration 0002: no table, migration, policy, permission, wrapper or login change) ·
  **Depends on:** E01-T08b (the Opening hours tab it joins), E01-T04a (both Done). Runs beside
  E01-T05, in the second checkout (owner, D-112)
- **Read:** `scope` (Settings; Calendar) · `data-model` (`closed_days`) · D-029, D-098, D-111, D-112 ·
  the architect section of `handoffs/E01-T08c.md`

**Why.** A holiday closes the clinic for the day: the calendar shows it closed (E01-T04a), and quiet
hours will count it as a quiet day, so no reminder goes out on it (D-029, E03-T06). Today only the
database can add one. Split from E01-T08b (D-111).

**Do.**
- **Closed days**, on the Opening hours tab under the week, outside the week's form (a form holds no
  other form): the clinic's closed days from its today on, by date, each with its label and a Remove
  button, or one line when none is ahead; one added by its date (the browser's own date field) and a
  label. A client component keyed by the page's clinic (D-098), its rows read with `settings.manage`,
  as the week is. After an add, its two fields are empty again. The section's line says what a closed
  day does today, the calendar shows it closed, and nothing about messages, which come later (E02,
  E03-T06).
- A closed day is a calendar date, never a moment: shown from `YYYY-MM-DD` in UTC (`CLAUDE.md`, Dates
  and times); the clinic's today from `dayInZone()` (`src/lib/calendar-day.ts`) with the clinic's zone
  (`tenancy.clinicPlace()`) and the wrapper's `now`. Today itself may be added and removed.
- **The checks:** a date that is no date (`isCalendarDay`) and an empty label (trimmed, at most 100
  characters) are the schema's, at their fields. A date already closed (`already_closed`) and one
  before the clinic's today (`in_the_past`) are the handler's refusals, shown above the button with a
  text that names the Date field (D-098; a refusal's text is fixed per code, so it never repeats the
  date typed); so is a Remove of a day no longer closed (`not_closed`: removed in another tab) or of one
  before the clinic's today. A date before today is refused before any query: `isCalendarDay` takes
  `0000-01-01`, which PostgreSQL does not.
- **The writes** (`tenancy`): add one, an insert that does nothing when the clinic has the date already
  (its unique key, migration 0002), answered `already_closed`, so a date closed meanwhile in another tab
  is the same refusal, never a failure; remove one by its date, none removed answered `not_closed`. No
  lock on the clinic's row: the key settles two adds at once. Each audited,
  `clinic.closed_day_added` or `clinic.closed_day_removed`, its entity the clinic, its metadata the
  date, never the label (free text). Each Remove is its own small `StaffForm` (the date hidden, the
  button its Send), so it sends the frame's clinic and answers one way (D-092). When one is done, the
  page is rendered again (`refresh()`, as the other saves): the list, and the calendar's next read.

**Out of scope.** Past closed days: not listed, added or removed. A half day (a closed day closes the
whole day). Moving or warning about the appointments on a day closed later (the calendar still shows
them). Quiet hours (E03-T06), which read the closed days. Any change to the calendar, which shows a
closed day already (E01-T04a) and which E01-T05 changes beside this task (D-112). The page in the
accessibility check and in a journey (E01-T11).

**Acceptance.**
- [ ] A closed day added and removed, one audit row each, naming the date and never the label; a date
      that is no date, and an empty or too long label, shown at their fields; a date already closed and
      one before the clinic's today refused above the button, with nothing saved; a Remove of a day no
      longer closed, or of one before the clinic's today, refused (tests).
- [ ] A dentist, a hygienist and the front desk can neither read, add nor remove closed days: each
      action answers `forbidden` (`src/app/action-permissions.test.ts`).
- [ ] A change touches its own clinic's closed days only: another clinic's row for the same date
      unchanged (integration test, two clinics).
- [ ] A closed day added in Settings shows on the calendar's day (its read: closed, with its label),
      and removing it opens the day again (integration test).
- [ ] In a zone behind UTC (tests that name `America/New_York`): at 22:00 on the 14th there (the 15th
      in UTC), the 14th is still the clinic's today, listed and accepted, and the 13th refused; a closed
      day shows on its own date, never the day before.
- [ ] `pnpm check`, `pnpm build`, `pnpm test:e2e` (all three browsers) and `pnpm audit --prod` pass.

---

### E01-T08d · Settings: a double click on a closed day's Remove changes nothing else, wherever the page scrolls

- **Role:** builder · **Risk:** normal (a screen: the closed days' client component and its e2e checks;
  no action, wrapper, `StaffForm`, query, table or migration) · **Depends on:** E01-T08c (Done). Runs
  after E01-T10, before E01-T11 (owner, D-115)
- **Read:** D-107, D-115 · `handoffs/E01-T08c.md`: the reviewer's delta review (its required change
  1), fix round 1's and fix round 2's builder sections · the architect section of
  `handoffs/E01-T08d.md`

**Why.** A closed day opened by mistake is one the calendar offers for booking and, from E03-T06, one
reminders go out on (D-029). E01-T08c's guard stops a double click's second press from removing a
second day when the rows move, but not when the page scrolls first: with the list's heading above the
window, the focus a Remove moves to the heading scrolls the page before the guard starts, and the
second press lands on another day's Remove (its delta review: Chromium and Firefox) or, higher in the
window, on the week's form. From E01-T08c's last review (`message`, D-115).

**Do.**
- **A double click's second press on the closed days changes nothing** (`message`): whatever the first
  press's answer moves or scrolls under the pointer in the second after it (another day's Remove, the
  week's switches, times and Save, the add form), the second press reaches none of it, with the list's
  heading above the window too. The way is the builder's: for example, the focus moved to the heading
  only in the commit that starts the guard, a guard from the moment a Remove is sent, or a pointer's
  Remove that scrolls nothing.
- **The keyboard keeps its place:** after a Remove the focus is on the section's heading, shown in the
  window, and Tab goes on from there; no guard holds the keyboard (E01-T08c).
- **The checks** in `tests/e2e/closed-days.spec.ts`, beside E01-T08c's: days of each browser's own,
  `inTurn`, the second click the page's own, made at the event it means (fix round 2; D-107), so no
  lateness of Playwright's decides a result.

**Out of scope.** The guard's cost, a deliberate click dropped for a second with no cue (E01-T08c's
tester and delta review: within the trade-off). The add form's double click in WebKit ("Fill this in."
on the emptied form, nothing saved; E01-T08c tester, `none`). A `min` on the date field (E01-T08c
review, `none`). A quieter Remove (owner, D-115). The drawers' and dialogs' guard (E01-T05c).

**Acceptance.**
- [ ] With 16 closed days or more, a 1280 × 800 window and the list's heading above it (the delta
      review's case): one click on a day's Remove, then the page's own click where the pointer rests at
      each moment something moves under it (the heading's `focus`, each `scroll` of the window, the
      row's leaving), at three heights in the window, the highest where the scroll brings the week's
      form under the pointer: one request sent, that day removed, every other day still closed, no
      weekday's switch or time changed. Red on today's `main` (`931ba96`) in Chromium and Firefox
      (e2e, three browsers; where WebKit's layout brings no control under the pointer, the check says
      so and asserts the rest).
- [ ] By keyboard, Enter on a Remove with the heading above the window: that day removed, the focus on
      the heading and the heading in the window; Tab then reaches the first day's Remove (e2e).
- [ ] E01-T08c's three double-click checks stay green, unchanged (rule 8).
- [ ] `pnpm check`, `pnpm build`, `pnpm test:e2e` (all three browsers) and `pnpm audit --prod` pass.

---

### E01-T09 · Settings: providers and treatment types

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T08a (the Settings page and its tabs),
  E01-T04a (the calendar its criteria name)
- **Read:** `scope` (Settings) · `data-model` (`providers`, `provider_breaks`, `treatment_types`)

**Do.**
- Providers: add, edit (name, short name, kind, chair label, colour), weekly breaks,
  deactivate (never delete: past appointments keep their provider), order.
- Treatment types: add, edit (name, default length, optional price, "needs aftercare"),
  deactivate.
- **A number's own error text** (E00-T04c, `speed`): the first number fields. `form.fieldErrors`
  has one text per kind of problem, so a length below its limit reads "This is too short.". Texts
  for a number too small or too big (or a text per field in `StaffField`); E01-T05a's length is a
  select (D-113), so these are the first number fields. A change to `StaffForm`, `StaffField` or `form-answer.ts` makes this task critical, as it
  made E00-T04d (D-093): settled in its Ready pass, with the field-level refusal on the Discovered
  list (D-098).

**Acceptance.**
- [ ] A new provider appears as a calendar column; a deactivated one disappears from new
      bookings but past appointments still show.
- [ ] A deactivated treatment type is not offered for new bookings.
- [ ] Breaks appear hatched on the calendar.
- [ ] All changes audited; restricted to `settings.manage`.
- [ ] A length or a price out of range shows a number's own error text, not a text field's (unit
      test).

---

### E01-T10 · Today screen, first version

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T06, E01-T04b (the provider link)
- **Read:** `scope` (Today) · `design-ref` (demo lines 62–137; logic 1783–1792)

**Why.** The landing page: what does today look like?

**Do.**
- Greeting by role and time of day, date, buttons (Open calendar, New appointment).
- Today's appointments list: time, patient, treatment, provider, status pill; counts in the
  header. A dentist sees their own patients (their provider as E01-T04b reads it). Clicking a row
  opens the appointment drawer.
- A layout slot for the right-hand panels that later epics add. **No fake panels.**

**Out of scope.** Results panel, needs a call, aftercare, due for a visit (later epics).

**Acceptance.**
- [ ] The list matches the calendar for the same day and role.
- [ ] Counts are correct for the seeded day.
- [ ] No invented numbers or placeholder panels are shown.

---

### E01-T11 · Journey J2 and a hard look at scheduling

- **Role:** tester · **Risk:** normal · **Depends on:** E01-T02a … E01-T10, E00-T06b; E00-T06c if J2
  sets "now", decided when this task is refined (D-100)
- **Read:** `test-strategy` (End-to-end journeys; Tenant isolation; Permissions) · all E01 handoff notes

**Do.**
- Playwright journey **J2** (front-desk day), through the calendar: it books, moves and changes
  statuses there and finds each change on the day's grid (E01-T04a has no journey of its own,
  `slice`). The accessibility check (E00-T06b) on every page J2 opens, as on J1's, with the booking
  drawer open and its warning showing (E01-T05a … E01-T05d), and on Settings opened as its owner, each
  tab (E01-T08a … E01-T08c, E01-T09; `slice`), which J2's front desk cannot open: no E01 screen is in
  it yet (each E01 task left its own out).
- Exploratory testing of the whole epic: wrong roles, the second clinic, double clicks,
  keyboard-only booking, odd times (23:30, across midnight), daylight-saving dates, very long names.
- Time five bookings of an existing patient by keyboard and report the median.
- **The first click after a pause** (E01-T04b tester, `speed`): while the calendar's read on use is on
  its way, Previous, Next, Today and the sidebar's links wait for it (React holds a navigation's
  transition until the read's ends; a read held 3 s showed Next after 3.1–3.4 s), and a click's own
  `pointerdown` starts such a read whenever 30 s have passed; the patient search has the same pattern.
  Time it on staging, with Book after a pause too, and report whether a receptionist would notice.
  Time the drawer's patient search there as well (E01-T05a builder, `speed`): it asks for the
  patient list's 50 rows, with their last and next visits, at each pause in typing, to show five; if
  a receptionist would notice, a limit in its input is the fix (a task).
- **A press right after a drawer opens** (E01-T05c builder, `speed`): for half a second after a
  drawer or dialog opens, a press in it is dropped without a sign (the double click's guard), so a
  chip pressed at once must be pressed again. Watch whether a receptionist hits it, by mouse and, if
  the desk has one, on a touch screen (the guard reads the same events; no check drives touch).
- Findings go to the handoff note; real bugs become tasks via the board.

**Owner action.** If a pilot receptionist is available (Q-09), let them try booking on staging now.

**Acceptance.**
- [ ] J2 passes in CI.
- [ ] Permission table test covers every E01 action.
- [ ] A written findings list exists; nothing critical is open.

**Milestone check (M1):** on staging, run a day for the demo clinic from the UI only.

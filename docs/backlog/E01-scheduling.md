# E01 · Scheduling (milestone M1)

**Outcome:** the front desk can run a working day in Chairside: patients, a calendar per
provider, booking, moving, cancelling, arriving, completing. No messages yet.

**Why now:** appointments are what every message is about. And booking speed is the first
thing a receptionist judges (risk R-09), so it should be in front of a real one early.

Order: T01a → T01b → T02a → T02b → T04a and T08a side by side (two checkouts, D-110) → T04b and T08b
side by side (D-111) → T08c, T09 → T03, T05 → T06 → T07, T10 → T11. With E00 (D-087, D-090, D-091,
D-093, D-096, D-108, D-110, D-111): E00-T05a → T01a → T01b → E00-T04c → E00-T04d → E00-T04e → T02a →
T02b → E00-T06b → E00-T05b → E00-T07 → T04a and T08a → T04b and T08b → T08c, T09 and the rest, so a
receptionist sees a patient list before Playwright and staging exist. T01 is split in two (D-091): the
schema and the provider link (T01a), the seed (T01b). T02 is split in two (D-096): the list and the
search (T02a), adding a patient (T02b); editing a patient's details moved to T03, the profile. T04 is
split in two (D-108): the day view (T04a); the provider filter, a provider's own column, the "now" line
and the reading on use (T04b). T08 is split in two (D-110): the Settings page and the clinic's details
(T08a), beside T04a; the opening hours and closed days (T08b), after T04a, whose calendar shows them.
T08b is split again (D-111): the opening hours (T08b), beside T04b; the closed days (T08c), on the
same tab, after it.

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

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T02b
- **Read:** `scope` (Patients list and profile) · `design-ref` (demo lines 348–446; logic
  1860–1880) · D-033, D-040, D-095, D-096 · `handoffs/E01-T02b.md` (the patient form)

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

### E01-T05 · Book an appointment (new-appointment drawer)

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T04a, E01-T02b
- **Read:** `scope` (New appointment drawer) · `design-ref` (demo lines 1323–1362; logic 1958–1964, 2116–2135) · `data-model` (`appointments`, "No double booking") · D-020, D-093, D-095 · `handoffs/E00-T04e.md` (the reviewer's suggestion 1, the tester's note 1)

**Why.** The single most used action. It must be fast.

**Do.**
- `scheduling.createAppointment(...)` with validation, overlap handling and audit.
- Drawer opened from "New appointment" or by clicking an empty slot (prefilled time and provider):
  patient search with suggestions and "add as new patient" (first name, last name, phone or
  email), treatment chips that set the default length, start / length / provider.
- If the slot overlaps: a clear warning and a second, explicit "Book anyway" (sets `overlap_ok`).
- **One booking per click** (E01-T01a tester note 1, `message`): the database refuses a second
  ordinary booking of the same time, not a second `overlap_ok` one, so a double click on "Book
  anyway" would keep two rows and E02 would remind the patient of each. The create action's
  duplicate check (E00-T03's double-submit line, on the Discovered list) covers it.
- After a booking the drawer closes or its form is emptied: `StaffForm` keeps every field after
  done (D-092), so a second Send would book again (E00-T04c review, `slice`).
- The patient search keeps nothing in the browser (E00-T04d review, `data`, D-095): inside the
  booking form, no `autocomplete` of its own; outside it, `autoComplete="off"`; its words never in
  the page's address.
- A race (someone else took the slot meanwhile) shows a friendly message, not an error page.
- Fully usable by keyboard; focus starts in the patient field.
- **A double click on the button that opens the drawer leaves it open** (E00-T04e test, `speed`):
  today the second click lands on the overlay, which closes it on a click (Radix acts on the
  `click` after a pointer down outside), so a receptionist who double-clicks "New appointment" sees
  the drawer flash and go. The drawer's and the dialog's content (`src/ui/sheet.tsx`, `dialog.tsx`)
  ignore a pointer down outside them for as long as a double click lasts after they open (half a
  second, Windows' default); after that a click on the overlay closes them, and Escape and the close
  button always do.
- **A form inside the drawer or the dialog sends only itself** (E00-T04e review, `message`): React
  passes a `submit` on to every `onSubmit` above it in React's tree, through the portal too (React
  19.2.8), and `StaffForm` sends from `onSubmit` with `new FormData(event.currentTarget)`. A staff
  form in a dialog opened from inside another staff form (a quick new patient from the booking form,
  E01-T06's cancel from the drawer's move form) would also send the outer one. The drawer's and the
  dialog's content stop a `submit` from leaving them (`src/ui/`); `StaffForm` is not changed.

**Out of scope.** The "text a booking confirmation" tick box (E02-T12). Booking outside opening hours rules beyond a warning.

**Acceptance.**
- [ ] Booking an existing patient takes: open drawer, type name, pick, pick treatment, save.
      No more required steps.
- [ ] A new patient can be added and booked in one go.
- [ ] Overlap shows the warning; "Book anyway" works; without it the booking is refused.
- [ ] A double click on "Book anyway" books one appointment (integration test).
- [ ] Two simultaneous bookings of the same slot: one succeeds, the other gets the friendly message (integration test).
- [ ] The new block appears on the calendar immediately.
- [ ] Audit row written; the appointment's `source` is `staff`.
- [ ] The patient search has no `autocomplete` but `off` (unit test), and after a search the
      address holds none of its words (tester).
- [ ] A double click on "New appointment" (80, 150 and 250 ms between the clicks) leaves the drawer
      open in Chromium, Firefox and WebKit; a click on the overlay a second later closes it (tester,
      in a browser).
- [ ] A staff form in a dialog opened from inside another staff form sends its own action only: one
      request, one audit row (tester, in a browser, on a scratch page removed after).

---

### E01-T06 · Appointment drawer: details, move, status changes

- **Role:** builder · **Risk:** critical · **Depends on:** E01-T05
- **Read:** `scope` (Appointment drawer) · `design-ref` (demo lines 1197–1258; logic 1937–1957) · `data-model` (Appointment state machine)

**Why.** Status changes drive messages later. Wrong transitions mean wrong messages.

**Do.**
- A pure function `nextAppointmentStatus(current, action, actor, facts)` implementing the
  state machine table, with exhaustive tests.
- `scheduling` functions: move (time and/or provider, re-checks overlap), confirm, arrive,
  complete, mark no-show, cancel (who, optional reason), undo/restore per the table.
  Each emits a domain event hook (a no-op now) that E02 uses to trigger message planning.
- Drawer: patient and treatment header, status pill, time and provider selects, status
  buttons, "Book next visit", "Patient profile".

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
      nothing (tester, in a browser; E01-T05's guard, E00-T04e review).

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

- **Role:** builder · **Risk:** normal (a list and two small forms on a table the app role already
  writes, migration 0002: no table, migration, policy, permission, wrapper or login change) ·
  **Depends on:** E01-T08b (the Opening hours tab it joins), E01-T04a (Done)
- **Read:** `scope` (Settings; Calendar) · `data-model` (`closed_days`) · D-029, D-098, D-111 · the
  architect section of `handoffs/E01-T08c.md` (its Ready pass, in E01-T08b's Done pass)

**Why.** A holiday closes the clinic for the day: the calendar shows it closed (E01-T04a), and quiet
hours count it as a quiet day, so no reminder goes out on it (D-029). Today only the database can add
one. Split from E01-T08b (D-111).

**Do.**
- **Closed days**, on the Opening hours tab under the week: the clinic's closed days from its today
  on, by date, each with its label and a Remove button; one added by its date (the browser's own date
  field) and a label.
- A closed day is a calendar date, never a moment: shown from `YYYY-MM-DD` in UTC (`CLAUDE.md`, Dates
  and times); the clinic's today from `dayInZone()` (`src/lib/calendar-day.ts`) and the wrapper's
  `now`.
- **The checks:** a date that is no date (`isCalendarDay`) and an empty label (trimmed, at most 100
  characters) are the schema's, at their fields. A date already closed, and one before the clinic's
  today, are the handler's refusals, shown above the button with a text that names the date (D-098);
  so is a Remove of a day no longer closed (removed in another tab).
- **The writes** (`tenancy`): add one, remove one by its date. Each audited, `clinic.closed_day_added`
  or `clinic.closed_day_removed`, its entity the clinic, its metadata the date, never the label (free
  text). Each Remove is its own small `StaffForm` (the date hidden, the button its Send), so it sends
  the frame's clinic and answers one way (D-092).

**Out of scope.** Past closed days: not listed, not added. A half day (a closed day closes the whole
day). Moving or warning about the appointments on a day closed later (the calendar still shows them).
Quiet hours (E03-T06), which read the closed days. The page in the accessibility check and in a
journey (E01-T11).

**Acceptance.**
- [ ] A closed day added and removed, one audit row each; a date that is no date and an empty label
      shown at their fields; a date already closed and one before the clinic's today refused above the
      button, naming the date, with nothing saved; a Remove of a day no longer closed refused (tests).
- [ ] A dentist, a hygienist and the front desk can neither add nor remove one: each action answers
      `forbidden` (the permission test).
- [ ] A change touches its own clinic's closed days only: another clinic's row for the same date
      unchanged (integration test, two clinics).
- [ ] A closed day added in Settings shows on the calendar's day (its read: closed, with its label),
      and removing it opens the day again (integration test).
- [ ] In a zone behind UTC (tests that name `America/New_York`): at 22:00 on the 14th there (the 15th
      in UTC), the 14th is still the clinic's today, listed and accepted; a closed day shows on its own
      date, never the day before.
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
  for a number too small or too big (or a text per field in `StaffField`), which E01-T05's length
  uses too. A change to `StaffForm`, `StaffField` or `form-answer.ts` makes this task critical, as it
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
  `slice`). The accessibility check (E00-T06b) on every page J2 opens, as on J1's, and on Settings
  opened as its owner, each tab (E01-T08a … E01-T08c, E01-T09; `slice`), which J2's front desk cannot
  open: no E01 screen is in it yet (each E01 task left its own out).
- Exploratory testing of the whole epic: wrong roles, the second clinic, double clicks,
  keyboard-only booking, odd times (23:30, across midnight), daylight-saving dates, very long names.
- Time five bookings of an existing patient by keyboard and report the median.
- Findings go to the handoff note; real bugs become tasks via the board.

**Owner action.** If a pilot receptionist is available (Q-09), let them try booking on staging now.

**Acceptance.**
- [ ] J2 passes in CI.
- [ ] Permission table test covers every E01 action.
- [ ] A written findings list exists; nothing critical is open.

**Milestone check (M1):** on staging, run a day for the demo clinic from the UI only.

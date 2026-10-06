# E01 · Scheduling (milestone M1)

**Outcome:** the front desk can run a working day in Chairside: patients, a calendar per
provider, booking, moving, cancelling, arriving, completing. No messages yet.

**Why now:** appointments are what every message is about. And booking speed is the first
thing a receptionist judges (risk R-09), so it should be in front of a real one early.

Order: T01a → T01b → T02, T04, T08, T09 (parallel-safe) → T03, T05 → T06 → T07, T10 → T11. With
E00 (D-087, D-090, D-091): E00-T05a → T01a → T01b → E00-T04c → E00-T04d → T02 → E00-T06b → E00-T05b
→ E00-T07 → T04, T08, T09 and the rest, so a receptionist sees a patient list before Playwright and
staging exist. T01 is split in two (D-091): the schema and the provider link (T01a), the seed (T01b).

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
- **Read:** `data-model` (section 2) · D-033, D-040, D-044, D-049, D-090, D-091 · demo lines 1369–1404 (the sample clinic's providers and patients; their emails and phones are not copied: the fake-data rules) and 1518 (treatments) · the architect section of `handoffs/E01-T01b.md`

**Why.** Every scheduling screen after it (T02's patients, T04's calendar, T10's Today) needs a
clinic that looks like a working week, from one command. The second half of E01-T01 (D-091).

**Do.**
- **A seed file** after E00-T05a's, which stays as it is. Harbour Street Dental: the demo's three
  providers (two dentists, one hygienist) with chairs, hues and a lunch break each; open Monday to
  Friday, 08:00 to 18:00; a closed day after the seeded week; the demo's ten treatment types with
  their lengths; about 40 patients (some without a phone, one with a guardian, two siblings
  sharing a phone, one archived); a week of appointments. The second clinic: one provider, a few
  patients and appointments.
- **The week:** Monday to Friday of the week the seed runs in (of the next week on a Saturday or
  Sunday), in the clinic's time zone; statuses that fit the day: past days completed, no-show or
  cancelled, the day itself mixed, later days booked, confirmed or cancelled. The seed reads the
  clock once, where `pnpm db:seed` starts, and passes the day on, so a test can fix it. No two
  appointments of one provider overlap unless one has `overlap_ok`.
- **The links:** the seeded dentist's and hygienist's memberships (E00-T05a's) point at their
  providers. The seed only inserts today, so this is a new step that sets a link where none is set;
  the owner stays unlinked.
- **The fake-data rules:** names from the invented lists, in both scripts (D-049); treatment names
  and providers' short names join new invented lists in `fake-data.ts`: extend a list, never narrow
  the check (E00-T05a review suggestion 2). Phones from the block, emails at `example.test`,
  `language` `en` (D-053).
- **Fixed ids** in `seeded.ts`'s form, one per row, each used once across every seed file: a
  repeated id drops a row without a word, and an id with a 0 version or variant digit is refused by
  `z.uuid()` (E00-T05a tester note 2).
- `README.md`: what the seed holds now.

**Out of scope.** Tables and the provider link (E01-T01a). Linking the seeded owner. Messages and
every later row (each schema task brings its own). Any screen.

**Acceptance.**
- [ ] `pnpm db:reset` twice on one day gives the same rows and ids, apart from password hashes,
      each password row's own id and the times rows were written (tester, comparing the two);
      `pnpm db:seed` once more adds nothing and ends without an error.
- [ ] Seeded for a fixed weekday, the week is that day's, holds every status and at least one
      appointment that day, and the database refuses none of it; seeded for a Sunday, it is the
      next week (integration test).
- [ ] The patients include one without a phone, one archived, one with a guardian, two sharing a
      phone, and names in both scripts (a test reads the seed file).
- [ ] `clinics_for_user()` gives the seeded dentist and hygienist their providers' kinds, the
      seeded owner none (integration test).
- [ ] The fake-data test reads the new file, and fails on a treatment name or a provider's short
      name that is not in the lists (tester: one change of each, each restored).
- [ ] `pnpm check` and `pnpm build` pass.

---

### E01-T02 · Patients: list, search, create, edit

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T01a, E01-T01b, E00-T04a … E00-T04d
- **Read:** `scope` (Patients list and profile) · `design-ref` (demo lines 316–347; logic 1849–1858) · `data-model` (`patients`) · D-015, D-033, D-040

**Why.** Staff must find a patient in seconds by name or phone.

**Do.**
- `patients` module functions: search (name or phone fragment), create, update, change
  status. Phone normalised to E.164 using the clinic's default country; email lower-cased;
  invalid values rejected with a clear message. The search is written on the expressions
  E01-T01a's trigram indexes hold (the full name, `phone_e164`), so it uses them.
- Patients list screen: search box, rows (name, age and phone, last visit, next visit),
  filter "All" (other filters arrive with their epics), empty state, link to import (placeholder).
- Create / edit form: first name, last name, date of birth, phone, email, language, guardian
  name, notes (labelled "not a clinical record"), status.
- On create, warn about likely duplicates (same name + date of birth, or same name + same
  contact). A shared phone alone is not a warning.
- Dates and times are shown in the clinic's time zone (`clinics.timezone`, D-015), set once for
  every staff page so later screens reuse it. `src/i18n/request.ts` sets none today: next-intl then
  warns and uses the computer's zone, so the server and the browser can show one visit at different
  times (Discovered, E00-T04a).

**Out of scope.** Profile page (T03). Consent switches (E02). Care plan, treatment plan columns.

**Acceptance.**
- [ ] Search finds a seeded patient by part of the name and by part of the phone, digits only or formatted.
- [ ] Search over 20,000 generated patients returns in under 300 ms (integration test).
- [ ] Phones are stored in E.164; an impossible number is rejected.
- [ ] Creating a likely duplicate shows a warning and still allows saving.
- [ ] Two siblings with the same phone can be created without a duplicate warning.
- [ ] Every create and edit writes an audit row without personal values in it.
- [ ] A user of the second clinic cannot find or open the first clinic's patients.
- [ ] A visit's date and time show in the clinic's time zone whatever the computer's zone (test).

---

### E01-T03 · Patient profile

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T02
- **Read:** `scope` (Patients list and profile) · `design-ref` (demo lines 348–446; logic 1860–1880)

**Why.** One place that answers "what is going on with this patient?".

**Do.**
- Profile page: header (name, age, phone, email, patient since), buttons "Book appointment"
  (opens the new-appointment drawer once T05 exists; until then disabled), next appointment
  card, visit history (completed appointments), notes, status, guardian.
- Sections that later epics fill are **not rendered as fake content**: Messages (E02), Care
  plan (E05), Treatment plan (E06), Communication switches (E02).
- Opening a profile writes a "viewed patient record" audit row.

**Acceptance.**
- [ ] The profile shows real data for seeded patients; an archived or deceased patient is clearly marked.
- [ ] Opening a profile creates one audit row per view.
- [ ] Layout matches the demo's two-column profile for the sections that exist (screenshot in the handoff note).
- [ ] No placeholder or invented data is shown for sections that do not exist yet.

---

### E01-T04 · Calendar: day view

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T01a, E01-T01b, E00-T04a … E00-T04d
- **Read:** `scope` (Calendar) · `design-ref` (demo lines 215–283; logic 1812–1834; status colours 1377–1385; provider colours) · D-018, D-019, D-041

**Why.** The calendar is where the front desk lives.

**Do.**
- Day view: one column per active provider with header (initials, name, chair label, % booked
  against opening hours), hour labels, half-hour grid lines, appointment blocks placed by
  time, provider breaks shown hatched, a "now" line on today.
- Block styling by status as in the demo (confirmed normal, booked/no reply tagged, arrived
  outlined, completed faded, cancelled and no-show struck through).
- Provider colours in the theme: the four tints of `design-ref` "Provider colours" as formulas over
  a hue set on the element from `providers.color_hue`, such as
  `--color-provider-tint: oklch(0.95 0.03 var(--provider-hue))`, in an `@theme inline` block. In a
  plain `@theme` block the variable is resolved on `:root`, where no hue is set, and gives no colour
  (E00-T04a review).
- Previous / Today / Next, provider filter chips (at least one always on), a dentist opens on their own column.
- Data loaded for the visible day in the clinic's time zone; refreshes every 30 seconds and on window focus.
- Clicking a block or an empty slot calls a handler (the drawers arrive in T05 and T06).

**Out of scope.** Booking, editing, week view, drag and drop.

**Acceptance.**
- [ ] The seeded day renders with the correct blocks in the correct columns and positions.
- [ ] A day that crosses a daylight-saving change still shows appointments at the right local times (test).
- [ ] An appointment changed in the database appears within the refresh interval without reloading.
- [ ] Days outside opening hours and closed days are visibly marked.
- [ ] Visual match with the demo's day view (screenshot comparison in the handoff note).

---

### E01-T05 · Book an appointment (new-appointment drawer)

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T04, E01-T02
- **Read:** `scope` (New appointment drawer) · `design-ref` (demo lines 1323–1362; logic 1958–1964, 2116–2135) · `data-model` (`appointments`, "No double booking") · D-020

**Why.** The single most used action. It must be fast.

**Do.**
- `scheduling.createAppointment(...)` with validation, overlap handling and audit.
- Drawer opened from "New appointment" or by clicking an empty slot (prefilled time and provider):
  patient search with suggestions and "add as new patient" (first name, last name, phone or
  email), treatment chips that set the default length, start / length / provider.
- If the slot overlaps: a clear warning and a second, explicit "Book anyway" (sets `overlap_ok`).
- A race (someone else took the slot meanwhile) shows a friendly message, not an error page.
- Fully usable by keyboard; focus starts in the patient field.

**Out of scope.** The "text a booking confirmation" tick box (E02-T12). Booking outside opening hours rules beyond a warning.

**Acceptance.**
- [ ] Booking an existing patient takes: open drawer, type name, pick, pick treatment, save.
      No more required steps.
- [ ] A new patient can be added and booked in one go.
- [ ] Overlap shows the warning; "Book anyway" works; without it the booking is refused.
- [ ] Two simultaneous bookings of the same slot: one succeeds, the other gets the friendly message (integration test).
- [ ] The new block appears on the calendar immediately.
- [ ] Audit row written; the appointment's `source` is `staff`.

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

---

### E01-T07 · Calendar: week view

- **Role:** builder · **Risk:** low · **Depends on:** E01-T04
- **Read:** `scope` (Calendar) · `design-ref` (demo lines 284–314; logic 1835–1845)

**Do.** Week view with one lane per visible provider inside each day, appointment counts and
no-show counts in the day header; clicking a day or block opens that day (and the drawer).
Day / Week toggle.

**Acceptance.**
- [ ] The seeded week renders; counts are correct; lanes follow the provider filter.
- [ ] Clicking a block opens the day view with that appointment's drawer.
- [ ] Week boundaries follow the clinic's locale (Monday start where applicable).

---

### E01-T08 · Settings: clinic details, opening hours, closed days

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T01a, E01-T01b, E00-T04a … E00-T04d
- **Read:** `scope` (Settings) · `design-ref` (demo lines 746–778; logic 1912–1919) · `data-model` (`clinics`, `clinic_hours`, `closed_days`)

**Do.**
- Settings screen with tabs. This task: **Clinic** (name, phone, address, email, time zone,
  language, currency, phone country) and **Opening hours** (per weekday, closed toggle) with
  **Closed days** (date + label).
- A typed, validated accessor for clinic settings (the only way settings are read).
- Only `settings.manage` may change anything.

**Out of scope.** Staff tab (E04), Channels tab (E03), quiet hours UI (E03).

**Acceptance.**
- [ ] Changes are saved, validated (a real IANA time zone, closing after opening) and audited.
- [ ] Front desk and dentist cannot open Settings (server refuses, not just hidden).
- [ ] Changing the time zone changes how the calendar shows existing appointments (they keep their real moment).
- [ ] Closed days and non-opening days show on the calendar.

---

### E01-T09 · Settings: providers and treatment types

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T08
- **Read:** `scope` (Settings) · `data-model` (`providers`, `provider_breaks`, `treatment_types`)

**Do.**
- Providers: add, edit (name, short name, kind, chair label, colour), weekly breaks,
  deactivate (never delete: past appointments keep their provider), order.
- Treatment types: add, edit (name, default length, optional price, "needs aftercare"),
  deactivate.

**Acceptance.**
- [ ] A new provider appears as a calendar column; a deactivated one disappears from new
      bookings but past appointments still show.
- [ ] A deactivated treatment type is not offered for new bookings.
- [ ] Breaks appear hatched on the calendar.
- [ ] All changes audited; restricted to `settings.manage`.

---

### E01-T10 · Today screen, first version

- **Role:** builder · **Risk:** normal · **Depends on:** E01-T06
- **Read:** `scope` (Today) · `design-ref` (demo lines 62–137; logic 1783–1792)

**Why.** The landing page: what does today look like?

**Do.**
- Greeting by role and time of day, date, buttons (Open calendar, New appointment).
- Today's appointments list: time, patient, treatment, provider, status pill; counts in the
  header. A dentist sees their own patients. Clicking a row opens the appointment drawer.
- A layout slot for the right-hand panels that later epics add. **No fake panels.**

**Out of scope.** Results panel, needs a call, aftercare, due for a visit (later epics).

**Acceptance.**
- [ ] The list matches the calendar for the same day and role.
- [ ] Counts are correct for the seeded day.
- [ ] No invented numbers or placeholder panels are shown.

---

### E01-T11 · Journey J2 and a hard look at scheduling

- **Role:** tester · **Risk:** normal · **Depends on:** E01-T02 … E01-T10
- **Read:** `test-strategy` (End-to-end journeys; Tenant isolation; Permissions) · all E01 handoff notes

**Do.**
- Playwright journey **J2** (front-desk day).
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

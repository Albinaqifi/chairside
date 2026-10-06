# E02 · Reminder loop (milestone M2)

**Outcome:** the core promise works end to end with a fake channel. Book an appointment →
a reminder is planned and "sent" → the patient opens the link on a phone → confirms, cancels
or asks for another time → the calendar and Today show it.

**Why now:** this is the product's reason to exist and its riskiest logic (timing, duplicates,
links). Building it before real providers means it is fully tested with a controllable clock
and no cost.

Most tasks here are **critical**. Read `docs/architecture/messaging.md` before any of them.

Order: T01 → (T02, T03, T04, T05, T08 parallel-safe) → T06 → T07 → T09 → (T10, T11, T12) → T13 → T14.

---

### E02-T01 · Schema: rules, templates, messages, links, consents, tasks

- **Role:** builder · **Risk:** critical · **Depends on:** E01-T01a, E01-T01b
- **Read:** `data-model` (section 3) · `messaging` (Idempotency keys; Message states) · D-023, D-036, D-038, D-091

**Do.**
- Migrations for `automation_rules`, `message_templates`, `messages`, `message_events`,
  `patient_links`, `consents`, `tasks` as in `data-model.md`, with policies and composite keys;
  and `appointments.source_message_id` with its foreign key `(clinic_id, source_message_id)`,
  which waited for `messages` (D-091).
- `UNIQUE (clinic_id, idempotency_key)` on `messages`; index on `(status, scheduled_for)`;
  unique `token_hash` on `patient_links`.
- Grants: the app role may insert into `consents` and `message_events` but not update or delete them.
- **The meta-test checks the composite keys** (E01-T01a critical review, `data`): a case in
  `tests/integration/tenant-tables.test.ts` reads `pg_constraint` and fails for a foreign key from
  one tenant table to another that does not hold `clinic_id` on both sides (`clinics` and the
  global tables left out). A foreign key check bypasses Row-Level Security, so a single-column key
  takes another clinic's id. Its rule is shown failing on a bad key, as the meta-test's other rules
  are; `CLAUDE.md` ("How to add a table", step 4) says what it now checks.
- Default rules and default templates (English) created for every clinic: by the seed and by
  `clinic:create`. Triggers in this epic: `booking_confirmation`, `appointment_reminder`.
  Default channel order `[whatsapp, email]` (D-055); WhatsApp templates carry an empty
  provider name and `approval_status = pending` until E03 registers them.
  Wording from `scope-v1.md` ("Messages").
- Seed: some past messages in different statuses for the demo clinic.

**Out of scope.** `webhook_events` (E03). Any logic.

**Acceptance.**
- [ ] Meta-test and isolation tests pass.
- [ ] The meta-test fails for a foreign key between two tenant tables without `clinic_id` on both
      sides, and passes for every table there is (tests).
- [ ] Inserting two messages with the same key in one clinic fails; the same key in two clinics is fine.
- [ ] The app role cannot update or delete `consents` or `message_events` (test).
- [ ] A newly created clinic has its default rules and templates.
- [ ] `data-model.md` matches the migrations.

---

### E02-T02 · Send-time calculation (pure functions)

- **Role:** builder · **Risk:** critical · **Depends on:** E01-T01a
- **Read:** `messaging` (Working out the send time; Message classes) · `test-strategy` (Message timing) · D-029

**Why.** Every timing bug is silent. This logic must be pure, small and tested to exhaustion.

**Do.**
- `computeReminderTime(rule, appointment, clinicSettings, closedDays, now)` and
  `computeConfirmationTime(...)` → `{ sendAt }` or `{ skip: reason }`. No database, no system clock.
- Shared helpers: `isQuiet(moment, clinic)`, `previousAllowed(moment, clinic)`, `nextAllowed(moment, clinic)`.
- Table tests for every case listed in `test-strategy.md` ("Message timing") and property tests for its invariants.

**Out of scope.** Recall and no-show timing (E05). Reading or writing the database.

**Acceptance.**
- [ ] All listed cases are covered by named tests, including both EU daylight-saving dates and
      the "Monday 08:00 with a quiet Sunday" case.
- [ ] Property tests: never after the appointment start; never inside quiet hours; never on a closed day.
- [ ] Late booking returns `covered_by_confirmation`, a late send time, or `too_late` exactly as specified.
- [ ] The suite passes under `TZ=UTC` and `TZ=Pacific/Auckland`.
- [ ] The functions import nothing from the database, Next.js or the clock.

---

### E02-T03 · Template rendering

- **Role:** builder · **Risk:** normal · **Depends on:** E02-T01
- **Read:** `messaging` (Templates; Channel order and fallback; WhatsApp specifics) · D-038, D-055

**Do.**
- `validateTemplate(body, trigger)` → ok or the list of unknown variables.
- `renderTemplate(template, values, locale, timeZone)` → text, or a failure naming the missing value. Fails closed.
- Rendering is channel-aware: for email the full text (and subject); for WhatsApp the local
  copy of the approved template **plus** the ordered list of variable values the provider
  needs. SMS-specific pieces (part counting, Latin conversion) belong to E03-T10, not here.
- Date and time formatting through the clinic's locale and time zone.

**Acceptance.**
- [ ] Unknown variable → validation error. Missing value → render failure, never a string containing `{`.
- [ ] WhatsApp rendering returns the variable values in the template's order and the matching local text; a template with a missing variable mapping fails closed.
- [ ] Property test: valid template + complete values never leaves a brace in the output.
- [ ] Dates render in the clinic's locale and zone, not the server's.

---

### E02-T04 · Channel adapter interface, fake adapter, outbox viewer

- **Role:** builder · **Risk:** normal · **Depends on:** E02-T01
- **Read:** `messaging` (Channels and adapters) · `overview` (Environments) · D-010

**Do.**
- The adapter interface (`send`, `parseWebhook`) with typed temporary / permanent errors.
- Fake adapter: records what it "sent"; can be configured per test to succeed, fail
  temporarily, fail permanently, or time out; can emit a later "delivered" event.
- A non-production page `/dev/outbox` listing fake-sent messages with their rendered text and
  a clickable link, so a person can play the patient.

**Acceptance.**
- [ ] Each configured outcome produces the matching result type.
- [ ] `/dev/outbox` shows sent messages and is unreachable in production (test).
- [ ] The adapter registry refuses to hand out a real provider adapter when none is configured.

---

### E02-T05 · May we message this patient? Consent, objections, contact checks

- **Role:** builder · **Risk:** critical · **Depends on:** E02-T01
- **Read:** `messaging` (Message classes; dispatcher re-checks) · `security` (Part 1, section 5) · `scope` (Patients: Communication) · D-040

**Do.**
- Pure function `messagingDecision(patient, consents, class, channel)` → allowed, or the reason not.
- `patients.recordConsent(...)`: appends a row with purpose, channel, allowed, source. Never updates.
- Patient profile "Communication" section: the three switches and "do not WhatsApp / do not email" (per channel, generic so SMS slots in later),
  each change stored with source `staff` and shown with date and source.
- Marking a patient archived or deceased cancels their pending messages.

**Acceptance.**
- [ ] Table-driven test over class × channel × consent history × patient status × contact validity.
- [ ] Marketing is refused without a recorded yes; refused again after a later no.
- [ ] Transactional messages are refused after the patient objected for that channel.
- [ ] Switching a setting adds a row and the history is visible; nothing is overwritten.
- [ ] A deceased or archived patient is refused for every class.

---

### E02-T06 · Planner: reminders are planned, re-planned and cancelled

- **Role:** builder · **Risk:** critical · **Depends on:** E02-T02, E02-T05, E01-T06
- **Read:** `messaging` (Two stages; What triggers planning; Idempotency keys; reminder section) · `overview` (tenant isolation, worker)

**Do.**
- `messaging.planForAppointment(appointmentId, now)`: for each enabled rule and channel,
  compute the time, insert the row with its key ("do nothing on conflict"), or record a skip.
- React to the E01 event hooks: booked, moved, cancelled, restored, completed, no-show.
  The planning job is enqueued **in the same transaction** as the change.
  Moved or cancelled → pending messages for the old time are cancelled.
- Worker: a repeating job every 5 minutes that plans for every clinic (inside each clinic's
  tenant context) for appointments in the planning window.
- Channel choice per D-055: one row for the first usable channel in the rule's order (enabled, contact present and valid, not refused, `whatsapp_status` not `unavailable`); `unreachable` skip plus task when none fits.

**Out of scope.** Sending. Recall and no-show triggers.

**Acceptance.**
- [ ] Booking an appointment creates exactly the expected pending rows with correct times.
- [ ] Running the planner twice, and twice in parallel, leaves the row count unchanged.
- [ ] Moving an appointment: old reminder `cancelled`, one new reminder with the new time.
- [ ] Cancelling: pending messages cancelled. Restoring: planned again.
- [ ] If the change transaction rolls back, no job and no message exists.
- [ ] With the event hook disabled (simulating a missed event), the 5-minute tick still plans the reminder.
- [ ] A skip is recorded with its reason and is queryable.
- [ ] The planner for clinic A never reads or writes clinic B's rows (isolation test).

---

### E02-T07 · Dispatcher: send what is due, safely

- **Role:** builder · **Risk:** critical · **Depends on:** E02-T03, E02-T04, E02-T06, E02-T08
- **Read:** `messaging` (The dispatcher; Retries; Message states; Caps and switches)

**Do.**
- Pure message state machine with tests.
- Worker job every minute: claim due rows with `SKIP LOCKED`, re-check everything in the
  list in `messaging.md`, render, create the patient link, send through the adapter, record events.
- Retry with backoff for temporary errors; `failed` for permanent ones and after 5 attempts;
  recovery of rows stuck in `sending`.
- Channel fallback (D-055): a permanent "unreachable on this channel" result creates a row for
  the next channel in the rule's order (same base key, other channel); the original row ends `failed` with the reason.
- Global kill switch `MESSAGING_ENABLED`; clinic `paused` status respected.
- `failed` creates a `failed_message` task.
- End-to-end tests can set the worker's "now" through the test clock control of E00-T06b, with the
  same guard (never on staging or production), so journey J3 (E02-T14) can move time forward
  (D-075).

**Out of scope.** Daily/monthly caps, allow-list, webhooks (E03). Frequency cap (E05).

**Acceptance.**
- [ ] A due message is sent once and ends as `sent` with an event trail.
- [ ] Two dispatchers running at once never send the same row twice (integration test).
- [ ] Each re-check has a test: cancelled appointment, moved appointment, objection recorded
      after planning, invalid contact, quiet hours, patient archived, render failure.
      Each ends `skipped` with the right reason (or rescheduled for quiet hours).
- [ ] Temporary failure: delays 1, 5, 30, 120 minutes, then `failed`. Permanent failure: `failed` at once.
- [ ] A reminder is never retried after the appointment start.
- [ ] Permanent `not_on_whatsapp` from the fake adapter produces exactly one email row for the same reminder and no second WhatsApp row.
- [ ] With the kill switch off, nothing is claimed and nothing is lost.
- [ ] Invalid state transitions are rejected by the state machine (all pairs tested).
- [ ] The worker's test clock cannot be enabled on staging or production (test).

---

### E02-T08 · Patient link tokens

- **Role:** builder · **Risk:** critical · **Depends on:** E02-T01
- **Read:** `security` (Part 1, section 3) · `data-model` (`patient_links`) · D-025 · Q-03 (use a configurable base URL)

**Do.**
- `links.create(patient, purpose, appointment?, expiresAt)` → the URL (token returned once, only the hash stored).
- `links.resolve(token, now)` → the link and its clinic, or one indistinguishable "invalid".
  The cross-clinic lookup by hash is one small, reviewed database function.
- Expiry, revocation, `first_opened_at` (set by a deliberate "page viewed" call, not by resolve itself), rate limiting per IP and per token.
- A wrapper for patient-page actions (the counterpart of the staff action wrapper): resolve →
  tenant context → handler → audit row with actor `patient_link`.

**Acceptance.**
- [ ] Tokens have at least 128 bits of randomness; the database contains only hashes.
- [ ] Expired, revoked, unknown and malformed tokens give the same result and the same response time class.
- [ ] A token for patient A can never load or change anything of patient B or another clinic.
- [ ] Rate limit triggers after the configured number of attempts.
- [ ] The token never appears in logs or audit metadata (marker test).

---

### E02-T09 · Patient appointment page: confirm and cancel

- **Role:** builder · **Risk:** critical · **Depends on:** E02-T08, E01-T06
- **Read:** `scope` (Patient pages) · `design-ref` (demo lines 1076–1093, 1112–1133; logic 1921–1932) · `security` (section 3) · Q-14

**Do.**
- Public route `/p/<token>`, server-rendered, phone-first, no staff layout, no third-party
  requests, `noindex`, strict referrer policy.
- Shows clinic header, first name, date and time, provider. **No treatment name.**
- Buttons POST: "Yes, I'll be there" → confirmed; "I can't come" → confirm step with optional
  reason → cancelled. After the clinic's cut-off: "please call us" with the phone number.
- Result pages; states for already confirmed, already cancelled, appointment in the past.
- Invalid / expired page with the clinic-neutral wording and no data.
- Cancelling creates a `patient_cancelled` attention item (task type added here) and triggers re-planning.

**Out of scope.** "Ask for another time" (T10). Treatment plan link (v1.1).

**Acceptance.**
- [ ] GET of any patient page changes nothing in the database (asserted).
- [ ] Confirm twice → one confirmation, same result page.
- [ ] Cancel before the cut-off works; after it is refused with the "call us" page.
- [ ] The calendar shows the new status within its refresh interval.
- [ ] The page makes no third-party request and sets no staff cookie.
- [ ] Works at 320 px width; passes the automated accessibility check.
- [ ] Audit rows show actor "patient via link".

---

### E02-T10 · "Ask for another time" and the tasks module

- **Role:** builder · **Risk:** normal · **Depends on:** E02-T09
- **Read:** `scope` (Patient pages) · `design-ref` (demo lines 1094–1111 for the visual style only) · `data-model` (`tasks`) · D-024, D-035

**Do.**
- `tasks` module: create, list open by type, mark done / dismissed.
- Patient page "Ask for another time": preferred days (chips), time of day (morning,
  afternoon, evening), optional short note (length-limited, plain text). Submitting creates a
  `change_request` task. The appointment stays as it is; the page says the clinic will call.
- One open request per appointment; submitting again updates it.

**Acceptance.**
- [ ] A request creates exactly one open task linked to the appointment and patient.
- [ ] The appointment's time and status are unchanged.
- [ ] The note is stored as plain text and shown escaped.
- [ ] Marking the task done records who and when.

---

### E02-T11 · Booking confirmation message

- **Role:** builder · **Risk:** normal · **Depends on:** E02-T07
- **Read:** `messaging` (Booking confirmation; reminder step 3) · `scope` (New appointment drawer) · D-045

**Do.**
- Tick box "Text the patient a booking confirmation now" in the new-appointment drawer (default on when the rule is enabled).
- Planning the confirmation; the reminder is skipped as `covered_by_confirmation` when the booking is already inside the reminder window.

**Acceptance.**
- [ ] Ticked: one confirmation is planned and sent; unticked: none.
- [ ] Booking tomorrow morning at 19:00 today: confirmation sent, reminder skipped with the right reason.
- [ ] Booking next week: confirmation now, reminder at its normal time.

---

### E02-T12 · Messages on the staff side

- **Role:** builder · **Risk:** normal · **Depends on:** E02-T07
- **Read:** `scope` (Appointment drawer; Patients: Messages) · `design-ref` (demo lines 1217–1222, 403–411; logic 1945–1951)

**Do.**
- Appointment drawer: "Messages for this visit" timeline from real rows and events (planned,
  sent, delivered, link opened, confirmed via link, skipped with reason, failed).
- Patient profile: Messages section with **upcoming** and past messages.
- "No reply yet" derived status on calendar blocks, Today rows and the drawer pill (booked + reminder sent).

**Acceptance.**
- [ ] The timeline for seeded and newly created messages is correct and in order.
- [ ] A skipped or failed message is visible with a human-readable reason.
- [ ] "No reply yet" appears only when a reminder was actually sent and the status is still booked.
- [ ] Message text shown to staff comes from the stored snapshot.

---

### E02-T13 · Today: "Needs a call" and "Needs attention"

- **Role:** builder · **Risk:** normal · **Depends on:** E02-T10, E02-T12
- **Read:** `scope` (Today) · `design-ref` (demo lines 156–167; logic 1793) · D-035

**Do.**
- "Needs a call": today's and tomorrow's appointments with a sent reminder and no reply;
  "Mark called" creates/completes a `call_unconfirmed` task.
- "Needs attention" (new panel, same visual language): open tasks by type: patient
  cancellations, change requests, failed messages, invalid contacts. Each row links to the
  patient or appointment and can be marked done.
- Sidebar count badge for open attention items.

**Acceptance.**
- [ ] Each item type appears when its cause happens and disappears when resolved.
- [ ] A dentist sees items for their own patients; front desk and owner see all.
- [ ] Empty states read well ("Nothing needs attention").

---

### E02-T14 · Journeys J3 and J4, and trying to break messaging

- **Role:** tester · **Risk:** critical · **Depends on:** E02-T06 … E02-T13
- **Read:** `test-strategy` (all critical areas; End-to-end journeys) · `messaging` · all E02 handoff notes

**Do.**
- Playwright **J3** (the core loop, with the controllable clock) and **J4** (change request).
- Go through every "must be covered" list in `test-strategy.md` for timing, duplicates,
  links and consent; add missing tests.
- Adversarial session: kill the worker mid-send; run planner and dispatcher concurrently
  under load; move an appointment while its reminder is `sending`; change the clinic time
  zone with pending messages; open links from two devices at once.
- Write the findings; critical findings block the milestone.

**Acceptance.**
- [ ] J3 and J4 pass in CI.
- [ ] A coverage note maps each bullet in the strategy's critical lists to a test name.
- [ ] No duplicate send and no silent drop was produced in the adversarial session, or each one found is fixed and has a test.

**Milestone check (M2):** on staging, book an appointment for tomorrow, watch the reminder
appear in `/dev/outbox`, open the link on your phone, confirm, see it on the calendar.
This is the first demo worth showing a clinic.

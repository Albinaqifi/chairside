# E05 · Recalls and follow-ups (milestone M5)

**Outcome:** overdue patients are brought back by themselves, following each patient's care
plan. Staff control the rules and see who is due. The first real results numbers appear.

**Why now:** this is the second half of the value ("more patients come back"). It reuses the
whole message engine from E02 and only adds new triggers.

Detail level: **Planned**. T00 refines the rest.

---

### E05-T00 · Refine this epic
- **Role:** architect · **Risk:** low · **Depends on:** E02 done
- **Read:** this file · `messaging` · `scope` (Automations; Today) · E02 handoff notes · Q-06

**Do.** Refine tasks against the built planner. The owner has deferred the legal review (D-052):
build on the working assumption that recalls are care communication with an opt-out. Move tasks to Ready.

**Acceptance.** - [ ] Tasks pass the Definition of Ready. - [ ] The Q-06 assumption is named in every task it affects.

---

### E05-T01 · Schema: care plans
- **Role:** builder · **Risk:** critical · **Depends on:** E01-T01a
- **Read:** `data-model` (section 5) · D-031 · demo lines 1406–1412

**Do.** Migrations for `care_plans`, `care_plan_treatment_types`, `patient_care_plans`.
Default plans created per clinic (seed and `clinic:create`): Standard checkup (6 months,
default), Gum care (3 months), Children (4 months). Every new patient gets the default plan.
Seed: patients spread over plans, some overdue.

**Acceptance.** - [ ] Meta-test and isolation pass. - [ ] Exactly one default plan per clinic is enforced by the database. - [ ] `data-model.md` matches.

---

### E05-T02 · Due dates and recall eligibility (pure functions)
- **Role:** builder · **Risk:** critical · **Depends on:** E05-T01
- **Read:** `messaging` (Recall) · `test-strategy` (Message timing) · `overview` (Time)

**Do.** `nextDueOn(lastVisitOn, plan)` with end-of-month clamping; `computeRecallTimes(...)`
(step 1 and the nudge, quiet adjustment later); `recallEligibility(patient, plan, futureAppointments, consents)` → eligible or the reason not.

**Acceptance.**
- [ ] Table tests incl. 31 Aug + 6 months, 29 Feb, weeks and days units.
- [ ] Property test: next due is always after the last visit.
- [ ] Not eligible when: future appointment exists, plan paused or inactive, patient not active, opted out.

---

### E05-T03 · Care plans screen and the profile card
- **Role:** builder · **Risk:** normal · **Depends on:** E05-T01
- **Read:** `scope` (Automations; Patients) · `design-ref` (demo lines 530–569, 419–424; logic 1995–2003, 1697–1702)

**Do.** Automations → Care plans: list with patient counts, editor (name, interval, lead
time, second nudge, which treatment types reset the clock), "+ New care plan". Patient
profile: care plan card with selector, due status and reminder summary. Patients list:
care plan column and the "Due for a visit" filter.

**Acceptance.**
- [ ] Changing a patient's plan recalculates the due date and re-plans recalls.
- [ ] Changing a plan's interval recalculates due dates for its patients (in a job, not in the request).
- [ ] Only `automations.manage` can edit plans; anyone with `patients.manage` can change a patient's plan.

---

### E05-T04 · Planner: recalls, the nudge, frequency cap and priority
- **Role:** builder · **Risk:** critical · **Depends on:** E05-T02, E02-T07
- **Read:** `messaging` (Recall; Frequency cap and priority; Idempotency keys) · D-039

**Do.** Recall trigger in the 5-minute planner. Completing an appointment whose treatment
type resets a plan updates `last_visit_on` and `next_due_on`. Booking a future appointment
cancels pending recalls. The second nudge. The frequency cap and priority order in the
dispatcher (postpone, never drop). Default recall rule and template (generic wording, opt-out link).

**Acceptance.**
- [ ] A patient becoming due gets exactly one step-1 message; the nudge follows only if still not booked.
- [ ] Booking before the send time cancels the recall.
- [ ] Two non-transactional messages inside the cap window: the higher priority is sent, the other postponed and later sent.
- [ ] Planner idempotency holds for recalls (run twice, in parallel).
- [ ] Paused care plans produce no messages.

---

### E05-T05 · Recall start gate and batch release
- **Role:** builder · **Risk:** critical · **Depends on:** E05-T04, E04-T08
- **Read:** `messaging` (Caps and switches) · `scope` (Import) · D-030

**Why.** Without this, an import of a thousand patients sends hundreds of recalls at once.

**Do.** Imported patients' care plans start `recall_paused`. A "Release recalls" screen (from
the import's final step and from Automations): how many are overdue, a message count and cost
estimate per channel, release in batches (N per day, oldest due first), stop at any time.

**Acceptance.**
- [ ] Immediately after an import, zero recalls are planned.
- [ ] Releasing a batch of 50 plans at most 50 patients' recalls that day; the daily cap still applies.
- [ ] "Stop" prevents further batches; already sent messages are unaffected.

---

### E05-T06 · Patient page "Ask for a visit" and booking attribution
- **Role:** builder · **Risk:** normal · **Depends on:** E05-T04, E02-T10
- **Read:** `scope` (Patient pages) · D-024, D-034

**Do.** Link purpose `visit_request`: the recall link opens a page reusing the "ask for
another time" form; creates a `visit_request` task. When staff book from that task, the
appointment gets `source = recall_link` and `source_message_id`. Also attribute a booking
made by staff within 14 days of a recall message for that patient.

**Acceptance.**
- [ ] A request from the recall link appears in Needs attention; booking from it sets the source fields.
- [ ] The attribution rule is one tested pure function with its definition written in `scope-v1.md`.

---

### E05-T07 · Missed-visit follow-up
- **Role:** builder · **Risk:** normal · **Depends on:** E05-T04
- **Read:** `messaging` (No-show follow-up) · `scope` (Automations)

**Do.** Marking no-show plans the follow-up after the rule's delay, with the visit-request
link. Cancelled when the patient gets a new appointment. Default rule and template.

**Acceptance.** - [ ] No-show → one follow-up at the right time. - [ ] Undoing the no-show or rebooking first cancels it. - [ ] Subject to cap and opt-out.

---

### E05-T08 · Automations screen: rule list and editor
- **Role:** builder · **Risk:** normal · **Depends on:** E05-T04, E05-T07, E02-T03
- **Read:** `scope` (Automations) · `design-ref` (demo lines 447–529; logic 1882–1897; rule texts 1574–1599)

**Do.** Rule cards (name, timing summary, channel, on/off, results from real counts). Editor:
timing (value + unit, time of day for day offsets), channel order (D-055), message text per
channel (email editable; WhatsApp shown read-only with its approval status), variable
buttons, live preview with sample data, save (creates a new template version). Rules: booking confirmation, reminder, care plan
reminders, missed visit, aftercare (links to the library; active after E06).

**Acceptance.**
- [ ] Saving an unknown variable, a send time inside quiet hours, or a follow-up text without the opt-out link is refused with a clear reason.
- [ ] Switching a rule off cancels its pending messages; switching on plans them again.
- [ ] Edited text applies to messages planned from now on; already sent snapshots are unchanged.
- [ ] Only `automations.manage` can edit; all changes audited.

---

### E05-T09 · Today: "Due for a visit" and the manual nudge
- **Role:** builder · **Risk:** normal · **Depends on:** E05-T04
- **Read:** `scope` (Today) · `design-ref` (demo lines 188–198; logic 1794–1796)

**Do.** Panel listing patients whose recalls did not lead to a booking (messages sent, no
appointment), with what happened so far. "Nudge" sends a personal recall through the
pipeline (key `manual:…`; counts toward the cap; respects opt-out). "Call" for patients
without a mobile adds a call task.

**Acceptance.** - [ ] The list matches the data. - [ ] A nudge cannot be sent twice within the cap window. - [ ] Opted-out patients show "Call" only.

---

### E05-T10 · Results panel: measured numbers
- **Role:** builder · **Risk:** normal · **Depends on:** E05-T06
- **Read:** `scope` (Today) · `design-ref` (demo lines 77–115) · D-034

**Do.** `reporting` module with written definitions for: confirmation rate, no-show rate per
month since go-live, recalls sent and recalls that became bookings. Owner-only panel on Today
in the demo's visual style, without money and without "prevented" claims. Each number has an
info text stating its definition.

**Acceptance.**
- [ ] Each number is one tested query whose definition is written next to it in `scope-v1.md`.
- [ ] With too little data the panel says so instead of showing misleading percentages.
- [ ] Not visible to dentists or front desk (server-side).

---

### E05-T11 · Journey J7 and recall edge cases
- **Role:** tester · **Risk:** critical · **Depends on:** E05-T03 … E05-T10
- **Read:** `test-strategy` · `messaging`

**Do.** Playwright J7. Adversarial checks: plan changes with pending recalls; an import
followed by releases; cap interplay between recall, follow-up and nudge; time-zone change.

**Acceptance.** - [ ] J7 passes in CI. - [ ] No path produces a recall for a paused, opted-out, archived or already-booked patient.

**Milestone check (M5):** on staging, a seeded overdue patient receives a recall, asks for a visit, gets booked, and the results panel counts it.

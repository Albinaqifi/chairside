# E07 · Pilot readiness (milestone M7)

**Outcome:** the go-live gate in `docs/architecture/security-privacy.md` (Part 2) passes, and
a real clinic can start with real patients.

**Why last, and never cut:** these are the things that only matter once data is real: proof
that backups restore, that failures alert someone, that data is kept and deleted by the rules.

Detail level: **Planned**. T00 refines the rest.

---

### E07-T00 · Refine this epic
- **Role:** architect · **Risk:** low · **Depends on:** E03, E04, E05 done
- **Read:** this file · `security` (all) · `docs/log/risks.md` · `docs/progress/discovered.md`

**Do.** Refine tasks; walk the risk list and the Discovered list and turn anything unresolved
into tasks here; re-check every decision marked "revisit if". Move tasks to Ready.

**Acceptance.** - [ ] Tasks pass the Definition of Ready. - [ ] Every open risk has a mitigation in place or a task.

---

### E07-T01 · Audit log viewer and coverage check
- **Role:** builder · **Risk:** normal · **Depends on:** E00-T03
- **Read:** `security` (Part 1, section 10) · `data-model` (`audit_log`)

**Do.** Owner-only screen: filter by patient, staff member, action, date; answers "who looked
at this patient?". A test that walks the list of auditable actions in `security-privacy.md`
and asserts each writes a row.

**Acceptance.** - [ ] The coverage test passes for every listed action. - [ ] The viewer shows no personal values beyond names needed to identify actor and patient. - [ ] Viewing the audit log is itself audited.

---

### E07-T02 · Backups and a real restore drill
- **Role:** owner + builder · **Risk:** critical · **Depends on:** E00-T07
- **Read:** runbook · D-007

**Do.** Confirm backup schedule and point-in-time recovery with the host. Perform one restore
of staging to a point in time into a separate database, verify it, time it, write the steps
into the runbook.

**Acceptance.** - [ ] Restore performed and verified; duration recorded. - [ ] Runbook steps are complete enough to follow under stress.

---

### E07-T03 · Canary, alerts and operator numbers
- **Role:** builder · **Risk:** critical · **Depends on:** E02-T07, E03-T05
- **Read:** `messaging` (Production checks) · `overview` (Things that keep it running) · D-013,
  D-075, D-102

**Do.** Nightly canary job per clinic: every appointment tomorrow has a pending reminder or a
recorded reason; otherwise alert the operator. Alerts for: failure-rate spike, cap reached,
worker heartbeat missing, stuck `sending` rows. A minimal operator page or script: planned,
sent, failed, skipped per clinic per day (counts only, no personal data). Next.js's "Failed to
find Server Action" error, which any client can cause (E00-T08 tester note 5; D-075), is never an
alert on its own.

**Sentry** (EU, D-013), moved here from E00-T07 (owner, 2026-10-10: not now, D-102); until then
errors are in the host's logs only. Wired in the web and the worker, inactive without its key.
Before anything is sent it removes the logger's personal fields, request headers and cookies
(Next.js hands a request's headers, the session cookie among them, to its error hook, D-075) and
query strings. "Failed to find Server Action" and `The destination stream closed early` (a browser
that left a page early, E01-T02b test) are not sent: anyone can cause either. A library, a service
and its key: the owner's again when E07-T00 refines this task.

**Acceptance.** - [ ] Deleting a planned reminder in a test makes the canary alert. - [ ] Stopping the worker triggers the heartbeat alert. - [ ] Alerts contain ids and counts only. - [ ] A deliberate test error reaches Sentry with no personal field, header or cookie in it; a multipart POST that names no action adds no event.

---

### E07-T04 · Retention jobs
- **Role:** builder · **Risk:** critical · **Depends on:** E03-T04, E04-T08
- **Read:** `data-model` (Retention) · `security` (Part 1, section 11)

**Do.** Scheduled jobs that enforce the retention table. Each run logs what it removed
(counts) to the audit log. Periods come from one configuration place.

**Acceptance.** - [ ] Each rule has a test with the clock moved forward. - [ ] Jobs never touch rows younger than the period. - [ ] A dry-run mode reports what would be removed.

---

### E07-T05 · Patient export and anonymise
- **Role:** builder · **Risk:** critical · **Depends on:** E05, E06 (or the cut line)
- **Read:** `security` (Part 1, section 11) · `data-model` · Q-06

**Do.** "Export everything about this patient" (a structured file, `export.run` permission,
audited). "Anonymise patient": removes name and contact details, cancels pending messages,
revokes links, keeps history rows; requires an owner and a typed confirmation.

**Acceptance.** - [ ] The export contains every row that references the patient (a test enumerates tables with `patient_id`). - [ ] After anonymising, a search for the old name or phone finds nothing, in any table. - [ ] Anonymising cannot be triggered by a non-owner.

---

### E07-T06 · Security review pass
- **Role:** reviewer · **Risk:** critical · **Depends on:** all feature epics
- **Read:** `security` (all) · `overview`

**Do.** A structured review of the whole codebase against `security-privacy.md` Part 1,
section by section: tenant wrappers used everywhere, permission on every action, link
handling, headers, CSRF, rate limits, upload handling, dependency audit, secrets. Written
findings ranked by severity; fixes become tasks.

**Acceptance.** - [ ] A findings report exists. - [ ] Every high-severity finding is fixed and re-checked, or accepted in writing by the owner.

---

### E07-T07 · No personal data leaves through logs
- **Role:** tester · **Risk:** critical · **Depends on:** all feature epics
- **Read:** `test-strategy` (Logging) · `security` (Part 1, section 6)

**Do.** Run all end-to-end journeys with marker values in every personal field while
capturing logs, error-tracker payloads and job payloads; assert no marker appears. Make it a
permanent CI job.

**Acceptance.** - [ ] The check is green and part of CI. - [ ] Job payloads contain ids only.

---

### E07-T08 · Size check
- **Role:** tester · **Risk:** normal · **Depends on:** all feature epics
- **Read:** `overview`

**Do.** Generate a clinic with 20,000 patients, a year of appointments and messages. Measure:
patient search, calendar day load, a planner tick, a dispatcher tick, Today. Report; propose
indexes where needed.

**Acceptance.** - [ ] Search and calendar under 300 ms at the server; a planner tick for one clinic under 10 seconds. - [ ] Slow queries found are fixed or listed with a plan.

---

### E07-T09 · Production environment and the go-live gate
- **Role:** owner + builder · **Risk:** critical · **Depends on:** E07-T01 … E07-T08, E07-T10
- **Read:** `security` (Part 2) · runbook · Q-03, Q-07

**Do.** Create production (separate database, secrets, domain, monitoring; Next.js telemetry off,
D-075). Rehearse
migrations. Finish the runbook (messages stopped, database down, suspected breach, restoring,
onboarding a clinic). Walk the gate checklist line by line with evidence.

**Acceptance.** - [ ] Every box in the gate is ticked with a link to its evidence. - [ ] The owner has signed off in writing in the handoff note. - [ ] Staging and production share no credentials.

---

### E07-T10 · Legal pack
- **Role:** owner · **Risk:** critical · **Depends on:** Q-06
- **Owner note, 2026-10-02:** deferred (D-052). This task blocks no build work. The owner decides at go-live whether and how to do it.
- **Read:** `security` (Part 2, legal list)

**Do.** With a lawyer: data processing agreement, sub-processor list, record of processing,
impact-assessment template, terms of service, breach procedure. Record the answers to Q-06
and adjust default templates and settings accordingly (as tasks).

**Acceptance.** - [ ] Documents exist and are stored outside this repository; their existence is noted here. - [ ] Q-06 answered; resulting changes are tasks on the board.

**Milestone check (M7 = version 1.0):** the gate is signed; the first clinic is created in production with `clinic:create`.

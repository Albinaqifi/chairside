# E04 · Clinic onboarding (milestone M4)

**Outcome:** a new clinic can be brought in within a day: staff invited with the right roles
and 2FA, and a messy spreadsheet turned into clean patient records with review and undo.

**Why now:** the import is the clinic's first impression (risk R-10) and the only way to get
realistic data volumes. It depends only on M0 and M1, so it can run **in parallel** with E02/E03.

Detail level: **Planned**. T00 refines the rest.

---

### E04-T00 · Refine this epic
- **Role:** architect · **Risk:** low · **Depends on:** E01 done · **Needs:** Q-09 if a pilot clinic's export is available
- **Read:** this file · `scope` (Import; Settings) · E01 handoff notes

**Do.** Refine tasks against the built code. If a real export format is known (Q-09), get a
**synthetic** file in the same shape (same columns and quirks, invented values) and make it a
test fixture. **Add a task for future appointments** (D-050): since Chairside replaces the
clinic's old tool, appointments already booked there must be brought in at switch-over,
either from a file or through a fast keying screen; imported appointments must not trigger
a burst of booking confirmations. Move tasks to Ready.

**Acceptance.** - [ ] Tasks pass the Definition of Ready. - [ ] No real file is in the repository. - [ ] A future-appointments task exists and is on the board.

---

### E04-T01 · Schema: invites and import staging
- **Role:** builder · **Risk:** critical · **Depends on:** E01-T01
- **Read:** `data-model` (sections 1 and 4) · D-008

**Do.** Migrations for `staff_invites`, `import_jobs`, `import_rows` with policies. A size
limit on `file_bytes` (10 MB).

**Acceptance.** - [ ] Meta-test and isolation tests pass. - [ ] `data-model.md` matches. - [ ] Oversized file is refused by the database as well as the app.

---

### E04-T02 · Staff: invite, roles, deactivate, password reset
- **Role:** builder · **Risk:** critical · **Depends on:** E04-T01, E00-T03
- **Read:** `scope` (Settings; Navigation and roles) · `design-ref` (demo lines 758–769) · `security` (Part 1, section 2) · D-021

**Do.** Settings → Staff & access: list, invite by email (role, extra permissions, optional
provider link), resend, revoke, change role, deactivate. Invite acceptance page (set a
password). Password reset by email. Emails go through the message pipeline's email channel
as system messages (fake adapter until E03). The last owner cannot be removed or demoted.

**Acceptance.**
- [ ] Invite links are single-use, expire, and only their hash is stored.
- [ ] An invited front-desk user sees exactly what the permission table allows (J6 covers this).
- [ ] Deactivating a user ends their sessions.
- [ ] The last owner cannot be removed. Role changes are audited.
- [ ] Reset and invite responses never reveal whether an email exists.

---

### E04-T03 · Two-factor authentication
- **Role:** builder · **Risk:** critical · **Depends on:** E04-T02
- **Read:** `security` (Part 1, section 2) · D-006

**Do.** Authenticator-app 2FA: enrol, verify at login, recovery codes. Mandatory for owners
and for anyone with `import` or `export`: they are led to enrolment at next login and cannot
use those permissions before. An owner can reset another member's 2FA (audited).

**Acceptance.**
- [ ] An owner without 2FA cannot reach anything but the enrolment page.
- [ ] Wrong codes are rate-limited; recovery codes work once.
- [ ] 2FA secrets and codes never appear in logs.

---

### E04-T04 · Import: upload and parse
- **Role:** builder · **Risk:** normal · **Depends on:** E04-T01, E00-T07 (worker)
- **Read:** `scope` (Import) · `design-ref` (demo lines 651–665) · `data-model` (section 4)

**Do.** Step 1: upload `.csv`, `.xlsx` (10 MB limit, type check). A worker job parses it into
`import_rows.raw`: handles UTF-8 and Windows-1250/1252, `;` and `,`, header detection,
empty rows. Shows a 20-row preview. Requires the `import.run` permission.

**Acceptance.**
- [ ] Fixtures in each encoding and delimiter parse to the same rows.
- [ ] A 20,000-row file parses without blocking the web process.
- [ ] A non-spreadsheet file is refused with a clear message.
- [ ] Nothing is written to `patients`.

---

### E04-T05 · Import: match columns
- **Role:** builder · **Risk:** normal · **Depends on:** E04-T04
- **Read:** `scope` (Import) · `design-ref` (demo lines 666–682; fields at logic 1600–1601)

**Do.** Step 2: each file column with an example value and a target field (auto-suggested
from the header, in the clinic's language and English), "Full name (split)", "Don't import".
The mapping is saved per clinic and pre-applied next time. A marketing-consent column can
only be mapped after ticking "we hold proof of this consent" (D12).

**Acceptance.**
- [ ] Common header variants ("Tel", "Mobile", "Telefon", "E-mail") are suggested correctly.
- [ ] Without the proof tick, the consent column cannot be mapped.
- [ ] A second import of the same layout arrives pre-mapped.

---

### E04-T06 · Import: clean, validate, find duplicates (pure logic)
- **Role:** builder · **Risk:** critical · **Depends on:** E04-T05
- **Read:** `data-model` (`patients`, `import_rows`) · D-033 · `test-strategy` (Import)

**Do.** Pure functions: normalise phone (E.164 with the clinic's country), parse dates with
an explicit format (detect ambiguity and report it), tidy names, split full names; validate
(name present; flag "no way to contact"); find duplicates inside the file and against
existing patients (name + date of birth, or name + same contact; **never phone alone**).
A worker job applies them and fills `normalized`, `problems`, `duplicate_of_*`.

**Acceptance.**
- [ ] Table tests for phones, dates (including `03/04/1990` flagged as ambiguous, and garbage like "last spring"), names.
- [ ] Siblings sharing a phone are not duplicates; the same person spelled slightly differently with the same birth date is a possible duplicate.
- [ ] Property test: normalising twice equals normalising once.

---

### E04-T07 · Import: review problems
- **Role:** builder · **Risk:** normal · **Depends on:** E04-T06
- **Read:** `scope` (Import) · `design-ref` (demo lines 683–716; logic 1903–1910)

**Do.** Step 3: counts (ready, duplicates, missing mobile, unreadable dates), duplicate pairs
with Merge / Keep both, the missing-mobile choice, the date-format question when ambiguous,
inline fixing of single values, a link back to mapping.

**Acceptance.**
- [ ] Counts always equal what the staging rows say.
- [ ] Every decision is stored on the row and survives leaving and returning to the wizard.

---

### E04-T08 · Import: confirm, commit, undo
- **Role:** builder · **Risk:** critical · **Depends on:** E04-T07
- **Read:** `scope` (Import) · `design-ref` (demo lines 717–745) · `data-model` (sections 2, 4) · D-030

**Do.** Step 4: a summary of exactly what will happen. Commit in the worker, in batches, each
in a transaction: create patients tagged with the import id, apply merges (rule: newest
non-empty contact wins, nothing is deleted), write consent rows with source `import` and the
column name, one audit row for the whole import. Clear `file_bytes`. "Undo import" for 7
days: removes patients created by it that have no appointments or messages; offers to archive
the rest. The final screen offers the recall release (wired in E05-T06); until then it says
recalls are paused for imported patients.

**Acceptance.**
- [ ] A commit interrupted halfway can be resumed and never creates a patient twice.
- [ ] After undo, the database equals its state before the import, except audit rows (asserted by comparison).
- [ ] No message of any kind is planned as a result of an import.
- [ ] Marketing consent is only written when the proof tick was set.

---

### E04-T09 · Fast manual entry
- **Role:** builder · **Risk:** low · **Depends on:** E04-T06
- **Read:** `scope` (Import)

**Do.** A keyboard-first form for typing in paper cards: tab through fields, save and start
the next with one key, using the same cleaning and duplicate checks.

**Acceptance.** - [ ] Ten patients can be entered without touching the mouse. - [ ] Duplicate warnings appear as in the patient form.

---

### E04-T10 · Journeys J5 and J6, and a messy-file bash
- **Role:** tester · **Risk:** normal · **Depends on:** E04-T02 … E04-T09
- **Read:** `test-strategy` (Import; End-to-end journeys)

**Do.** Playwright J5 (import) and J6 (invite + 2FA + role limits). Build three more nasty
synthetic fixture files and run them through. Findings in the handoff note.

**Acceptance.** - [ ] J5 and J6 pass in CI. - [ ] No fixture crashes the wizard; every problem row is explained to the user.

**Milestone check (M4):** import the synthetic clinic file on staging, invite yourself as front desk, log in with 2FA.

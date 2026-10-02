# E06 · Treatment plans and aftercare (milestone M6)

**Outcome:** when a visit is finished, the patient gets clear aftercare instructions: from the
clinic's approved template, or drafted by AI when no template exists, and always approved by
a person first.

**Why now:** it needs appointments, treatment types and the message engine, all of which
exist. It is the product's differentiator, and the one place AI touches patients, so it gets
its own evals and strict rules.

**Cut line:** this epic can ship after the first clinic goes live (see `roadmap.md`).

Detail level: **Planned**. T00 refines the rest.

---

### E06-T00 · Refine this epic
- **Role:** architect · **Risk:** low · **Depends on:** E02 done · **Needs:** Q-13
- **Read:** this file · `scope` (In the chair; Automations) · `security` (Part 1, section 4) · D-017, D-036, D-037, D-051

**Do.** Refine against the built code. Q-05 is answered: only dentists approve (D-051).
Confirm Q-13 (AI provider terms) with the owner. Check the current official API documentation for the model family,
structured output and data-retention options, and record the model choice. Move tasks to Ready.

**Acceptance.** - [ ] Tasks pass the Definition of Ready. - [ ] Q-13 answered or its assumption accepted in writing.

---

### E06-T01 · Schema: treatment plans, visit treatments, aftercare
- **Role:** builder · **Risk:** critical · **Depends on:** E01-T01, E02-T01
- **Read:** `data-model` (section 6) · D-017, D-036

**Do.** Migrations for `treatment_plans`, `plan_items`, `visit_treatments`,
`aftercare_templates`, `aftercare_drafts`. Seed: plans for some patients; the six library
templates from the demo (lines 1422–1459) as approved templates linked to treatment types.

**Acceptance.** - [ ] Meta-test and isolation pass. - [ ] One current approved template per treatment type and language is enforced. - [ ] No column stores clinical findings. - [ ] `data-model.md` matches.

---

### E06-T02 · Treatment plan on the patient profile
- **Role:** builder · **Risk:** normal · **Depends on:** E06-T01
- **Read:** `scope` (Patients) · `design-ref` (demo lines 382–401; logic 1624–1629, 1860–1870) · D-043

**Do.** Profile section: add items (treatment type, optional tooth, optional price), reorder,
mark done, progress bar and summary. The appointment drawer lists the plan. Booking from a
plan item links the appointment to it. Prices hidden when the clinic uses none.

**Acceptance.** - [ ] Progress and remaining totals are correct. - [ ] Marking done records when and in which appointment. - [ ] Requires `patients.manage`; changes audited.

---

### E06-T03 · Visit wrap-up ("In the chair", light)
- **Role:** builder · **Risk:** normal · **Depends on:** E06-T02, E01-T06
- **Read:** `scope` (In the chair → visit wrap-up) · `design-ref` (demo lines 804–858, 961–996; logic 1642–1657) · D-017

**Do.** "Who's in the chair?" screen (arrived, later today, finished, search, walk-in).
Wrap-up form: tick plan items done today and/or add treatments done; "When you finish"
suggestions as checkboxes (book the next plan item → `book_followup` task; add an item to the
plan); Finish → appointment completed, `visit_treatments` saved, plan updated, recall clock
updated, summary screen. "Save, finish later" keeps the form state.

**Out of scope (hard line).** Tooth chart, surfaces, materials, anaesthetic, clinical notes,
medical alerts, last-visit findings, billing totals.

**Acceptance.**
- [ ] Finishing a visit performs all listed effects in one transaction.
- [ ] The summary lists exactly what happened.
- [ ] A `book_followup` task appears in the front desk's Needs attention.
- [ ] Nothing clinical beyond treatment type and tooth number is stored.

---

### E06-T04 · Aftercare library
- **Role:** builder · **Risk:** normal · **Depends on:** E06-T01
- **Read:** `scope` (Automations) · `design-ref` (demo lines 570–611; logic 2004–2010) · D-036, D-051

**Do.** Library tab: list with status and usage; editor for the short message text (used on WhatsApp, and on SMS once it exists), intro,
Do, Avoid, Call us if; save creates a new version; "Approve for clinic use" needs
`aftercare.approve` (dentists only, D-051). "New template" for a treatment type (manual, or "Draft with AI"
once T05 exists).

**Acceptance.**
- [ ] Front desk and hygienists can view but not approve or edit templates.
- [ ] Editing an approved template creates a new draft version; the old one stays in use until the new one is approved.
- [ ] Placeholders are validated (`{first_name}`, `{link}`, `{clinic_phone}`, `{provider}`).

---

### E06-T05 · AI drafting module
- **Role:** builder · **Risk:** critical · **Depends on:** E06-T01, E00-T07
- **Read:** `security` (Part 1, section 4) · `test-strategy` (AI boundary) · D-011, D-037 · current official API documentation

**Do.** In `aftercare`: a prompt builder whose **type signature only accepts** treatment type
name, language and clinic tone notes; the system prompt (versioned in the repository); an AI
adapter interface with a real implementation and a fake; a strict output schema (lengths,
list sizes, allowed placeholders); timeout, one retry, and a clean "AI unavailable, write it
yourself" fallback; token usage logged per clinic. Rewrite actions (shorter, simpler, warmer)
that take template text with placeholders. A worker job runs the calls.

**Acceptance.**
- [ ] The canary test passes: no patient field can reach a prompt (property test).
- [ ] Output that fails the schema is rejected and never stored as a draft.
- [ ] A rewrite that drops or invents a placeholder is rejected.
- [ ] AI outage leaves the workflow usable (manual text).
- [ ] The API key exists only in the worker's configuration; nothing AI-related is callable from the browser.

---

### E06-T06 · AI evals
- **Role:** tester · **Risk:** critical · **Depends on:** E06-T05
- **Read:** `test-strategy` (AI evals)

**Do.** The eval set and runner in `tests/evals/`: code checks and the reviewer-model rubric
as described in the strategy; results saved with prompt version and model; a short report.
A documented command to run it. Iterate on the prompt with the builder until it passes.

**Acceptance.**
- [ ] The set covers about 25 treatment types incl. vague and nonsense inputs, per supported language.
- [ ] All code checks pass; rubric average above the agreed threshold; zero safety failures.
- [ ] The owner has read the ten most common outputs and signed off (dentist review before pilot is noted as an owner action).

---

### E06-T07 · Drafts are created when a visit is finished
- **Role:** builder · **Risk:** critical · **Depends on:** E06-T03, E06-T05
- **Read:** `messaging` (Aftercare) · `data-model` (`aftercare_drafts`) · D-036

**Do.** On completion: pick the main treatment (by `aftercare_priority`, only types with
`needs_aftercare`); approved template exists → draft from it; else → AI job → draft marked AI.
One draft per appointment. Expiry 24 hours after completion (a job marks them expired).
Marking an appointment done from the drawer (without the wrap-up) behaves the same, using
the appointment's treatment type.

**Acceptance.**
- [ ] Checkup-type visits create no draft.
- [ ] Template path makes no AI call. AI path stores model and prompt version.
- [ ] Completing twice (undo, redo) does not create a second draft.
- [ ] An expired draft cannot be approved.

---

### E06-T08 · Review, approve, send
- **Role:** builder · **Risk:** critical · **Depends on:** E06-T07, E06-T04
- **Read:** `scope` (Automations; Today) · `design-ref` (demo lines 1259–1322, 612–634, 141–155; logic 1764–1773, 1966–1994) · D-051

**Do.** Review drawer: source banner (template vs AI), Message and Email tabs with edit, rewrite
buttons, "save as clinic template" tick for AI drafts, Approve and send, Not now, Discard.
"To review" tab and the Today panel, with bulk approve for unedited template-based drafts.
Approval creates message rows (keys `aftercare:…`), the aftercare link, and an audit row with
approver and text version. Permission: every approval, edit and discard needs
`aftercare.approve`, which only dentists have (D-051). Others can open and read drafts.

**Acceptance.**
- [ ] Front desk and hygienists cannot approve, edit or discard any draft (server refuses).
- [ ] No message exists before approval; exactly one per channel after.
- [ ] "Save as template" creates an approved template recorded with the approving dentist.
- [ ] Bulk approve skips AI drafts and says so.
- [ ] The audit row identifies approver, draft and template version without storing the text.

---

### E06-T09 · Patient aftercare page and email
- **Role:** builder · **Risk:** normal · **Depends on:** E06-T08, E02-T09
- **Read:** `scope` (Patient pages) · `design-ref` (demo lines 1058–1075, 1150–1168) · `security` (Part 1, section 3) · D-026, D-027

**Do.** Link purpose `aftercare`, 14-day expiry. Page: intro, Do, Avoid, Call us if, a
call-the-clinic button. Email with the same structure. All text escaped.

**Acceptance.** - [ ] Page works at 320 px, passes the accessibility check, makes no third-party request. - [ ] After 14 days the link shows the standard invalid page. - [ ] The page shows nothing beyond first name, treatment name and the approved text.

---

### E06-T10 · Journey J8 and aftercare edge cases
- **Role:** tester · **Risk:** critical · **Depends on:** E06-T02 … E06-T09
- **Read:** `test-strategy` (AI boundary; journeys)

**Do.** Playwright J8 (template path and AI path with the fake AI). Edge cases: expiry,
quiet hours, patient without contact, opt-out, undo of a completed visit, concurrent approval
by two users.

**Acceptance.** - [ ] J8 passes in CI. - [ ] No path sends aftercare without an approval by a permitted role.

**Milestone check (M6):** on staging, finish a visit for a treatment without a template, read the AI draft as a dentist, approve it, receive it on your phone, find the new template in the library.

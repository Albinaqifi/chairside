# E03 · Real channels: WhatsApp and email (milestone M3)

**Outcome:** real WhatsApp and email messages leave the system and their delivery status
comes back. Failures are visible, patients can opt out, and sending is capped.
SMS is **not** built here, but everything is shaped so it can be added at any time and
clinics can switch between channels without code changes (D-055).

**Why now:** M2 proved the loop with a fake channel. This makes it real, and adds the brakes
that must exist before any real number is messaged.

**Country:** North Macedonia (D-049). T01 can run now. T02 onward wait for the provider
choice (Q-08) made in T01.

**Owner action to start now, in parallel with M0–M2:** create the Meta Business account and
begin business verification, and get the one phone number that will send WhatsApp messages for all clinics (D-056).
Verification and template approval take days to weeks; starting late would block M3.

Detail level: **Planned**. T00 refines the rest.

---

### E03-T00 · Refine this epic
- **Role:** architect · **Risk:** low · **Depends on:** E02 done, E03-T01 done
- **Read:** this file · `messaging` · E02 handoff notes · D-055, D-056

**Do.** Check each task against what E02 actually built and against the chosen provider's
current documentation. Tighten acceptance criteria, split anything too big, name the exact
files and functions to extend. Move tasks to Ready.

**Acceptance.** - [ ] Every task passes the Definition of Ready. - [ ] Board updated.

---

### E03-T01 · Choose the WhatsApp route and the email provider
- **Role:** architect + owner · **Risk:** normal · **Depends on:** none
- **Read:** D-010, D-049, D-055 · Q-04, Q-08, Q-18 · `security` (Part 2, legal list)

**Why.** WhatsApp can be used directly through Meta's own API or through a partner company
(for example Infobip, Twilio, 360dialog). Partners cost a little more per message but make
number onboarding easier and usually offer SMS from the same account, which matters because
SMS must be addable later. Email is a separate choice.

**Do.** From **current official documentation** (do not rely on memory), compare:
- WhatsApp: direct API vs two partners. For each: how a clinic's or the product's number is
  registered, business verification steps, how message templates are submitted and approved,
  price per message in North Macedonia by category, delivery and read receipts, inbound
  replies and button callbacks, webhook signing, sandbox/test numbers, whether SMS (and
  later Viber) is available from the same account.
- Email: two candidates: EU data processing and agreement, price, webhooks and signing,
  sending-domain setup.
Write a one-page comparison with a recommendation. The owner decides and creates the accounts.

**Acceptance.**
- [ ] Comparison document with sources and date.
- [ ] Decision recorded in `decisions.md`; Q-08 marked answered.
- [ ] Sub-processor list started in `security-privacy.md`.

---

### E03-T02 · Email adapter and email layout
- **Role:** builder · **Risk:** critical · **Depends on:** E03-T01, E02-T07
- **Read:** `messaging` (Channels and adapters; Templates) · provider docs · `design-ref` (demo lines 1058–1075, email mock-up)

**Do.** Implement the adapter interface for the chosen provider. One clean, light HTML email
layout plus a plain-text part: clinic name, message text, a clear button for the link.
From / reply-to from clinic settings. Map provider errors to temporary or permanent.
Document domain setup (SPF, DKIM, DMARC) in the runbook, with a shared sending domain as fallback.

**Acceptance.**
- [ ] Contract tests against recorded provider responses: success, temporary error, permanent error, timeout.
- [ ] The email renders correctly in a major webmail and a phone mail app (screenshots).
- [ ] No tracking pixel and no rewritten tracking links (D-034).
- [ ] The API key is read from configuration only and never logged.

---

### E03-T03 · WhatsApp adapter and template registry
- **Role:** builder · **Risk:** critical · **Depends on:** E03-T01, E02-T07
- **Read:** `messaging` (Channels and adapters, WhatsApp) · `data-model` (`message_templates`, `patients.whatsapp_status`) · provider docs · D-055

**Why.** Business-initiated WhatsApp messages must use templates that Meta has approved.
Our rule texts therefore exist twice: as the approved template at the provider (with
numbered variables) and as our local copy used for previews and stored snapshots.

**Do.**
- Adapter: send a template message with variable values and a URL button to the patient
  page; map provider errors to temporary / permanent, with a distinct permanent reason
  `not_on_whatsapp`.
- Template registry: for each rule and language, the provider template name, its variable
  order, and its approval status (`pending`, `approved`, `rejected`). A rule cannot send on
  WhatsApp until its template is approved. A script submits our default templates to the
  provider and records the names.
- Local copy and provider template are compared by a test so they never drift.
- Patient `whatsapp_status` updated from send results (`available` on success,
  `unavailable` on `not_on_whatsapp`).

**Acceptance.**
- [ ] Contract tests: success, temporary error, permanent error, `not_on_whatsapp`, timeout.
- [ ] A rule whose template is not approved is skipped with reason `template_not_approved`, visibly.
- [ ] Cyrillic text is delivered intact (WhatsApp has no SMS alphabet limit).
- [ ] `not_on_whatsapp` marks the patient and makes the dispatcher fall through to the next channel (E02-T07 behaviour), never a duplicate.

---

### E03-T04 · Webhooks: delivery status and replies come back
- **Role:** builder · **Risk:** critical · **Depends on:** E03-T02 or E03-T03
- **Read:** `messaging` (Webhooks) · `data-model` (`webhook_events`, `inbound_messages`) · `security` (Part 1, section 8)

**Do.** Migrations for `webhook_events` (allow-listed, with the reason) and
`inbound_messages`. Endpoint per provider: verify the signature, store the raw event, answer
fast, process in a job:
- status events → our statuses (`sent`, `delivered`, `read` counts as delivered), `message_events`, invalid contacts, `invalid_contact` tasks;
- inbound WhatsApp replies: a recognised opt-out word ("STOP" and local equivalents) records
  consent rows like the opt-out page; a button reply (v1.1) is mapped to its message; any
  other text creates a `patient_replied` task showing the text to staff. No chat interface.

**Acceptance.**
- [ ] A request with a wrong or missing signature is rejected and stored nowhere.
- [ ] The same event delivered twice changes the status once.
- [ ] Events arriving out of order do not move a message backwards (`delivered` stays `delivered`).
- [ ] An unknown provider message id is stored and flagged, not crashed on.
- [ ] An inbound "STOP" cancels that patient's pending care follow-ups and writes consent rows; a free-text reply creates exactly one task.
- [ ] No message content or contact detail from the payload reaches the logs.

---

### E03-T05 · Sending caps, usage counting, non-production allow-list
- **Role:** builder · **Risk:** critical · **Depends on:** E02-T07
- **Read:** `messaging` (Caps and switches; dispatcher re-checks) · D-030, D-044, D-055 · Q-04

**Do.** Per-clinic daily and monthly caps counted in **messages per channel**, checked by
the dispatcher. At the cap: messages wait, a `cap_reached` task and an operator alert are
raised, and the affected appointments for today and tomorrow are listed for phoning. Usage
query per clinic, channel and month. Outside production: only allow-listed contacts can be
sent to; everything else is skipped with `not_allowlisted`.

**Acceptance.**
- [ ] At the cap nothing more is sent and nothing is dropped; raising the cap releases the waiting messages.
- [ ] Usage per channel equals the count of sent messages for the month.
- [ ] In a non-production environment a non-listed recipient is never passed to a real adapter (test at the adapter boundary).
- [ ] The allow-list cannot be empty-means-everyone: empty means nobody.

---

### E03-T06 · Settings: message channels and quiet hours
- **Role:** builder · **Risk:** normal · **Depends on:** E03-T05
- **Read:** `scope` (Settings) · `design-ref` (demo lines 779–798) · D-055

**Do.** Channels tab: WhatsApp and email connection state, **enabled channels** (switching a
channel off makes every rule fall through to its next channel), sender details, reply-to,
usage per channel against the caps, quiet hours (start, end, quiet weekdays), default send
time, frequency-cap days. SMS appears as "not available yet" so the place is visible.

**Acceptance.**
- [ ] Disabling WhatsApp: pending WhatsApp messages are re-planned on the next channel; nothing is lost or duplicated.
- [ ] Changes validated (a rule's send time cannot fall inside quiet hours) and audited.
- [ ] Usage shown matches the usage query.

---

### E03-T07 · Opt-out by link (and by reply)
- **Role:** builder · **Risk:** critical · **Depends on:** E02-T08, E02-T05
- **Read:** `security` (Part 1, sections 3 and 5) · D-028, D-040, D-055

**Do.** Link purpose `opt_out`. Page: "Stop these messages from <clinic>?" with choices
(this kind of message / all non-essential messages / this channel), POST to confirm, undo on
the result page. Writes consent rows with source `link`. `{opt_out_link}` variable, required
in care follow-up and marketing templates (template validation enforces it). Reply-based
opt-out is handled in E03-T04 and shares the same consent-writing function.

**Acceptance.**
- [ ] Opening the page changes nothing; confirming adds consent rows; pending messages of that class are cancelled.
- [ ] A care follow-up template without the opt-out variable cannot be saved.
- [ ] Opt-out for one patient does not affect another patient with the same phone.

---

### E03-T08 · Unreachable patients, invalid contacts and failed messages on the staff side
- **Role:** builder · **Risk:** normal · **Depends on:** E03-T04, E02-T13
- **Read:** `scope` (Today; Patients) · D-035, D-055

**Do.** Warning on the patient profile and in search rows when a phone or email is invalid or
the number is not on WhatsApp; correcting the contact clears the flag. A patient who cannot be
reached on any enabled channel gets a `call_unconfirmed`-style task instead of a silent skip.
Failed-message items in "Needs attention" show the reason in plain words and offer "retry
now" (a new attempt through the pipeline) or "mark handled".

**Acceptance.**
- [ ] `not_on_whatsapp` with no email: the attention list shows the patient as "needs a call".
- [ ] Fixing a contact clears the warning and allows messages again.
- [ ] "Retry now" cannot create a duplicate of an already delivered message.

---

### E03-T09 · Live test on staging
- **Role:** tester + owner · **Risk:** critical · **Depends on:** E03-T02 … E03-T08
- **Read:** `test-strategy` (Before a release) · runbook

**Do.** With the owner's own phone and email on the allow-list: run the reminder loop for
real. Check sender identity, wording, link, delivery and read status, a number without
WhatsApp (fallback to email), an opt-out by link and by reply, the cap. Record results and screenshots.

**Acceptance.**
- [ ] WhatsApp and email arrive, links work on a real phone, statuses reach `delivered`.
- [ ] A non-listed number receives nothing.
- [ ] Findings list written; nothing critical open.

**Milestone check (M3):** a real reminder on your phone, confirmed, visible in the calendar.

---

### E03-T10 · SMS adapter — deferred to v1.1, do not start
- **Role:** builder · **Risk:** critical · **Depends on:** E03-T01 (SMS from the same partner, if possible), E03-T05
- **Read:** `messaging` (SMS, when added) · D-054, D-055 · Q-17

**Why kept here.** The owner wants SMS addable at any time. Everything else is already
channel-agnostic; this task is all that is missing.

**Do.** SMS adapter for the chosen partner; `countSmsParts` (160/153 basic alphabet, 70/67
otherwise); `toSmsLatin` (Macedonian Cyrillic transliterated, `ë`→`e`, `ç`→`c`, accents removed,
applied to the whole rendered SMS including names, D-054); part-based caps and usage for the
SMS channel; sender name from clinic settings; the channel appears in Settings and in rule
channel order.

**Acceptance.**
- [ ] Contract tests as for the other adapters; an invalid number yields a permanent error and marks the contact invalid.
- [ ] `toSmsLatin` maps every Macedonian Cyrillic letter (including Ѓ, Ќ, Љ, Њ, Џ, Ѕ, Ј) and `ë`, `ç`; property test: its output always counts at 160 per part.
- [ ] Enabling SMS in a clinic's settings makes it usable in rule channel order with no other change.

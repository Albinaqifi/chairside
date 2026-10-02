# Messaging

How messages are planned and sent. This is the heart of the product and its riskiest part.
Changes to anything described here are **critical** tasks and get owner review.

## Two stages, always

1. **Plan.** Decide which messages should exist and store each as a row in `messages`
   (`status = pending`, with a time). Nothing is sent here.
2. **Send.** Take rows that are due, check they are still valid, deliver them.

Keeping these apart is what makes duplicates, gaps, retries and time zones manageable:
every question ("was it sent?", "why not?", "what goes out tomorrow?") is a query.

**No code ever sends a message any other way.** Manual nudges, test sends, aftercare,
booking confirmations: all create a `messages` row and let the dispatcher send it.

## Message classes

| Class | Triggers | Allowed by default? | Quiet hours move it | Frequency cap | Opt-out link in text |
|---|---|---|---|---|---|
| **Transactional** | `booking_confirmation`, `appointment_reminder`, `aftercare` | Yes, until the patient objects | reminder: **earlier**; others: later | No | Not required |
| **Care follow-up** | `recall`, `no_show_followup` (later: `unfinished_plan`, `course_step`) | Yes, until the patient opts out (Q-06) | later | Yes | Required |
| **Marketing** | `promo` (v2) | Only with recorded consent | later | Yes | Required |

## What triggers planning

- **A change** (appointment booked, moved, cancelled, completed, no-show; aftercare approved):
  the code that makes the change enqueues "plan for this appointment/patient" in the same
  transaction. Fast reaction.
- **The clock** (every 5 minutes): the planner runs for every clinic. It is the safety net
  that catches anything a change missed, and the only source for time-only triggers (recall due).

The planner is **idempotent**: running it twice, or twice at the same moment, changes nothing.

## Idempotency keys

Every message has a key that names "this message, for this reason, on this channel".
`UNIQUE (clinic_id, idempotency_key)`; the planner inserts with "do nothing on conflict".

| Trigger | Key |
|---|---|
| Booking confirmation | `confirm:{appointment_id}:{channel}` |
| Appointment reminder | `reminder:{appointment_id}:{starts_at in UTC}:{channel}` |
| Recall | `recall:{patient_care_plan_id}:{next_due_on}:{step}:{channel}` |
| No-show follow-up | `noshow:{appointment_id}:{step}:{channel}` |
| Aftercare | `aftercare:{draft_id}:{channel}` |
| Manual nudge | `manual:{task_or_request_id}:{channel}` |

The reminder key contains the start time, so a moved appointment gets a new, correct reminder.
When an appointment moves or is cancelled, its still-pending messages are set to `cancelled`.

## Working out the send time

One pure function per trigger: `computeSendTime(rule, facts, clinic, now)` → a time, or a
skip reason. No database, no system clock. Tested with tables and property tests.

### Appointment reminder

1. **Day offset** ("1 day before at 18:00"): take the appointment's local date, go back N
   days, at the rule's local time. **Hour offset** ("3 hours before"): start time minus N hours.
2. **Quiet adjustment, earlier.** If that moment is in quiet hours, on a quiet weekday or on a
   closed day:
   - day offset: step back one day at a time until the day is allowed;
   - hour offset: move back to the last allowed minute before the quiet period.
   A rule's time of day must itself be outside quiet hours (checked when saving the rule).
3. **Already past?** (The appointment was booked late.)
   - If a booking confirmation is being sent for this appointment now, the confirmation
     carries the same link and **replaces** the reminder → skip, reason `covered_by_confirmation`.
   - Else if the appointment is at least `min_lead` away (default 2 hours) → send at the next
     allowed moment, if that is still `min_lead` before the start.
   - Else → skip, reason `too_late`.
4. Never send a reminder after the appointment has started.

### Booking confirmation
At once, if staff left the box ticked. If inside quiet hours: next allowed moment, and skip
if that is after the appointment.

### Recall
- Due date comes from the patient's care plan (`next_due_on`).
- Step 1 at `next_due_on − lead_days`, at the clinic's default send time (10:00).
- Step 2 (the nudge) `second_nudge_after_days` after step 1, if enabled.
- Not planned (and pending ones cancelled) when: the patient has a future appointment; the
  care plan is inactive or **paused** (start gate, D-030); the patient is not active.
- `next_due_on` is recalculated when a completed appointment's treatment type is one of the
  plan's "resets the clock" types: completion date + interval.

### No-show follow-up
Appointment marked no-show → step 1 after the rule's delay (default 2 hours), moved later out
of quiet hours. Cancelled if the patient gets a new appointment first.

### Aftercare
Created when a draft is approved. Sent at once; if inside quiet hours, at the next allowed
moment, unless the draft has expired by then (D-036).

### Quiet adjustment, later (everything except reminders)
Move forward to the next allowed moment: after quiet hours end, on a day that is neither a
quiet weekday nor a closed day.

## Frequency cap and priority (care follow-up and marketing only)

At most **one** such message per patient per 7 days (clinic setting).
If two compete, the higher priority goes first and the other is **postponed**, not dropped:

`no_show_followup` > `unfinished_plan` > `recall` > `promo`

Transactional messages are never capped and do not count.

## The dispatcher (every minute)

1. **Claim** rows with `status = pending` and `scheduled_for <= now`, in small batches, with
   `FOR UPDATE SKIP LOCKED`, and mark them `sending`. Two workers can never take the same row.
2. **Re-check, right before sending** (things change between planning and sending):
   - global kill switch on? clinic paused? → leave pending, alert
   - appointment still exists, same time, still booked or confirmed?
   - patient still active (not archived, deceased, deleted)?
   - patient has not objected to this class and channel? marketing consent present?
   - contact detail present and not marked invalid?
   - outside quiet hours? (if not, reschedule by the class rule)
   - frequency cap free? (if not, postpone)
   - clinic's daily and monthly caps not reached? (if reached: leave pending, raise an alert
     and an attention item; never drop silently)
   - not production? recipient on the allow-list, else skip with reason `not_allowlisted`
   - template renders completely? (no unknown or empty required variable)
   Any failed check → `skipped` with a reason, or postponed. **Skipped is visible, never silent.**
3. **Render** the template for the channel and the patient's language; create the link; store
   the rendered text on the row (and, for SMS once it exists, the number of parts).
4. **Send** through the channel adapter. Store the provider's message id, status `sent`.
5. **Record** a `message_events` row for every status change.

### Retries
- Temporary errors (timeout, 5xx, rate limit): back to `pending` with a later time:
  1 min, 5 min, 30 min, 2 h. At most 5 attempts. It is the same row, so no duplicate.
- Permanent errors (invalid number, blocked): `failed` at once. Mark the contact invalid.
- Never retry a reminder past the appointment start.
- A row stuck in `sending` for over 10 minutes (the worker died mid-send) is checked with the
  provider before anything is re-sent.

### Failure is loud
`failed` and capped messages appear in "Needs attention". A spike in failures alerts the operator.

## Message states

```
pending ──► sending ──► sent ──► delivered
   │           │          └────► failed   (provider says so, via webhook)
   │           ├──► pending   (temporary error, retry later)
   │           ├──► failed    (permanent error or attempts used up)
   │           └──► skipped   (a send-time check said no; reason stored)
   └──► cancelled             (appointment moved/cancelled, patient booked, rule switched off)
```
`delivered`, `failed`, `skipped`, `cancelled` are final. Invalid transitions are rejected by a
pure state-machine function with tests.

## Channels and adapters

Every adapter implements the same small interface:

- `send(message)` → provider message id, or an error marked `temporary` or `permanent`
- `parseWebhook(request)` → verified status events

Adapters: `fake` (logs to a table; can be told to succeed, fail temporarily, fail permanently
or time out), `whatsapp`, `email`. Designed and addable at any time: `sms` (E03-T10). Later: `viber`.

### Channel order and fallback (D-055)
A rule has an **ordered channel list**, default `[whatsapp, email]`. The planner creates **one**
row, for the first channel that passes all of: enabled for the clinic, the patient has that
contact detail, it is not marked invalid or `whatsapp_status = unavailable`, the patient has
not refused that channel. If sending later fails permanently on that channel (`not_on_whatsapp`,
bad address), the dispatcher creates a row for the next channel; the key contains the channel,
so this can never duplicate. A patient reachable on no enabled channel is skipped with reason
`unreachable` and a task is raised so staff can phone.
Disabling a channel in clinic settings re-plans its pending messages on the next channel.

### WhatsApp specifics
- Business-initiated messages must use templates approved by Meta, per language, with
  numbered variables. Our rules map to a provider template name and a local copy of its text;
  a rule cannot send on WhatsApp until its template is approved (skip reason `template_not_approved`).
- In v1 the templates are the product's (one sender number for all clinics, D-056); clinics edit email wording only.
- The patient page link travels as a URL button. Quick-reply buttons come in v1.1.
- Status events: `sent`, `delivered`, `read` (stored as delivered plus an event). A permanent
  failure `not_on_whatsapp` sets the patient's `whatsapp_status` to `unavailable`.
- Patients can reply. An opt-out word writes consent rows; other text becomes a
  `patient_replied` task. No chat interface.
- Meta's policy requires that the business has the patient's opt-in. The clinic confirms this
  at onboarding and in the import wizard; the confirmation is recorded (R-29).

**SMS length (applies once SMS is added, E03-T10).** Count parts correctly: 160 characters per
part in the basic alphabet (153 when split), 70 (67) when any character is outside it. Cyrillic is outside it, and so are
Albanian `ë` and lower-case `ç`, so this is the normal case in North Macedonia (D-049).
SMS text is therefore always converted to plain Latin letters before sending: Cyrillic is
transliterated, `ë` becomes `e`, `ç` becomes `c`, including filled-in names (D-054). Email and
patient pages keep the real alphabet. The editor's part counter counts the converted text.
The editor shows the count; the row stores the real number of parts after rendering.

## Webhooks

1. Verify the provider's signature. Reject anything else.
2. Store the raw event first (unique on the provider's event id), answer fast.
3. Process afterwards: map to our status, add a `message_events` row, update the message.
4. A replayed event changes nothing.
5. Hard bounce or invalid number → mark that contact invalid, raise an attention item.
6. Raw payloads are deleted after 30 days.

## Templates

- Variables: single braces, fixed list per trigger. v1 list: `{first_name}`, `{clinic}`,
  `{date}`, `{time}`, `{provider}`, `{link}`, `{clinic_phone}`, `{recipient_name}` (the guardian
  when there is one, else the patient).
- Saving a template with an unknown variable fails. Rendering with a missing value fails
  closed: the message is skipped with reason `render_failed` and flagged.
- Dates and times are formatted in the clinic's locale and time zone.
- Templates are versioned; each message records the version it used and keeps a snapshot of
  the rendered text (removed after the retention period).

## Caps and switches (D-030)

| Control | Scope | Effect |
|---|---|---|
| `MESSAGING_ENABLED` | whole system | Off = dispatcher claims nothing. |
| Clinic paused | one clinic | Same, for one clinic. |
| Daily cap, monthly cap (messages per channel; SMS parts once SMS exists) | one clinic | When reached: messages wait, alert + attention item. Reminders for today/tomorrow are listed so staff can phone. |
| Recall start gate | one patient's care plan | Imported patients start paused; staff release in batches. |
| Allow-list | non-production | Only listed test contacts can receive anything. |

## Production checks

- **Nightly canary:** every appointment tomorrow has a pending reminder or a recorded skip
  reason. Otherwise the operator is alerted.
- **Operator numbers:** planned, sent, failed, skipped per clinic per day. A sudden drop is a
  bug or an outage.

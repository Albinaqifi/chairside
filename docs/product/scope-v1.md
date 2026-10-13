# Scope of version 1, screen by screen

For each screen of the demo: what is built in v1, what is built **differently** from the demo,
and what is **not** built. Builders: read your screen's section before opening the demo.
Reasons are in `docs/log/decisions.md` (D-numbers).

Legend: ✅ in v1 as designed · ✏️ in v1 but changed · ⏳ later · ❌ not planned

---

## Navigation and roles

- ✅ Sidebar: Today, Calendar, In the chair, Patients, Automations, Import patients, Settings.
- ✏️ The "Signed in as" role switcher is a demo device. Real login decides the role. (B1)
- ❌ "Patient's phone" is a demo screen. The real patient pages live under `/p/<token>`.
- ✏️ Roles: owner, dentist, hygienist, front desk (D-021). What each sees:

| Area | Owner | Dentist / hygienist | Front desk |
|---|---|---|---|
| Calendar, patients, booking | ✔ | ✔ (opens on own column) | ✔ |
| Visit wrap-up | ✔ if linked to a provider | ✔ | ✔ |
| Read aftercare drafts and the library | ✔ | ✔ | ✔ |
| Approve, edit or discard aftercare; approve library templates (D-051) | only if also a dentist | dentist ✔ · hygienist ✖ | ✖ |
| Edit automations and care plans | ✔ | ✖ | ✖ |
| Import patients, export data | ✔ | ✖ | only with the extra permission |
| Staff, settings, audit log, results panel | ✔ | ✖ | ✖ |

## Today

- ✅ Greeting, date, buttons (Open calendar, Start a visit, New appointment).
- ✅ Today's appointments list with counts (confirmed / no reply / cancelled or no-show).
- ✅ "Needs a call": reminder sent, no reply. "Mark called" (stored as a task).
- ✏️ **New panel "Needs attention"** (not in the demo): failed messages, invalid contact
  details, patient cancellations, change requests, booking requests, "to book" requests from
  dentists. (D-035)
- ✅ "Aftercare to review" with bulk approve for template-based drafts (M6). ✏️ Only dentists can approve; others see the list. (D-051)
- ✅ "Due for a visit" with a manual "Nudge" (M5). "Call" for patients without a mobile.
- ✏️ Top results panel: v1 shows **measured numbers only**: confirmation rate, no-show rate by
  month since go-live, recalls that became bookings. No money total, no "prevented" numbers,
  no "before Chairside" comparison. Owner only. (D-034)
- ⏳ "Unfinished treatment" panel with values (v1.1).
- ⏳ "Orthodontics" panel (v1.1).

## Calendar

- ✅ Day view: one column per provider, filter chips, hour grid, now-line, status styling,
  click an empty slot to book.
- ✅ Week view with one lane per provider.
- ✏️ Lunch and breaks come from provider breaks, not from appointments. (D-018)
- ✏️ Overlap: warning plus an explicit "book anyway" (D-020). The database enforces the rest.
- ✏️ "% booked" per column is computed from opening hours.
- ✏️ A filter chip turned off keeps its name in the muted text and fades its dot only; the demo
  fades the whole chip, whose name would then be too faint to read (WCAG AA). E01-T04b.
- ⏳ Drag and drop to move (v1 moves through the drawer).
- ❌ "slot re-filled from waitlist" tags.

## New appointment drawer

- ✅ Patient search with quick "add as new patient", treatment chips with default length,
  start / length / provider (E01-T05a, E01-T05b; D-113). The open-treatment hint comes with
  treatment plans (M6).
- ✏️ Only active patients can be booked: an archived or deceased patient shows in the search
  with their label and cannot be picked; an archived one is made active on the profile first.
  (owner, D-113)
- ✏️ No treatment is chosen until one is picked (the demo starts on Checkup), so no booking takes
  one by default; the treatment's name is the appointment's title on the calendar. (E01-T05a)
- ✏️ Quick-add asks for first name, last name and a phone or email. A patient without any
  contact detail is allowed but flagged.
- ✅ "Text the patient a booking confirmation now" (D-045).
- ✏️ The dropdown the demo labels "Chair" is "Provider". (D-019)

## Appointment drawer

- ✅ Change time and provider. Status buttons: In the chair, Done, No-show, Cancel.
- ✅ "Messages for this visit" timeline, from real message rows and events.
- ✅ "Book next visit", "Patient profile", start the visit wrap-up.
- ✏️ Status changes follow the state machine in `data-model.md`. Cancel asks who cancelled
  and optionally why.
- ✏️ Aftercare box appears in M6. Treatment plan list appears in M6.
- ❌ Waitlist lines in the timeline. ⏳ Orthodontic progress.

## Patients list and profile

- ✅ List with search (name or phone) and filters. Columns: name, care plan, last visit, next
  visit. ✏️ Filters in v1: All, Due for a visit, Agreed to offers. ⏳ Orthodontics, Unfinished treatment.
- ✅ Profile: header, next appointment, care plan card, messages, visit history, communication settings.
- ✏️ Profile also has: date of birth, language, guardian, notes ("not a clinical record"),
  status (active / archived / deceased). (D-033, D-040)
- ✏️ Messages section shows **upcoming** messages too, and delivery failures. (B6, B2)
- ✏️ Communication: three switches (appointment messages, recalls and follow-ups, offers) plus
  "do not WhatsApp" / "do not email" (and "do not SMS" once SMS exists). Every change is
  stored as a consent record with its source. The profile shows whether the number is on WhatsApp.
  Appointment messages can be switched off. (D-040)
- ✏️ Treatment plan section arrives in M6; prices optional (D-043).
- ⏳ "Send plan to patient" (v1.1). ⏳ Orthodontic progress card.

## Automations

- ✅ Rule list with on/off and a results line; rule editor with timing, channel order, message
  text, variable buttons, live preview.
- ✏️ Channels are an **ordered list** (default WhatsApp, then email), not "SMS / Email / Both"
  (D-055). WhatsApp wording is the product's approved template and is shown read-only; email
  wording is editable. An SMS part counter appears only when SMS exists.
- ✏️ Rules in v1: **Booking confirmation, Appointment reminder, Care plan reminders (recall),
  Missed visit follow-up, Aftercare.** The missed-visit rule applies to every no-show, not only
  orthodontic ones.
- ✏️ Reminder timing: "N days before **at HH:MM**" or "N hours before". (C13)
- ✏️ Variables use `{name}` from a fixed list; unknown ones are rejected. `{remaining}` is
  not available in v1. Non-transactional rules always include an opt-out link. (D-038, D-027, D-028)
- ✏️ Results per rule are counted from real data.
- ✅ Care plans tab: list, interval, reminder options, patients on the plan. "+ New care plan" works.
- ✅ Aftercare library tab and "To review" tab (M6). ✏️ Only dentists approve (D-051).
- ⏳ Unfinished treatment rule, Aligner switch rule, "Send test to my phone" (v1.1).
- ⏳ Offers and promotions (v2). The consent switch exists from v1.

## Import

- ✅ Four steps: upload, match columns, review problems, confirm. Auto-matching, duplicates
  with merge / keep both, missing mobile choice, unreadable dates.
- ✏️ Adds: a question when the date format is ambiguous; a required tick "we hold proof of
  consent" before a marketing-consent column is imported; "undo this import" for 7 days. (B5, D12)
- ✏️ Duplicates are matched on name plus date of birth, or name plus contact. A shared phone
  alone is not a duplicate. (D-033)
- ✏️ After the import, recalls for imported patients are **paused**. The final screen offers
  "release recalls in batches" with a count and cost estimate instead of "send to 388 now". (D-030)
- ✅ Fast manual entry form for paper records.

## Settings

- ✅ Clinic details, staff and access, opening hours, message channels, quiet hours.
- ✏️ Adds: closed days; providers; treatment types (name, length, optional price, "needs
  aftercare"); cancel cut-off; time zone, language, currency, phone country.
- ✏️ Staff: invite by email, role, extra permissions, deactivate, 2FA status.
- ✏️ Channels: WhatsApp and email connection state, enabled channels (switching one off makes
  rules fall through to the next, D-055), usage per channel against the caps (D-030), sender
  details, reply-to address. SMS shown as "not available yet".
- ❌ "Booking link for patients". (D-024)

## In the chair → visit wrap-up (M6)

- ✅ "Who's in the chair?": arrived patients, later today, finished today, search, walk-in.
- ✏️ The chart screen is replaced by a short form: tick the open plan items done today and/or
  add treatments done (treatment type, optional tooth number). Then "When you finish":
  suggested next steps as checkboxes (book next item → task for the front desk; add item to
  plan; recall follows the care plan). Finish → appointment completed, plan updated, aftercare drafted.
- ❌ Tooth chart, surfaces, materials, anaesthetic, cartridges, shade, clinical notes, quick
  note phrases, medical alerts, "last visit findings", totals "for billing". (D-017)
- ✅ Finished summary screen, with "Review aftercare" and "Next patient".

## Patient pages (`/p/<token>`)

- ✅ Appointment page: clinic header, date and time, provider, three buttons.
  ✏️ No treatment name on this page. (D-026)
- ✅ Confirm → result page. ✅ Cancel with optional reason → result page.
  ✏️ After the clinic's cut-off: "It's too late to cancel online, please call us."
  ❌ "someone on our waiting list can take the slot".
- ✏️ "Change time" → **"Ask for another time"**: pick preferred days and time of day, optional
  note; the clinic calls back. The appointment stays booked until staff change it. (D-024)
- ✏️ Recall link → "Ask for a visit" with the same form.
- ✏️ New: invalid or expired link page with the clinic's phone number; opt-out page.
- ✅ Aftercare page (M6): intro, Do, Avoid, Call us if, call button. Expires after 14 days.
- ⏳ Treatment plan page behind a second check (v1.1). ⏳ Aligner page (v1.1).
- All actions are buttons that POST. Opening a page never changes anything.

## Messages (wording reference: demo lines 1574–1599 and 1422–1459)

- ✏️ Links are `https://<short-domain>/p/<22-character token>` (D-025), sent as a URL button on WhatsApp.
- ✏️ Default reminder: "Hi {first_name}, a reminder of your appointment at {clinic} on {date}
  at {time} with {provider}. Confirm or cancel here: {link}"
- ✏️ Every care follow-up carries "Stop these messages: {link}". On WhatsApp a reply with an opt-out word is honoured too (D-028, D-055).

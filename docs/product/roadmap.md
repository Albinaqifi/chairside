# Roadmap

## How the order was chosen

1. **Dependencies first.** Nothing can be built before tenant isolation and login exist.
   Messages need appointments. Recalls need the message engine. Aftercare needs treatments.
2. **Value early, in thin slices.** Each milestone ends with something a person can use from
   the screen to the database, not with a finished "layer". After M2 the core promise
   (reminder → patient confirms → calendar updates) works end to end, with a fake channel.
3. **Risk early.** The hardest and most dangerous parts (tenant isolation, message timing,
   duplicates) are built and tested first, while changing them is cheap.
4. **Decide late what can wait.** The WhatsApp route and email provider are chosen in E03. The fake
   adapter lets M0–M2 proceed without that answer.

## Version 1 = milestones M0 to M7

Version 1 is the first release a real clinic can use with real patients.

| # | Milestone | Epic | Ends with (the demo you can give) | Needs first |
|---|---|---|---|---|
| M0 | **Foundation** | E00 | Log in to an empty clinic on a staging URL. Two clinics cannot see each other. CI is green. | — |
| M1 | **Schedule** | E01 | The front desk runs a day: patients, calendar, book, move, cancel, arrive, complete. | M0 |
| M2 | **Reminder loop** | E02 | Book an appointment → reminder is planned and "sent" (fake channel) → open the link on a phone → confirm or cancel → the calendar shows it → Today lists who needs a call. | M1 |
| M3 | **Real channels** | E03 | Real WhatsApp and email messages arrive on your own phone from staging. Delivery status, failures, opt-out, caps. | M2, Q-08, Meta verification done |
| M4 | **Clinic onboarding** | E04 | A messy Excel file becomes clean patients, with review and undo. Staff are invited, 2FA works. | M1 (import), M0 (staff) |
| M5 | **Recalls** | E05 | Overdue patients get recalls by care plan; staff control the rules; Today shows who is due; first real dashboard numbers. | M2 (M3 to go live) |
| M6 | **Aftercare with AI** | E06 | Mark a visit done → draft from the clinic's template or from AI → dentist approves → patient gets SMS, email and a page. | M2, M1 |
| M7 | **Pilot readiness** | E07 | The go-live gate passes: restore drill done, canary running, audit viewer, retention, security pass, runbook. | everything |

M0 and M1 overlap (D-087, D-096): E01-T01a, E01-T01b, E01-T02a and E01-T02b come before E00-T06b
and E00-T07, so a receptionist sees patients before staging exists. M0's staging URL comes after
E01-T02b.

M4 can run in parallel with M2/M3 if two agents work at once: it touches different modules.

### The cut line

If time presses, **M6 can ship after the first clinic goes live** without rework: it only adds
to what exists. M0–M5 plus M7 is the smallest version that keeps the core promise.
M7 can never be cut: it is what makes real patient data acceptable.

### What version 1 contains

- Clinic, staff with roles, login with 2FA
- Patients: create, edit, search, import from CSV/Excel
- Calendar by provider (day and week), booking with conflict protection
- Booking confirmation, appointment reminder with confirm / cancel / "ask for another time"
- Care plans and recalls with a second nudge; missed-visit follow-up
- WhatsApp and email through real providers, delivery tracking, opt-out, quiet hours, caps; SMS addable at any time (D-055)
- Treatment plans (staff side) and the light visit wrap-up
- Aftercare: template library, AI drafts, human approval, patient page
- Today screen: appointments, needs a call, needs attention, due for a visit, aftercare to review
- Measured results: confirmation rate, no-show rate, recalls that became bookings
- English only, built so that translation is a content task, not a code task (D-053)
- When SMS is added: plain Latin letters (D-054)
- Audit log, backups with a tested restore, monitoring, retention jobs

### What version 1 does not contain

See "Non-goals" in `docs/intent.md` and the per-screen list in `scope-v1.md`.

## Between version 1 and the first real clinic: the translation pass

The owner translates (D-053): the app's message file, the default message templates and the
aftercare library seed, into Macedonian and/or Albanian. Then one AI eval run in that
language. Agents only prepare the files and run the evals. No translation work happens
during v1.

## After version 1

Order here is a proposal; pilot feedback (Q-09) should re-rank it.

**v1.1 — "soon after", small additions on top of what exists**
- Unfinished-treatment follow-up rule and the "Unfinished treatment" panel
- Patient treatment-plan page behind the second check; "Send plan to patient"
- Orthodontic courses: braces visit progress, aligner switch reminders and confirmations
- Notices when the clinic moves or cancels an appointment
- SMS as a third channel (E03-T10), switchable per clinic
- WhatsApp quick-reply buttons for confirm / cancel
- "Send test to my phone" in the rule editor; separate email text per rule
- Money estimates on the dashboard, with the formula shown

**v2 — larger features, each needs its own design round**
- Online self-booking and self-rescheduling with live free slots
- Waitlist that offers freed slots
- Viber
- Promotions and campaigns
- Clinic subscriptions and message billing
- Reply handling (two-way messages)
- Chair as a separately bookable resource; multi-location clinics
- Clinical charting and notes — only if Q-02 says so

## Dependency picture

```
M0 Foundation
 └─ M1 Schedule
     ├─ M2 Reminder loop ──┬─ M3 Real channels ──┐
     │                     ├─ M5 Recalls ────────┤
     │                     └─ M6 Aftercare ──────┼─ M7 Pilot readiness ─ v1.0
     └─ M4 Onboarding (import, staff, 2FA) ──────┘
```

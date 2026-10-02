# Reconciliation: design vs. architecture

A critical review of the two original files:

- **Architecture Explorer** (called "the architecture" below): system diagrams, data model, guides.
- **Chairside Demo v3** (called "the demo"): the clickable product design.

Each finding says what was wrong and how it was resolved. `D-0xx` points to
`docs/log/decisions.md`, `Q-xx` to `docs/log/open-questions.md`.
This is background reading. Tasks only reference it when a specific finding matters.

**Summary.** The two files agree on the core: one app, one database, a worker, planned
messages, AI behind human approval. They disagree in three ways:
(A) the demo promises more than the architecture can deliver or wanted to deliver;
(B) the architecture requires screens the demo does not have;
(C) the data model cannot store a good part of what the demo shows.
On top of that, (D) both files contain weak spots that only show up with real clinics and
real patient data.

---

## A. The demo does more than the architecture supports

| # | Finding | Resolution |
|---|---|---|
| A1 | **"In the chair" is a clinical record.** The demo has a tooth chart, procedures with surfaces, materials and anaesthetic, clinical notes and medical alerts. The data model has no table for any of it, and the architecture's own overview warns that charting and "legally required clinical records" are a different product. This is the biggest contradiction between the files. | v1 keeps only a light **visit wrap-up**: which treatments were done, what to book next. No chart, notes or alerts. D-017. The long-term answer is the owner's: Q-02. |
| A2 | **Billing hints.** "Total for today … passed to the front desk for billing", prices on every plan item, a "Balance" column in the import. There is no billing anywhere in the architecture. | Prices stay as optional estimates. The billing wording is removed. D-043. |
| A3 | **Live self-rescheduling.** The patient page shows real free slots and "Move my appointment". The architecture says: v1 is "request another time", staff call back. | Request only in v1. D-024. The page needs a small redesign (preferred days / time of day instead of slots). |
| A4 | **Waitlist.** "Slot offered to 3 patients on the waitlist", "Nora Ali took the slot". The architecture lists waitlist under "Later"; no table exists. | Out of v1. Waitlist wording removed from v1 screens and from the patient cancel page. D-024. |
| A5 | **Public booking.** Settings show a "Booking link for patients", and the recall text says "Book a time that suits you: {link}". That is online self-booking, which nothing supports. | The recall link opens a "request a visit" page that creates a front-desk task. No public booking link in v1. D-024. |
| A6 | **Orthodontics.** The demo tracks braces visits ("visit 8 of 24"), aligner switches, patient "I've switched" and "aligner doesn't fit". The data model only has `AlignerSeries`, and the architecture puts aligners in "soon after". | One generic "treatment course" in v1.1. D-032. |
| A7 | **Money dashboard.** "Brought in by Chairside this month: $14,860", "23 no-shows prevented", "was 11.4 % before Chairside". Needs prices, an attribution rule, and a baseline from before the clinic used the product. None exist, and "prevented" is a guess. | v1 shows measured facts only. Estimates later, with a visible formula. D-034. |
| A8 | **Treatment plan on the patient's phone** opens straight from the appointment link, with prices. The architecture requires a second check before any health information. | Plan page comes in v1.1 behind the second check. D-026. |
| A9 | **Offers and promotions** rule and "214 patients opted in". Campaigns are "Later" in the architecture. | Out of v1. The consent data is collected from the start so campaigns can come later. |
| A10 | **Manual sends:** "Nudge", "Send test to my phone", "Send plan to patient". No path for a staff-triggered one-off message was designed. | Manual nudge is in v1 (it goes through the normal pipeline). Test send and plan send are v1.1. |

## B. The architecture requires things the demo has no screen for

| # | Missing in the design | Resolution |
|---|---|---|
| B1 | Login, two-factor setup, accepting an invite, password reset, session timeout. The demo has a "signed in as" switcher instead. | Built in E00 and E04 following the design tokens. |
| B2 | **Failed messages and invalid contacts.** "Nothing fails silently" is a core rule, but the demo never shows a failure. | "Needs attention" panel on Today; warning on the patient profile. D-035. |
| B3 | Where the front desk sees work created by others: the dentist's "sent to the front desk to book", a patient's change request. | Same panel, backed by a `tasks` table. D-035. |
| B4 | Second-check screen, expired/invalid link page, "too late to cancel, please call" state. | Part of E02 patient pages. |
| B5 | Import: undo, the "we have proof of consent" confirmation, the question about ambiguous date formats. | Part of E04. |
| B6 | Upcoming (not yet sent) messages per patient. | Patient profile shows planned messages. E02-T12. |
| B7 | Audit log viewer for owners. | E07-T01. Logging itself starts in E00. |
| B8 | Opt-out page and consent history. | E03-T07 (page), E02-T05 (history). |
| B9 | Closed days and holidays (the architecture lists this as "not covered yet"). | Settings, E01-T08. Used by quiet hours (D-029). |
| B10 | How a clinic is created; how the operator supports a clinic. | Script in v1 (D-042). Support access: Q-12. |
| B11 | Patient data export and anonymisation. | E07-T05. |

## C. The data model cannot hold what the demo shows

| # | Finding | Resolution |
|---|---|---|
| C1 | **Appointment statuses differ.** Architecture: booked, confirmed, completed, cancelled, no_show. Demo adds "No reply yet", "In the chair", and lunch blocks stored as appointments. | One list; "no reply" derived; breaks in their own table. D-018. |
| C2 | **Dentist vs. chair.** The architecture books a dentist *and* a chair per appointment. The demo has one column per person; its "Chair" dropdown actually lists dentists. | Provider is the column, chair is a label. D-019. |
| C3 | **Double booking.** Architecture: impossible by constraint. Demo: "Overlaps with … You can still book it." | Constraint plus explicit override. D-020. |
| C4 | **Roles.** Architecture: owner, dentist, front_desk, assistant. Demo: owner, dentist, hygienist, front desk; two front-desk people with different rights; an owner who is also a dentist. | D-021. |
| C5 | **Who approves aftercare.** Architecture: only roles with a clinical permission. Demo: the front desk approves an AI draft and it is saved as the clinic's template. | D-022, later replaced by D-051: only dentists approve. |
| C6 | **Channels.** Architecture: an ordered fallback list. Demo: "SMS / Email / Both". | D-023. |
| C7 | **Care plans.** Architecture: several per patient. Demo: "each patient belongs to one care plan". Neither says which visit resets the recall clock. Reminder settings sit on the plan in the demo and on the rule in the architecture. | D-031; settings live on the care plan, the rule is the on/off switch and the text. |
| C8 | **Children.** "Messages go to the parent", "a follow-up went to Liam and his parent". No guardian exists in the model. Duplicate detection by phone number would merge siblings. | D-033. |
| C9 | **Aftercare templates.** One `body` field vs. the demo's SMS text + intro + do + avoid + call-us-if. Demo matches templates by searching text ("extraction"). | Structured content, linked to treatment type. D-036. |
| C10 | **Message approval state.** The architecture puts `awaiting_approval` on the message row. | Drafts are their own table; a message row exists only after approval. D-036. |
| C11 | **Missing fields and tables:** date of birth (needed for duplicates and the second check), patient notes and status, guardian, prices, appointment source and cancel reason, tasks, closed days, breaks, raw webhook events, second-nudge step, staff invites, what was done in a visit. | All added in `data-model.md`. |
| C12 | **Template variables.** `{{first_name}}`, `{{appt_time}}` vs. `{first_name}`, `{date}`, `{time}`. | D-038. |
| C13 | **Reminder timing.** Architecture: offset plus a local send time ("day before at 18:00"). Demo's editor: only "1 days before". | Both: a day-offset rule also has a time of day. `messaging.md`. |

## D. Weak spots with real clinics and real data

| # | Finding | Resolution |
|---|---|---|
| D1 | **4-character links** (`hsd.link/a/8Kq2`) can be guessed. | D-025. |
| D2 | **Health details in plain SMS.** "after your extraction…", "you still have 1 filling and a deep cleaning planned". The architecture itself says a forwarded reminder must not reveal health information. | D-027, Q-06. |
| D3 | **"Reply STOP" with a named sender.** A sender shown as "HarbourDent" cannot receive replies. | D-028. |
| D4 | **Quiet hours break Monday reminders.** "No messages on Sundays, wait until next morning" delivers the reminder when the appointment starts. | D-029. |
| D5 | **The post-import blast.** The demo celebrates "Send recall to 388 overdue patients". As designed, the planner would do that by itself the moment the import commits: unchecked numbers, real cost, no consent review. | D-030. |
| D6 | **No brake on sending.** Nothing limits how many messages a bug can send. | D-030. |
| D7 | **Patient name sent to the AI.** The demo's rewrite buttons send text with the first name already filled in, and call the AI from the browser. | D-037. |
| D8 | **Stale aftercare.** A draft approved two days late still sends "bite on the gauze for 30 minutes". | Drafts expire. D-036. |
| D9 | **Message pile-up.** Recall, treatment follow-up and promotion can hit one patient in the same week. | D-039. |
| D10 | **Nobody can stop reminders; no way to mark a patient deceased or inactive.** | D-040. |
| D11 | **"Opened" statuses** imply email tracking pixels, which the architecture's privacy rules exclude. | Only our own link opens are recorded. D-034. |
| D12 | **Marketing consent from a spreadsheet column** ("Newsletter? yes" becomes "214 agreed to offers") with no proof. | The wizard requires the clinic to confirm it holds proof; otherwise consent is "unknown" = no. E04. |
| D13 | **US formats and English only** in the demo; the architecture's examples are Serbian. | D-015, Q-01, Q-10. |
| D14 | **"The calendar updates itself"** when a patient confirms. No mechanism was described. | Polling. D-041. |
| D15 | **Fonts loaded from Google** in the demo. | Self-hosted. D-009. |
| D16 | **File storage** adds a service and a sub-processor for 10 MB spreadsheets. | Dropped in v1. D-008. |
| D17 | **Moved or clinic-cancelled appointments:** does the patient get told? Neither file says. | Staff tell the patient in v1; automatic notices in v1.1. D-045. |
| D18 | **The design files cannot be read by agents.** Both are compressed bundles (gzip + base64 inside one HTML file). | Readable copies in `design/unpacked/`. D-046. |
| D19 | **Shared phones.** A "STOP" from a family phone would hit every patient with that number. | Opt-out is per link and per patient. D-033. |
| D20 | **Per-clinic email sender setup** (domain records) is listed as a gap in the architecture and has no flow. | Onboarding checklist in E03; a shared sending domain is the fallback. |

## What was kept unchanged from the architecture

Plan first, send second, with a unique key per message. The two-stage planner and dispatcher.
The "transactional outbox" (job written in the same transaction as the change). The adapter
interface with a fake adapter. Hashed link tokens, read-only GET, POST for actions. The
aftercare template library with AI only as a first-draft tool. Import through a staging area
with review and undo. Shared database with Row-Level Security. Append-only audit log. The
testing guide (pure functions, injected clock, DST cases, nightly canary). The "before real
patient data" list. All of it is carried into the architecture documents here.

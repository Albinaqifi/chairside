# Data model

The target schema for version 1. Tables are **created by the epic that first needs them**
(D-016); this document is the design they follow.

**Changing this model** (new table, new column, changed meaning) is never done silently:
update this file and add a decision-log entry in the same change, and flag it for the owner's
decision (agent rules 4 and 11).

## Conventions

- Table and column names: `snake_case`, tables plural.
- Primary key: `id uuid`. Time-ordered UUIDs (v7) so indexes stay compact.
- **Every tenant table has `clinic_id uuid not null`**, a Row-Level Security policy on it, and
  a unique `(clinic_id, id)`. Foreign keys to tenant tables include `clinic_id`.
- Moments in time: `timestamptz`. Calendar dates: `date`. Never `timestamp` without zone.
- Every table: `created_at`, and `updated_at` where rows change.
- Lists of allowed values (statuses, roles) are Postgres enums or text with a check constraint.
- Phone numbers are stored in E.164 format (`+381641234567`). Emails lower-cased.
- Money: integer minor units (cents) plus the clinic's currency. Optional everywhere in v1.
- No personal data in `jsonb` "metadata" columns of logs and events: ids and codes only.

Legend for the "When" column: the epic that creates the table.

---

## 1. Clinics and staff

| Table | Key fields | Notes | When |
|---|---|---|---|
| `clinics` | name, timezone (IANA), locale, currency, default_country, phone, address, email, status (active / paused), settings | The tenant. `settings` holds: quiet hours (start, end, quiet weekdays), default send time, cancel cut-off hours, enabled channels, SMS sender name, email from / reply-to, frequency-cap days, daily and monthly SMS caps. Read through a typed, validated accessor, never as raw JSON. | E00 |
| `users` and auth tables | email, name, 2FA state, sessions | Managed by Better Auth: `users`, `sessions`, `accounts`, `verifications`, `rate_limits`. **Global, no `clinic_id`** (on the meta-test allow-list, D-062). | E00 |
| `memberships` | clinic_id, user_id, role, extra_permissions[], provider_id?, status (active / disabled) | Role: `owner`, `dentist`, `hygienist`, `front_desk`. Extra permissions: `import`, `export`. `provider_id` links a person to their calendar column (added by E01-T01a, when providers exist). One person can belong to several clinics; which clinic a session acts for is resolved from this table on every request (D-062). | E00 |
| `staff_invites` | clinic_id, email, role, token_hash, expires_at, accepted_at | Only the hash of the invite token is stored. | E04 |
| `audit_log` | clinic_id, at, actor_type (user / patient_link / system), actor_id, action, entity_type, entity_id, metadata | **Append-only**: the app's database role may insert, never update or delete. Records logins, patient record views, edits (with old → new field names, not values of health fields), exports, imports, approvals, link use. | E00 |
| `clinic_hours` | clinic_id, weekday, opens, closes | Opening hours per weekday. Missing weekday = closed. | E01 |
| `closed_days` | clinic_id, date, label | Holidays. Used by the calendar and by quiet-hours logic. | E01 |

### Permissions (checked on the server for every action)

`calendar.manage`, `patients.manage`, `visit.record`, `aftercare.approve`,
`automations.manage`, `import.run`, `export.run`,
`staff.manage`, `settings.manage`, `audit.view`, `results.view`.
The role → permission table is in `scope-v1.md` ("Navigation and roles").
`aftercare.approve` belongs to the dentist role, and to an owner whose membership is linked
to a provider of kind dentist. Nobody else has it (D-051).

---

## 2. Scheduling and patients

| Table | Key fields | Notes | When |
|---|---|---|---|
| `providers` | clinic_id, name, short_name, kind (dentist / hygienist / other), chair_label, color_hue, active, sort_order | One calendar column each. | E01 |
| `provider_breaks` | clinic_id, provider_id, weekday, starts, ends, label | Weekly repeating breaks (lunch). Shown hatched on the calendar. Not appointments. | E01 |
| `treatment_types` | clinic_id, name, default_duration_min, default_price?, needs_aftercare, aftercare_priority, active | The clinic's catalogue. `aftercare_priority` picks the main treatment when a visit had several. | E01 |
| `patients` | clinic_id, first_name, last_name, date_of_birth?, phone_e164?, email?, language, guardian_name?, notes, status (active / archived / deceased), phone_invalid_at?, email_invalid_at?, whatsapp_status (unknown / available / unavailable), whatsapp_checked_at?, import_job_id?, deleted_at?, anonymised_at? | No login. When `guardian_name` is set, the contact details are the guardian's and messages address them. `notes` is an administrative note, labelled "not a clinical record". Name and phone search uses a trigram index. `import_job_id` is added with `import_jobs` (E04-T01, D-091). | E01 |
| `appointments` | clinic_id, patient_id, provider_id, treatment_type_id?, title, starts_at, ends_at, status, overlap_ok, source (staff / recall_link / patient_request / walk_in), source_message_id?, note, confirmed_at?, confirmed_via (link / staff)?, cancelled_at?, cancelled_by (patient / staff)?, cancel_reason?, completed_at?, created_by | `title` is the label on the calendar ("Filling 36"). `source_message_id` records which message led to the booking (for "recalls that became bookings"); it is added with `messages` (E02-T01, D-091). | E01 |

### No double booking

```
EXCLUDE USING gist (clinic_id WITH =, provider_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
WHERE (status NOT IN ('cancelled', 'no_show') AND NOT overlap_ok)
```
Staff "book anyway" sets `overlap_ok = true` on that one appointment (D-020). Patient-driven
bookings can never set it.

### Appointment state machine

| From | To | Who |
|---|---|---|
| booked | confirmed | patient (link) or staff |
| booked, confirmed | arrived | staff |
| booked, confirmed | cancelled | staff; patient (link) only before the cut-off |
| booked, confirmed | no_show | staff, only after the start time |
| booked, confirmed, arrived | completed | staff |
| arrived | booked or confirmed (undo) | staff |
| cancelled, no_show | booked (restore) | staff; re-checks the overlap rule |
| completed | arrived (undo) | staff, same day, and only while no aftercare was sent |

Anything else is rejected. One pure function decides; every transition is audit-logged and
triggers re-planning of messages. "No reply yet" is **derived**: status `booked` and a
reminder was sent.

---

## 3. Messaging

Rules for how these tables are used are in `messaging.md`.

| Table | Key fields | Notes | When |
|---|---|---|---|
| `automation_rules` | clinic_id, trigger, enabled, offset_value, offset_unit, send_time_local?, channels[] (ordered, D-055), settings | One row per trigger per clinic in v1. Triggers: `booking_confirmation`, `appointment_reminder`, `recall`, `no_show_followup`, `aftercare`. `settings`: late-booking policy, minimum lead, etc. | E02 |
| `message_templates` | clinic_id, rule_id, channel, language, subject?, body, version, is_current, provider_template_name?, provider_variables?, approval_status? | Text per rule, channel and language. Editing creates a new version. For WhatsApp: the provider's template name, variable order and approval status (`pending` / `approved` / `rejected`); the body is the local copy of the approved text. | E02 (provider fields used from E03) |
| `messages` | clinic_id, patient_id, trigger, step, rule_id?, appointment_id?, aftercare_draft_id?, channel (whatsapp / email / sms), to_address, idempotency_key, status, scheduled_for, attempts, template_id?, rendered_subject?, rendered_body?, sms_parts?, provider?, provider_message_id?, error_code?, skip_reason?, link_id?, is_test, sent_at?, delivered_at? | **The key table.** Every outgoing message, past and future. `UNIQUE (clinic_id, idempotency_key)`. Status: `pending, sending, sent, delivered, failed, skipped, cancelled`. Index on `(status, scheduled_for)`. | E02 |
| `message_events` | clinic_id, message_id, status, occurred_at, source (planner / dispatcher / webhook / staff), code? | Append-only history of each message. | E02 |
| `webhook_events` | provider, provider_event_id (unique), received_at, payload, processed_at?, clinic_id? | Raw provider callbacks, stored before processing. Not tenant-scoped on arrival (allow-list). Payload deleted after 30 days. | E03 |
| `inbound_messages` | clinic_id, patient_id?, channel, provider_message_id, in_reply_to_message_id?, kind (opt_out / button / text), body?, received_at, handled_at? | Replies from patients (WhatsApp in v1). An opt-out word writes consent rows; text creates a `patient_replied` task. No conversation UI. Body deleted with the message-text retention rule. | E03 |
| `patient_links` | clinic_id, token_hash (unique), purpose, patient_id, appointment_id?, message_id?, expires_at, first_opened_at?, last_used_at?, failed_attempts, revoked_at? | Purposes in v1: `appointment`, `visit_request`, `aftercare`, `opt_out`. Only the SHA-256 hash of the token is stored. | E02 |
| `consents` | clinic_id, patient_id, purpose, channel (whatsapp / sms / email / all), allowed (bool), source (staff / import / link / paper_form / reply), source_detail?, recorded_by?, recorded_at | **One row per decision, never overwritten.** The current answer is the newest row for a purpose and channel. Purposes: `transactional` (default allowed), `care_followup` (default allowed), `marketing` (default **not** allowed). | E02 |
| `tasks` | clinic_id, type, patient_id?, appointment_id?, message_id?, payload, status (open / done / dismissed), created_by_type (staff / patient / system), done_by?, done_at? | Things a person must tick off. Types: `call_unconfirmed`, `patient_cancelled`, `change_request`, `visit_request`, `book_followup`, `failed_message`, `invalid_contact`, `unreachable`, `patient_replied`, `cap_reached`. | E02 |

**Changed from the original:** there is no `awaiting_approval` message status. Aftercare
approval lives on `aftercare_drafts`; a message row is created only once approved (D-036).

---

## 4. Import

| Table | Key fields | Notes | When |
|---|---|---|---|
| `import_jobs` | clinic_id, filename, file_bytes?, mapping, options, status, counts, created_by, committed_at?, undo_until? | Status: `uploaded, parsed, mapped, validated, committed, undone, failed`. `file_bytes` is cleared at commit or after 30 days (D-008). `options`: date format, missing-mobile policy, "we hold proof of consent". | E04 |
| `import_rows` | clinic_id, import_job_id, row_number, raw, normalized, problems, duplicate_of_patient_id?, duplicate_of_row?, decision (import / skip / merge), created_patient_id? | The staging area. Nothing touches `patients` until commit. Deleted 30 days after commit. | E04 |

The saved column mapping per clinic lives in clinic settings.

---

## 5. Recalls

| Table | Key fields | Notes | When |
|---|---|---|---|
| `care_plans` | clinic_id, name, interval_value, interval_unit (days / weeks / months), is_default, lead_days, second_nudge_after_days?, active | "Standard checkup, every 6 months, remind 28 days before, nudge 14 days later". Exactly one default per clinic. | E05 |
| `care_plan_treatment_types` | clinic_id, care_plan_id, treatment_type_id | Which completed treatments reset this plan's clock. | E05 |
| `patient_care_plans` | clinic_id, patient_id, care_plan_id, last_visit_on?, next_due_on?, active, recall_paused, paused_reason? | The schema allows several per patient; the v1 UI keeps exactly one active (D-031). `recall_paused` is the start gate (D-030). `next_due_on` is a `date`. | E05 |

---

## 6. Treatment and aftercare

| Table | Key fields | Notes | When |
|---|---|---|---|
| `treatment_plans` | clinic_id, patient_id, status (active / completed / cancelled), created_by | v1: at most one active plan per patient. | E06 |
| `plan_items` | clinic_id, plan_id, treatment_type_id, tooth?, label, price?, status (planned / scheduled / done), appointment_id?, done_at?, sort_order | `tooth` is an FDI two-digit number. | E06 |
| `visit_treatments` | clinic_id, appointment_id, treatment_type_id, tooth?, plan_item_id? | What was done in a visit: the wrap-up's output. **Deliberately no clinical detail** (D-017). | E06 |
| `aftercare_templates` | clinic_id, treatment_type_id, language, version, status (draft / approved / archived), source (ai / manual), content, approved_by?, approved_at?, model?, prompt_version? | `content` = `{ sms, intro, dos[], donts[], call_if[] }` with placeholders. Editing an approved template creates a new version. One approved current version per treatment type and language. | E06 |
| `aftercare_drafts` | clinic_id, appointment_id, patient_id, treatment_type_id, source (template / ai), template_id?, content, status, expires_at, save_as_template, approved_by?, approved_at?, model?, prompt_version?, tokens_used? | Status: `generating, awaiting_review, approved, discarded, expired, failed`. `content` keeps placeholders; names are filled only when rendering. One draft per appointment. | E06 |

---

## 7. Not in version 1 (do not create)

| Table | For | Version |
|---|---|---|
| `treatment_courses`, `course_events` | Braces visits and aligner switches | v1.1 |
| link purposes `plan_view`, `course` and a second-check session | Patient plan and aligner pages | v1.1 |
| `campaigns` | Promotions | v2 |
| `waitlist_entries` | Waitlist | v2 |
| chairs as resources, provider working hours | Chair conflicts, live availability | v2 |
| charting, clinical notes, medical alerts | Clinical record | only if Q-02 says so |
| subscriptions, invoices | Clinic billing | v2 |

## Retention (enforced by jobs in E07)

| Data | Kept |
|---|---|
| Import file bytes and staging rows | 30 days |
| Raw webhook payloads | 30 days |
| Rendered message text | 24 months, then only date, channel, status |
| Expired patient links | deleted 30 days after expiry |
| Audit log | long (period agreed with clinics, Q-06) |
| Patient records | the clinic decides, within the law; "erase" anonymises (name and contact removed) rather than deleting history |

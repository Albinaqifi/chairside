# Security and privacy

Dental records are health data: a "special category" under GDPR with stricter rules.
The first market is North Macedonia (D-049), which is outside the EU and has its own data
protection law modelled on GDPR. We build to GDPR standard.
The **clinic is the controller** (it decides why data is processed). **We are the processor**
(we process it for the clinic). Most duties below come from that.

This document has two parts: rules that code must follow, and the gate before real patient data.

---

## Part 1 — Rules for code

### 1. Tenant isolation
- Every tenant table: `clinic_id` + Row-Level Security policy. The meta-test enforces it.
- All database access happens inside a tenant transaction opened by the standard wrappers.
  Never create a database connection or query outside them.
- The app's database role cannot bypass Row-Level Security, cannot change schema, cannot
  update or delete audit rows. On a host, the web's health check (`/api/health`) fails while
  `DATABASE_URL` logs in as a role that can get past the policies: a superuser, one with
  `BYPASSRLS`, a table's owner or a member of one, so such a web never goes live (E00-T07a); the
  worker does not start with such a login (E00-T07b). A role set when the login connects
  (`options=-c role=…` in the URL, or `ALTER ROLE … SET role`) does not get round it: the check
  asks of the login itself too, to which one `SET ROLE NONE` goes back (E00-T07e).
- The job queue's tables (pg-boss, D-005) are shared by every clinic and have no policy: a job's
  data holds ids and codes only, never a patient's details, and its handler works inside its
  clinic's tenant transaction (D-102). A failed job keeps a code: its error goes to the logger,
  never into the job's row (D-104).
- Cross-clinic lookups exist only as a few named database functions (list a user's clinics at
  login: `clinics_for_user`, D-062; resolve a link token; list clinics for the planner; claim due
  messages). Adding one is a critical change.
- Ids from the client are never trusted to belong to the current clinic: the policy and the
  composite foreign keys decide.

### 2. Login and permissions
- Passwords, sessions and 2FA come from the auth library. Never hand-rolled.
- Outside the local seed, a person chooses their own password, through a one-time link: nobody else
  ever knows it. `clinic:create` prints one for a clinic's first owner (D-101). Its token has at
  least 128 random bits, only its SHA-256 hash is stored, it works once and for 3 days, and it sits
  after `#`, so no request log holds it; a used, expired or wrong link gets one and the same answer.
- `addMembership()` and `createSetupLink()` (`src/modules/auth/`) make a member of any role and a
  new password for any person. Only `clinic:create` calls them; a staff action that does (E04-T02)
  declares `staff.manage`, the owner's alone, and its review checks every caller (E00-T05b critical
  review).
- 2FA is mandatory for owners and for anyone with the `export` or `import` permission.
- Every server action declares the permission it needs; the wrapper checks it. Hiding a
  button in the UI is never the check.
- An action runs only in the clinic its page was shown for. The form sends that clinic's id, the
  one its frame names (the staff layout's, never one a page passes, D-092), and the wrapper refuses
  when the request now resolves to another clinic (another tab switched, a membership was
  disabled). The id grants nothing; memberships decide (D-069).
- Every page checks the session itself (`currentStaff()`, or `requireUser()` before a clinic is
  chosen), or is public on purpose and says so. The request proxy is not the check: it lets a
  signed-out POST that looks like a server action through without a redirect, and a later Next.js
  could render the page for it (D-074, D-075).
- Sessions end after 30 minutes of inactivity (clinic computers are shared).
- Login and 2FA attempts are rate-limited.

### 3. Patient links (no-login pages)
- Token: at least 128 random bits, URL-safe. Only its SHA-256 hash is stored.
- One token = one patient, one purpose, one expiry. Appointment links expire when the
  appointment ends; aftercare links after 14 days.
- **GET never changes anything.** Mail scanners and chat previews open links automatically.
  Actions are buttons that POST.
- Actions are idempotent: pressing Confirm twice gives the same result.
- "Not found", "expired" and "revoked" look identical to the visitor.
- Rate limits per IP and per token. No staff cookies, no third-party scripts, no analytics,
  `noindex`, and a strict `Referrer-Policy` so the URL does not leak.
- Link-only pages show the minimum: first name, date and time, provider, clinic. No treatment
  details, except the aftercare page (D-026, D-027).
- Anything health-related beyond that needs a second check (date of birth or a code sent to
  the phone on file; 5 wrong tries lock the link). That is v1.1.
- "Send me a new link" only ever sends to contact details already on file.

### 4. The AI boundary
- The AI is called only from the worker, only through the aftercare module's prompt builder.
- **Sent:** treatment type name, language, the clinic's tone notes. **Never sent:** name,
  phone, email, date of birth, any id, appointment dates, notes, history.
- Rewrites ("shorter", "simpler") operate on template text with placeholders (D-037).
- The response must match a strict schema. Anything else is rejected, never shown as a draft.
- Every AI-written text is labelled as such until a dentist (D-051)
  approves it. Approval is audit-logged with who and which text version.
- Model name and prompt version are stored with each draft and template.
- Treat AI output as untrusted input: it is text to display, never instructions to follow,
  never HTML to render unescaped.

### 5. Consent and objections
- Consent is history, not a flag: one row per decision, with date and source.
- Marketing: only with a recorded yes. Unknown means no.
- Care follow-ups and transactional messages: allowed until the patient objects; every
  care follow-up carries an opt-out link.
- Checked again at send time, not only when planning.
- Import never invents consent (see the import wizard's proof tick).

### 6. Logging and errors
- **No patient data in logs, error reports, analytics or traces.** No names, phones, emails,
  message bodies, tokens. Log ids and codes.
- The logger and the error tracker strip known personal fields before anything leaves the
  process. A test proves it with canary values.
- A failed query's error carries no values: they are removed where the error is made (the auth
  library's adapter, `withTenant`, `clinicsForUser()`), because a framework can print an error our
  logger never sees (D-066, D-070). Keep a caught error as `cause`; never copy its message into a
  new error or a string.
- Error messages shown to users never include internals; errors shown to patients never say
  whether a record exists.

### 7. Secrets and configuration
- Secrets live in the host's secret store and in a local `.env` that is never committed.
  `.env.example` lists every setting, with local-only values that are not secrets (D-064, point 2);
  a real secret never appears in it.
- Agents do not read or print `.env` files.
- Production credentials never exist on a development machine.
- The app's image holds no `.env` file and no secret, and is built without either: every setting
  comes from the host (D-103). Over https, as the auth library reads `BETTER_AUTH_URL` (a space or
  a line break before it, or `https:/host`, too), the library never starts with `.env.example`'s
  secret or one shorter than 32 characters, spaces and line breaks around it not counted, nor while
  `BETTER_AUTH_SECRETS` is set, a list it would sign with in that secret's place; so no session is
  made, and the health check fails (E00-T07a).
- `BETTER_AUTH_URL` is the only origin a sign-in may come from (D-063). The auth library also reads
  `BETTER_AUTH_TRUSTED_ORIGINS` itself and would take a sign-in from each origin in it, which lets a
  site served over https get past an http `BETTER_AUTH_URL`, and so past every refusal above: over
  http as over https, the library never starts while it is set (an empty one is not set), and the
  health check fails (E00-T07e). `.env.example` never holds it.

### 8. Web basics
- HTTPS everywhere, secure and http-only cookies, CSRF protection on every state-changing
  request, security headers (content security policy, frame denial). A cookie the app sets itself
  (the clinic picker's) is Secure exactly when the auth library's own are: both read
  `BETTER_AUTH_URL` as the WHATWG URL parser does, however it is written (E00-T07e).
- All input parsed with Zod at the edge. All output escaped by React; no raw HTML from data.
- A form never puts its fields in the URL: it posts to a URL named in its `action`, or takes a
  function as its action. The login form's submit button stays disabled until the page's script
  has run, and login needs JavaScript (D-076).
- A staff form keeps nothing in the browser: `autocomplete="off"` on `StaffForm`'s form and no
  field in it with an `autocomplete` of its own, so no browser brings its fields back after a
  reload or Back, under another clinic either, or offers past entries in them (D-093, D-095). A
  field outside a staff form that takes patient details (a search box) is `autocomplete="off"`
  itself, and a search's words go in the request's body, never in the page's address, which the
  browser's history and the host's request log keep (D-095).
- Webhooks verify the provider's signature before doing anything.
- File uploads: size limit, type check, parsed in the worker, never executed or served back.
- Dependencies: lockfile committed, automated vulnerability check in CI (an advisory in a
  production dependency turns the run red, D-075).

### 9. Data in non-production (D-044)
- Synthetic data only: generated names, phone numbers from ranges reserved for testing,
  emails at `@example.test`. No range is reserved for `+389`, so the seed takes its phones from one
  made-up block, written down with the other fake-data rules in `src/db/seed/fake-data.ts`; the
  allow-list below is what keeps anything from being sent to them (E00-T05a).
- The seed's check (`fake-data.test.ts`) reads each name field on its own, and free text (a title,
  a note, a label) only for phones and emails. A reviewer of a seed file checks that each person's
  names share one script and that free text holds no name off the invented lists (E01-T01b).
- Never copy production data down, not even "anonymised by hand".
- Outgoing messages outside production reach only an allow-list of test contacts.

### 10. Audit
- Logged: logins, patient record views, creates/edits/deletes, exports, imports, approvals,
  consent changes, patient link use, permission changes.
- A patient record view is one patient's record opened: the profile or its edit page (E01-T03a, E01-T03b),
  one row per view. A list or a search of patients is not one (the patient list, the booking
  drawer's search, a likely-duplicate warning): it writes no row, and what was typed is never
  written anywhere (D-098).
- Append-only, enforced by database permissions.
- Owners can read it, filtered by patient, person and date.

### 11. Retention and deletion
- See the retention table in `data-model.md`.
- "Erase a patient" anonymises (removes name and contact, keeps history rows) because
  medical-record law usually forbids full deletion. The clinic decides; we provide the tool.
- Deleted data survives in backups until they expire (30 days). This is written in the
  agreement with the clinic.

---

## Part 2 — The gate before real patient data

Nothing below is optional. Task E07-T09 walks through it; the owner signs it off.

### Technical (agents build, owner verifies)
- [ ] Hosting and database in the EU; encryption at rest confirmed with the host
- [ ] Daily backups with point-in-time recovery; **one restore actually performed**
- [ ] Tenant isolation test suite and meta-test green
- [ ] 2FA enforced for owners
- [ ] Audit log writing verified for every action in the list above
- [ ] No-personal-data-in-logs test green; error tracker scrubbing verified
- [ ] Sending caps and kill switch tested
- [ ] Nightly canary and worker heartbeat alerting to the operator
- [ ] Retention jobs running
- [ ] Patient export and anonymise tools working
- [ ] Security review pass done (E07-T06), findings fixed or accepted in writing
- [ ] Runbook: what to do when messages stop, the database is down, a breach is suspected

### Legal and business (owner does, Q-06)
_Owner note, 2026-10-02 (D-052): the legal review is deferred and blocks no build work. The
items stay listed so that going live without them is a conscious choice at that time._
- [ ] Data processing agreement signed with the clinic
- [ ] Sub-processor list: host, WhatsApp (Meta and any partner), email, AI, error tracking; each with location and agreement
- [ ] Record of processing; impact-assessment template for the clinic
- [ ] Legal basis for recalls confirmed for the country; message wording reviewed
- [ ] Record-retention rule for the country known and reflected in settings
- [ ] Terms of service, support contact, breach-notification procedure (clinics must notify
      the authority within 72 hours; we must tell the clinic without delay)
- [ ] WhatsApp business verified, templates approved, opt-in confirmation recorded; email domain records (SPF, DKIM, DMARC) set

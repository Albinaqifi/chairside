# Open questions

Decisions that belong to the owner. **Agents never guess these.** If a task depends on an
unanswered question, the task is not Ready; stop and ask.

Each question has a **working assumption** so planning can continue. An assumption is not an
answer: nothing irreversible may be built on it.

When answered: write the answer here, mark it **Answered (date)**, and add a decision to
`decisions.md` if it changes anything.

| ID | Question | Needed before | Status |
|---|---|---|---|
| Q-01 | First country / market | E03 (real channels), any legal text | **Answered 2026-10-02: North Macedonia** (D-049) |
| Q-02 | Replace the clinic's old system, or run next to it? Will charting ever be in scope? | Pilot conversations; any work beyond D-017 | **Answered 2026-10-02: replace it; charting maybe, decide after the pilot** (D-050) |
| Q-03 | Product name, domain, short-link domain | E02-T08 (links; a temporary domain is fine until go-live) | Open |
| Q-04 | How clinics pay, and how SMS is charged | E03-T05 (caps and usage screen) | Open |
| Q-05 | Who may approve aftercare | E06-T08 | **Answered 2026-10-02: dentists only** (D-051) |
| Q-06 | Legal review: recalls, health details in messages, retention, hosting outside the country | Go-live with a real clinic | **Deferred by the owner 2026-10-02**: not now, keep building (D-052) |
| Q-07 | Is a US-owned host with an EU region acceptable? | E00-T07 (staging) | Open: owner does not know yet (2026-10-02). Staging goes ahead on Render. |
| Q-08 | Which WhatsApp route (direct or partner) and which email provider | E03-T01 | Open (E03-T01 can run now) |
| Q-09 | Is there a pilot clinic? What do they use today? | E04 (import priorities), v1.1 order | Open: owner does not know yet (2026-10-02) |
| Q-10 | Languages for the staff app and patient messages | E00-T04 (first locale), E02 templates | **Answered 2026-10-02: English only during development; owner translates after v1** (D-053) |
| Q-11 | Can every staff member see every patient of the clinic? | E01-T02 | Assumed yes (D-021) |
| Q-12 | How does the operator access a clinic's data for support? | E07 | Open |
| Q-13 | Are Anthropic's API data terms acceptable? | E06-T05 | Open |
| Q-14 | Cancel-by-link: allowed, and what cut-off? | E02-T09 | Assumed: allowed, 24 h default, per-clinic setting |
| Q-15 | How are children / guardians handled in the pilot country? | E01-T01 (patient fields) | Assumed (D-033) |
| Q-16 | GitHub for code and CI? | E00-T01 | Assumed yes (D-014) |
| Q-17 | SMS in the real alphabet (Cyrillic, ë, ç) or in plain Latin letters? | E03-T10 (SMS, when added) | **Answered 2026-10-02: plain Latin** (D-054); applies to SMS only, WhatsApp carries Cyrillic |
| Q-18 | WhatsApp sender: one product number for all clinics, or one number per clinic? | E03-T01, E03-T03 | **Answered 2026-10-02: one product number** (D-056) |

---

## Details

### Q-01 · First country / market — Answered 2026-10-02
**Answer: North Macedonia.** Consequences are recorded in D-049. In short: time zone
`Europe/Skopje`, phone country `+389`, currency MKD; the country is outside the EU with its own
data protection law modelled on GDPR; it opens Q-17 (SMS alphabet) and narrows Q-10 (languages).

_Original question:_ the architecture's examples pointed at Serbia, the demo used US formats.
The country drives language, SMS provider and price, sender-name rules, record-keeping law,
privacy law and currency.

### Q-02 · Positioning — Answered 2026-10-02
**Answer: "replace it, maybe".** Recorded as: Chairside **replaces** the clinic's current
scheduling tool (it is the calendar and patient list of record, no syncing with other
software). Charting and clinical notes are a **maybe**: not in version 1, not ruled out,
decided after the pilot. See D-050.

What this means in practice:
- Version 1 as planned is right (D-017 stands).
- The first customers are clinics on paper, Excel or a simple calendar. A clinic that relies
  on full practice software for charting and billing cannot fully replace it with v1.
- At switch-over a clinic already has future appointments in its old tool. Getting those in
  is new work, added to E04's refinement (see the board's Discovered list).

### Q-03 · Name and domains
"Chairside" is used as a working name. Needed: the app domain, and one short domain for
patient links (SMS length matters, even more so given Q-17). The demo's `hsd.link` looks like
a per-clinic domain, which D-025 rules out.

### Q-04 · Pricing and SMS billing
The demo shows "$149 a month" and "1,420 of 2,000 SMS used". Decide: flat plan with an SMS
bundle, or SMS passed through at cost? What happens at 100 %: stop sending, or keep sending and
bill extra? **Working assumption for building:** per-clinic monthly and daily caps that
*stop* sending and alert staff and operator (D-030); no billing code in v1.

### Q-05 · Aftercare approval — Answered 2026-10-02
**Answer: dentists.** Only dentists approve aftercare: AI drafts, drafts from a template, and
library templates. Front desk and hygienists can read drafts but not approve them.
Recorded as D-051, which replaces D-022.

Small follow-up, not blocking: under this rule a hygienist's own treatments (for example a
deep cleaning) also wait for a dentist. Say so if hygienists should approve for their own visits.

### Q-06 · Legal review (owner action, not an agent task) — Deferred 2026-10-02
**Owner: not now, keep building (D-052).** Nothing in the build waits for this, and the
working assumptions stay in force. The list is kept so it can be picked up before real
patient data goes in.

A few hours with a privacy lawyer in North Macedonia, covering at least:
1. Are recalls and treatment follow-ups "care communication" or "marketing" there? (Decides
   whether they need opt-in. v1 assumes care communication with an opt-out in every message.)
2. May message texts and the aftercare page name the treatment? (D-027.)
3. How long must dental records be kept, and what does that mean for deletion requests?
4. The data processing agreement, sub-processor list, and impact assessment template.
5. **Where the data may live.** The plan hosts patient data in the EU (Frankfurt) with a
   US-owned company (D-007). Confirm that a Macedonian clinic may keep health data there, and
   which steps (notification, contract clauses) the national law requires. If the data must
   stay in the country, hosting changes: that is a new decision.
6. Whether the AI provider, email and SMS providers need to be named to patients or to the regulator.

We build to GDPR standard in the meantime, because the national law is modelled on it.
**To verify with the lawyer, not assumed:** the exact law, its transfer rules, the regulator's requirements.

### Q-07 · Hosting company
_Owner, 2026-10-02: not known yet._ Staging is built on Render as planned; nothing is lost if the answer changes later, because everything runs from one Docker image.

D-007 picks Render (US company, Frankfurt region). Alternatives: Scaleway (French), or a
Hetzner server with more operations work. Fine to start staging on Render and decide before
real data. See Q-06 item 5: the country being outside the EU adds a question about data
leaving the country at all.

### Q-08 · Providers
Task E03-T01 produces the comparison: WhatsApp through Meta's own API or through a partner
(a partner that also offers SMS keeps the later SMS addition simple), plus an email provider.
The owner picks. Needs accounts and payment details that only the owner can create.

### Q-09 · Pilot clinic
_Owner, 2026-10-02: not known yet._ Work continues with synthetic data and the demo clinic.

Knowing one real clinic early changes priorities: their current tool decides what the import
must handle; whether they do orthodontics decides how soon the v1.1 ortho work matters; a
receptionist testing the booking flow early is the best check on front-desk speed.
Since Chairside is meant to **replace** their tool (D-050), also ask: how many future
appointments would have to be moved over, and can their tool export them?

### Q-10 · Languages — Answered 2026-10-02
**Answer: English first, translatable for later, no time spent on other languages during
development. The owner translates after version 1 is done.** Recorded as D-053.

_Original question:_ which language(s) does the staff app need, and which language(s) do patients get messages in?
For North Macedonia the realistic options are Macedonian, Albanian, or both (plus English for
development). The schema carries a language per patient and per template from the start
(D-015), so a clinic can message each patient in their own language.
The translation pass, when it happens, covers: the app's texts (one message file), the default
message templates, the aftercare library seed, and a run of the AI evals in that language.
It is a roadmap step between v1 and the first real clinic.

### Q-11 · Patient visibility inside a clinic
**Assumed:** all staff see all patients; a dentist's calendar opens on their own column.

### Q-12 · Support access
When a clinic asks for help, how do you look at their data? Options: never (screen-share only),
or a time-limited, logged "support session" the owner of the clinic grants.
**Working assumption:** screen-share only in v1; no operator login into clinics.

### Q-13 · AI provider terms
Prompts contain no patient data by design (D-037), so this is a second line of defence.
Check current retention, training and agreement terms before E06-T05, and list the provider as
a sub-processor.

### Q-14 · Cancelling by link
Some clinics want every cancellation to be a phone call. **Assumed:** cancelling by link is
on by default with a 24-hour cut-off; both are clinic settings.

### Q-15 · Children and guardians
**Assumed (D-033):** a patient record can carry a guardian name and the contact details are
the guardian's. Confirm this matches how clinics in North Macedonia record children.

### Q-16 · Code hosting
**Assumed:** private GitHub repository, GitHub Actions for CI.

### Q-17 · SMS alphabet — Answered 2026-10-02
**Answer: plain Latin letters in SMS.** Recorded as D-054: SMS text is converted to the basic
alphabet before sending (Cyrillic transliterated, `ë`→`e`, `ç`→`c`); email and patient pages
keep the real alphabet. No clinic setting in v1.

_Background:_
An SMS written only with basic Latin letters holds **160 characters** per part. As soon as
one character is outside the basic SMS alphabet, the whole message switches to a mode that
holds only **70 characters** per part. Cyrillic letters are outside it, and so are Albanian
`ë` and lower-case `ç`. A typical reminder with a link is about 150–170 characters, so:

| Written as | Parts per reminder | Cost |
|---|---|---|
| Plain Latin letters (Macedonian transliterated, Albanian without `ë`/`ç`) | 1–2 | lowest |
| Real alphabet (Cyrillic, `ë`, `ç`) | 3 | roughly 2–3 times higher |

Options: (a) always the real alphabet; (b) always plain Latin for SMS, real alphabet in email
and on patient pages; (c) a clinic setting. Many senders in the region use (b).
Decided: (b), always plain Latin in SMS, without a setting (D-054). The part counter in the
rule editor counts the converted text.

### Q-18 · WhatsApp sender number — Answered 2026-10-02
**Answer: one product number for all clinics.** Recorded as D-056. Per-clinic numbers stay a later option for clinics that ask.

_Background:_
WhatsApp messages come from a phone number with a business name attached.
- **One product number for all clinics:** one business verification, one set of approved
  templates, fastest to launch. Patients see the product's name as sender; the clinic's name
  is inside the message ("a reminder from Harbour Street Dental").
- **One number per clinic:** patients see the clinic's name; each clinic needs its own
  verification, number and template approvals, which is onboarding work per clinic.
Decided: one product number first (D-056).

# Intent

> The anchor document. Every agent reads this first. It says what we are building and why,
> not how. Only the owner (Albin) changes this file.

## In one sentence

Chairside is a scheduling app for small dental clinics that sends the right message to the
right patient at the right time by itself, so fewer patients miss visits, more of them come
back, and the front desk stops chasing people by phone.

## The problem

Small clinics lose money and time in four predictable places:

1. **No-shows and late cancellations.** An empty chair is lost revenue that cannot be recovered.
   Clinics fight this with reminder phone calls, which cost the front desk hours every week.
2. **Patients who never come back.** A patient due for a checkup only returns if someone
   remembers to contact them. On a busy day nobody does.
3. **Treatment that stalls.** A patient needs three fillings, gets one, and is never booked for
   the rest.
4. **Aftercare that is forgotten.** Instructions are given verbally while the patient is still
   numb. They forget, then call the clinic or heal badly.

The tools clinics have today either do no messaging at all (paper, Excel, old practice
software) or are generic reminder services that do not know the calendar, so staff enter
everything twice.

## Why a clinic would pay

- **It pays for itself.** Every prevented no-show and every recall that turns into a booking
  is measurable revenue. The product must be able to show this honestly: confirmation rate,
  no-show rate, recalls that became bookings.
- **It gives the front desk time back.** Reminders, recalls and follow-ups go out without
  anyone remembering them.
- **It is easy to start.** Import patients from Excel, no patient app, no patient login.
- **Patients notice.** Confirm or cancel in two taps; clear written aftercare after treatment.

## Who uses it and what they need

| User | Needs |
|---|---|
| **Front desk** (main daily user) | Book and move appointments faster than in their old tool. See at a glance who has not confirmed, who to call, what failed. |
| **Dentist / hygienist** | See their own day. Mark what was done. Approve aftercare text quickly. |
| **Clinic owner** (the buyer) | See that it works (results). Control who can access what. Trust that patient data is safe. |
| **Patient** | No app, no login. A link that opens a simple page on a phone. Messages that are relevant, not spam, and easy to stop. |
| **Operator** (Albin, one developer) | A system one person can run: few moving parts, loud failures, cheap to host. |

## Goals for version 1

1. A clinic can run its daily schedule in Chairside.
2. Appointment reminders with confirm / cancel links reduce no-shows, and the app shows it.
3. Recalls bring overdue patients back, following each patient's care plan.
4. After treatment, patients get aftercare instructions: drafted from the clinic's approved
   templates or by AI, and always approved by a person before sending.
5. A new clinic can be set up and its patients imported in about a day.
6. It is safe to hold real patient data (see Constraints).

## Constraints

- **One developer, working with AI agents.** Prefer simple, common, boring technology.
  Anything that needs constant attention is a bad fit.
- **Health data.** Dental records are a special category under GDPR. The clinic is the data
  controller, we are the processor. Data stays in the EU. One clinic must never see
  another clinic's data.
- **Multi-clinic from the first line of code.** The product is sold to many clinics.
- **Reliability is the product.** A reminder that silently does not go out is the worst bug
  we can have. Nothing may fail silently.
- **A person approves anything AI wrote** before a patient sees it. The AI never receives
  anything that identifies a patient.
- **Messages cost money.** WhatsApp and SMS are paid per message. The system must not be able to send an
  unbounded number of them by mistake.
- **Frontend is React.** The rest of the stack is recorded in `docs/log/decisions.md`.

## Non-goals (what we are deliberately not building)

- **Not full practice-management software.** No dental charting, clinical notes, X-rays,
  billing, invoices, payments or insurance in v1. (Whether some of this ever comes is an open
  question, see Q-02.)
- No patient app and no patient accounts.
- No online self-booking with live free slots, and no waitlist, in v1.
- No SMS in v1 (WhatsApp and email first; SMS is designed so it can be added at any time). No Viber.
- No marketing campaigns in v1.
- No two-way chat inbox.
- No self-service sign-up or subscription billing for clinics in v1. Clinics are set up by hand.

## How to decide when things conflict

1. Patient data safety beats everything.
2. A correct message beats a sent message. If unsure, do not send, and say so visibly.
3. Front-desk speed beats feature richness.
4. A thin slice that works end to end beats a complete layer that nobody can use yet.
5. When a choice is really the owner's (money, law, positioning), stop and ask.
   See `docs/log/open-questions.md`.

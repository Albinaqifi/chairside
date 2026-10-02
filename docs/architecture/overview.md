# Architecture overview

The system on one page. Details live in `data-model.md`, `messaging.md` and
`security-privacy.md`. Reasons for each choice are in `docs/log/decisions.md`.

## The shape

One codebase, two running processes, one database.

```
 Staff (browser)        Patients (phone, no login)   WhatsApp / email providers
       │                          │                              │
       ▼                          ▼                              ▼
 ┌───────────────────────────────────────────────────────────────────────┐
 │  WEB process (Next.js)                                                │
 │  staff app  ·  patient pages /p/<token>  ·  webhooks /api/webhooks/*  │
 └───────────────────────────────┬───────────────────────────────────────┘
                                 │ calls
                                 ▼
 ┌───────────────────────────────────────────────────────────────────────┐
 │  MODULES (plain TypeScript, no framework code)                        │
 │  tenancy · auth · audit · patients · scheduling · messaging · links   │
 │  tasks · recalls · treatment · aftercare · import · reporting         │
 └───────────────┬───────────────────────────────────────┬───────────────┘
                 │ read / write + enqueue jobs           │ same modules
                 ▼                                       │
 ┌──────────────────────────────┐          ┌─────────────┴───────────────┐
 │  PostgreSQL (EU)             │◄─────────│  WORKER process             │
 │  data + Row-Level Security   │  jobs    │  planner · dispatcher ·     │
 │  + job queue (pg-boss)       │          │  import · AI drafts · canary│
 └──────────────────────────────┘          └─────────────┬───────────────┘
                                                         │ adapters
                                                         ▼
                                      WhatsApp · Email · (SMS later) · AI API (external)
```

- The **web process** never does slow or time-based work. It writes data and, in the same
  transaction, a job. If the worker is down, jobs wait; nothing is lost.
- The **worker** is the only thing that talks to WhatsApp, email, SMS and AI providers.
- Providers report delivery back through **webhooks** on the web process.

## Stack

| Concern | Choice | Decision |
|---|---|---|
| Language, runtime | TypeScript, Node 24 LTS, pnpm | D-001 |
| Web framework | Next.js (App Router), React | D-002 |
| Database | PostgreSQL, managed, EU | D-003 |
| Queries and migrations | Drizzle ORM, SQL migrations | D-004 |
| Background jobs | pg-boss (in Postgres) | D-005 |
| Login, sessions, 2FA | Better Auth | D-006 |
| Hosting | Render, Frankfurt: web + worker + Postgres, one Docker image | D-007 |
| UI | Tailwind CSS, shadcn/ui, demo tokens | D-009 |
| Validation | Zod, on every input: forms, webhooks, AI responses | — |
| Dates and time zones | Luxon | — |
| Phone numbers | libphonenumber-js | — |
| Translations | next-intl | D-015 |
| WhatsApp / email (SMS addable) | Adapters; fake first; real ones chosen in E03 | D-010, D-055 |
| AI | Anthropic API from the worker | D-011 |
| Tests | Vitest, Playwright, fast-check, real Postgres | D-012 |
| Errors, logs | Sentry (EU), pino | D-013 |
| Code and CI | GitHub, GitHub Actions | D-014 |

No Redis, no object storage, no microservices, no websockets in v1.
**Adding a library or service needs a decision-log entry** (agent rule 9).

## Folder structure (created by E00-T01)

```
src/
  app/                       Next.js routes. THIN: parse input, call a module, render.
    (staff)/                 staff app, requires login
    (auth)/                  login, 2FA, invite, reset
    p/[token]/               patient pages, public
    api/webhooks/[provider]/ provider callbacks
    api/health/              health check
  modules/                   ALL business logic. One folder per module.
    <module>/
      index.ts               the module's public API. Other modules import only this.
      schema.ts              its Drizzle tables
      *.ts, *.test.ts        logic and unit tests, side by side
  worker/                    worker entry point and job handlers. THIN: call modules.
  db/                        client, tenant helpers, migrations/, seed/
  ui/                        shared components and design tokens
  lib/                       clock, ids, logger, small helpers
tests/
  integration/               tests against real Postgres
  e2e/                       Playwright
  evals/                     AI output evaluations
docs/  design/
```

### Module rules

1. A module's tables are private. Other modules call its functions, never query its tables.
2. Modules import each other only through `index.ts`. A lint rule enforces this.
3. Modules contain no Next.js and no React imports, so the worker and tests can use them.
4. Pure logic (timing, state machines, rendering, normalising) is written as functions with
   no database and no clock, so it can be tested with tables of inputs.

### Modules and what each owns

| Module | Owns |
|---|---|
| `tenancy` | clinics, settings, tenant context, opening hours, closed days |
| `auth` | users (via Better Auth), memberships, roles, permissions, invites |
| `audit` | the append-only audit log |
| `patients` | patients, guardians, status, search, consent records |
| `scheduling` | providers, breaks, treatment types, appointments, the appointment state machine |
| `messaging` | rules, templates, planner, dispatcher, adapters, message history, caps |
| `links` | patient link tokens and the patient-page actions |
| `tasks` | the "needs attention" items that people tick off |
| `recalls` | care plans, due dates, recall eligibility |
| `treatment` | treatment plans, plan items, visit wrap-up |
| `aftercare` | template library, drafts, AI drafting, approval |
| `import` | import jobs, staging rows, normalising, duplicates, commit, undo |
| `reporting` | read-only numbers for Today and the results panel |

## How a staff action flows

Every server-side action from the staff app goes through one wrapper (built in E00-T03).
No route talks to the database without it.

```
1. Who is this?            session → user
2. Which clinic, what role? membership → role + permissions
3. Allowed?                check the permission the action declares, else 403
4. Valid?                  Zod-parse the input
5. Do it                   open a transaction, set the clinic for Row-Level Security,
                           call the module function,
                           write the audit entry and any jobs in the SAME transaction
6. Answer                  typed result or typed error; nothing personal in logs
```

## How tenant isolation works

- Every tenant table has `clinic_id`. Foreign keys include it (`(clinic_id, patient_id)`),
  so a row can never point at another clinic's row.
- The app connects as a database role **without** permission to bypass Row-Level Security.
  Each transaction sets `app.clinic_id`; policies compare it to the row's `clinic_id`.
  A forgotten filter returns nothing instead of someone else's data.
- A different role runs migrations. The app role cannot change the schema and cannot update or
  delete audit rows.
- The worker runs each clinic's work inside that clinic's tenant context. The few steps that
  must look across clinics (which clinics exist, which messages are due, which link does this
  token belong to) go through small, named, reviewed database functions.
- A meta-test fails the build if any table lacks `clinic_id` and a policy, unless it is on the
  explicit allow-list (auth tables, job queue, raw webhook events). (D-016)

## Time

- Stored: always `timestamptz` (UTC). Dates without a time (due dates, birth dates) are `date`.
- Each clinic has an IANA time zone. Rules are written in clinic-local time and converted with Luxon.
- **Business logic never asks the system for the time.** "Now" is passed in from the edge
  (request, job). Tests set it freely. A lint rule bans `Date.now()` and `new Date()` in `src/modules`.
- Month arithmetic clamps to the end of the month (31 Aug + 6 months = 28/29 Feb).

## Environments

| | Data | Messages | AI |
|---|---|---|---|
| **Local** | Synthetic seed | Fake adapter; outbox viewer page | Fake by default; real with a dev key |
| **CI** | Synthetic, fresh database per run | Fake adapter | Fake; evals run on demand |
| **Staging** (Render) | Synthetic only | Real providers, **allow-list of test contacts** | Real |
| **Production** | Real | Real, with caps | Real |

Production credentials never exist on a development machine or in an agent session (D-044).

## Things that keep it running

- Health endpoint for the host. Heartbeat ping from the worker to an external monitor.
- Sentry for errors, with personal data stripped before sending.
- Nightly canary: every appointment tomorrow has a planned reminder or a recorded reason.
- Daily database backups with point-in-time recovery; one restore drill before go-live.

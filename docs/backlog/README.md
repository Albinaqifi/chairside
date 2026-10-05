# Backlog

One file per epic. Each epic delivers one roadmap milestone (`docs/product/roadmap.md`).
**Status is not in these files.** It lives only on `docs/progress/board.md`.

| Epic | Milestone | Outcome | Tasks | Detail level |
|---|---|---|---|---|
| [E00 Foundation](E00-foundation.md) | M0 | A running, deployed, empty app with login and tenant isolation | 15 | Fully specified (E00-T06b is refined first, and each part of E00-T04 after the first against the part before, D-086) |
| [E01 Scheduling](E01-scheduling.md) | M1 | The front desk can run a day | 11 | Fully specified |
| [E02 Reminder loop](E02-reminder-loop.md) | M2 | Reminder → patient confirms → calendar updates (fake channel) | 14 | Fully specified |
| [E03 Real channels](E03-real-channels.md) | M3 | WhatsApp and email for real, delivery status, replies, opt-out, caps; SMS designed for later | 11 | Outline |
| [E04 Onboarding](E04-onboarding.md) | M4 | Import patients, invite staff, 2FA | 11 | Outline |
| [E05 Recalls](E05-recalls.md) | M5 | Care plans, recalls, rule editor, results | 12 | Outline |
| [E06 Aftercare](E06-aftercare.md) | M6 | Treatment plans, visit wrap-up, AI-assisted aftercare | 11 | Outline |
| [E07 Pilot readiness](E07-pilot-readiness.md) | M7 | The go-live gate passes | 11 | Outline |

**Fully specified** = written to pass the Definition of Ready (`docs/process/workflow.md`)
as soon as the task's dependencies are done.
**Outline** = every task has all its fields, but with less detail. Before the epic starts, an
architect session refines it against what was actually built (that is the epic's task `T00`).
This is deliberate: detailing work months ahead produces plans that are wrong by the time
they are used.

## Task format

```
### E02-T04 · Title
- Role · Risk · Depends on · Read
Why. / Do. / Out of scope. / Acceptance.
```
Template and guidance: `docs/process/templates/task.md`.

- **Role:** who does it. `owner` tasks need Albin (accounts, money, legal, decisions).
- **Risk:** `low`, `normal`, `critical`. Decides how much checking it gets (`workflow.md`).
- **Read:** the only documents the agent needs besides the always-read ones.
  `scope` = `docs/product/scope-v1.md`, `design-ref` = `docs/product/design-reference.md`,
  `data-model`, `messaging`, `security`, `overview` = the files in `docs/architecture/`,
  `test-strategy` = `docs/process/test-strategy.md`.

## Rules for the backlog

- Task ids never change and are never reused.
- A task that turns out too big is split by the architect: `E02-T04a`, `E02-T04b`.
- New work found along the way goes to `docs/progress/discovered.md` first.
- Every "schema" task is critical and updates the seed data so later tasks have data to work with.

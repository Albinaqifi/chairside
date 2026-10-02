# Workflow

How a piece of work moves from an idea to done, adapted to one owner working with AI agents.

## The people

| Role | Who | Does |
|---|---|---|
| **Owner** | Albin | Sets priorities, answers open questions, reviews critical work, merges to `main`. |
| **Architect** | agent | Refines tasks until they are Ready, keeps the architecture documents true, records decisions. Writes no application code. |
| **Builder** | agent | Implements one task with its tests. |
| **Tester** | agent, fresh session | Verifies the acceptance criteria independently and tries to break the result. |
| **Reviewer** | agent, fresh session | Reviews the diff against the task, the rules and the security document. |

"Fresh session" matters: a tester or reviewer that shares the builder's context inherits the
builder's blind spots. Role definitions for Claude Code are in `.claude/agents/`.

## Task states

```
Planned ──► Ready ──► In progress ──► Built ──► Tested ──► Reviewed ──► Done
              ▲            │             │          │           │
              │            ▼             ▼          ▼           ▼
              └──────── Blocked     (back to In progress if something fails)
```

| State | Means | Who moves it on |
|---|---|---|
| **Planned** | Exists in the backlog, may need refinement. | Architect (or owner) → Ready |
| **Ready** | Passes the Definition of Ready. Can be picked up. | Builder → In progress |
| **In progress** | A builder is working on it. One builder per task. | Builder → Built |
| **Built** | Code and tests written, checks green, handoff note written. | Tester → Tested |
| **Tested** | Acceptance criteria verified independently. | Reviewer → Reviewed |
| **Reviewed** | Diff approved. Waits for the owner if the task is critical. | Owner → Done (merge) |
| **Done** | Merged to `main`, board updated. | — |
| **Blocked** | Cannot continue. The board says why and who must act. | whoever unblocks |

## Risk levels decide how much checking a task gets

Each task has a risk level. It keeps the process light where it can be and strict where it must be.

| Risk | Typical task | Path |
|---|---|---|
| **low** | Docs, copy, styling, a simple screen with no new logic | Builder → Reviewer → owner merges |
| **normal** | Most features | Builder → Tester → Reviewer → owner merges |
| **critical** | Schema and migrations, login and permissions, tenant isolation, message planning and sending, patient links, consent, AI prompts, retention and deletion, anything touching real providers or production | Builder → Tester → Reviewer → **owner reads the diff personally** → merge |

The owner merges everything. For low and normal tasks that can be a quick look at the
reviewer's verdict; for critical tasks it is a real review (see `test-strategy.md`,
"What the owner reviews personally").

## Definition of Ready

A task may be started only when all of these are true:

- [ ] It has: why, what to do, what is out of scope, documents to read, dependencies,
      acceptance criteria, role, risk level.
- [ ] Every dependency is Done.
- [ ] Acceptance criteria are things a tester can check, each with a clear pass or fail.
- [ ] It fits one agent session (rule of thumb: one clear outcome, under about 400 changed
      lines of product code). If not, the architect splits it.
- [ ] No open question blocks it. If one is involved, the working assumption is named in the
      task and the owner has accepted building on it.
- [ ] Any schema it needs is described in `data-model.md`.
- [ ] For screens: the design reference lines and the v1 scope section are named.

Tasks in E00–E02 were written to meet this. Tasks in later epics are **Planned**: complete
but less detailed. Before an epic starts, an architect session refines its tasks against
what was actually built and moves them to Ready.

## Definition of Done

A task is Done only when all of these are true:

- [ ] Every acceptance criterion is met, and the handoff note says how each was verified.
- [ ] Tests for the new behaviour exist at the right level (`test-strategy.md`).
- [ ] The full check passes locally and in CI: format, lint, types, unit, integration, and
      end-to-end where the task touches a user journey.
- [ ] No test was removed, skipped or weakened.
- [ ] New tables have `clinic_id` and a policy; the meta-test is green.
- [ ] No personal data in logs, fixtures, snapshots or notes.
- [ ] Documents match the code: data model, decisions, scope, `CLAUDE.md` conventions.
- [ ] User-visible text goes through the translation files.
- [ ] Tester and reviewer sections are in the handoff note (as the risk level requires).
- [ ] For critical tasks: the owner has reviewed.
- [ ] Merged to `main` by the owner; board updated.

## Git

- `main` is always releasable. Nobody commits to it directly.
- One branch per task: `task/E02-T04-planner-reminders`.
- Commit messages start with the task id: `E02-T04: plan reminder messages`.
- One pull request per task. The PR description links the task and the handoff note.
- CI must be green before review.
- Migrations that are merged are never edited: a fix is a new migration.

## Handoffs

Each task has one note: `docs/progress/handoffs/<task-id>.md`.
Each role **appends** its own section (builder, tester, reviewer). Nobody edits another
role's section. The template is `docs/process/templates/handoff.md`.

A good builder section lets the tester work without reading the builder's mind:
what was built, where, how each criterion was verified, what is not done, what to look at hard.

When something fails in testing or review, the task goes back to **In progress** with the
findings in the note. A new builder session reads the note and fixes exactly those findings.

## The board

`docs/progress/board.md` is the only place status lives (D-047). Agents update their task's
row when they start and when they finish. It also holds:

- **Now / Next:** the owner's current priorities, so a fresh session knows where to look.
- **Blocked:** what is waiting and for whom.
- **Discovered:** things agents noticed outside their task. The architect or owner turns
  them into tasks, or dismisses them.

## Starting a session (for the owner)

Give the agent a role and a task id, for example:
"Act as **builder** for task **E01-T04**." The agent follows the start ritual in
`CLAUDE.md` and the rules. To pick the next task, read "Next" on the board.

Typical rhythm for one task:
1. Builder session → Built.
2. New session as tester → Tested (or back with findings).
3. New session as reviewer → Reviewed.
4. You look, merge, mark Done.

Two tasks can run in parallel when they do not depend on each other and touch different
modules (the board's notes column says which). Parallel tasks use separate branches or git worktrees.

## Changing the plan

- **New task or changed task:** the architect edits the epic file and the board.
- **Changed scope or order:** update `roadmap.md` / `scope-v1.md` and add a decision.
- **Changed data model:** `data-model.md` + decision + owner review (critical).
- **An open question is answered:** update `open-questions.md`, add a decision, and the
  architect checks which tasks change.

## Keeping it honest

At the end of each milestone the owner and an architect session do a 15-minute check:
does the milestone's "ends with" demo really work on staging? Are the board, the scope
document and the data model still true? What did agents repeatedly get wrong, and should a
rule or convention change because of it? Changes to the rules are decisions and are logged.

# Workflow

How a piece of work moves from an idea to done, adapted to one owner working with AI agents.

## The people

| Role | Who | Does |
|---|---|---|
| **Owner** | Albin | Sets priorities, answers open questions, reviews critical work, merges to `main`. |
| **Architect** | agent | Refines tasks until they are Ready, keeps the architecture documents true, records decisions. Writes no application code. |
| **Builder** | agent | Implements one task with its tests, pushes the branch and opens the pull request. A fresh builder session fixes the findings of a review or a test round. |
| **Reviewer** | agent, fresh session | Reviews the diff against the task, the rules and the security document. Reads only the new commits when a task comes back after its review (delta review). |
| **Tester** | agent, fresh session | Verifies the acceptance criteria independently and tries to break the result. Comes after the review, so it tests the code that will ship. |
| **Pipeline** | Claude Code session (`/pipeline <task-id>`) | Runs one task through the roles in order, each as a fresh subagent. Does none of their work itself, and stops for the owner when the rules say so. |

"Fresh session" matters: a tester or reviewer that shares the builder's context inherits the
builder's blind spots. A subagent the pipeline starts counts as a fresh session: it begins
with none of the other roles' context and learns what they did only from the handoff note.
Role definitions for Claude Code are in `.claude/agents/`, the pipeline in
`.claude/skills/pipeline/SKILL.md`.

## Task states

```
Planned ─► Ready ─► In progress ─► Built ─► Reviewed ─► Tested ─► Done
                     ▲     │         │        ▲  │        │
                     │     └─ fixed ─┼────────┘  │        │
                     └── findings ───┴───────────┴────────┘
                      from the review, the test round or the delta review

A red CI run: In progress, then back to the state it came from (below).
Blocked: from any state. The board says why and who must act.
```

| State | Means | Who moves it on |
|---|---|---|
| **Planned** | Exists in the backlog, may need refinement. | Architect (or owner) → Ready |
| **Ready** | Passes the Definition of Ready. Can be picked up. | Builder → In progress |
| **In progress** | A builder is building it, or fixing findings. One builder at a time. | Builder → Built (first build) or → Reviewed (after fixing findings); after fixing a red CI run, the state it had before (Built or Reviewed) |
| **Built** | Code and tests written, checks green, handoff note written, branch pushed, pull request open. | Reviewer → Reviewed, or → In progress with required changes |
| **Reviewed** | The reviewer has read the whole diff, and every required change from it is fixed. Code changed after that review is checked by the tester now and by the delta review at the end. | Tester → Tested, or → In progress with findings. Low-risk tasks have no tester: the delta review, if needed, then the owner. |
| **Tested** | Acceptance criteria verified independently. | Reviewer (delta review, only if code changed after the full review) → stays Tested, or → In progress. Then the owner → Done (merge). |
| **Done** | Merged to `main`, board updated. | — |
| **Blocked** | Cannot continue. The board says why and who must act. | whoever unblocks |

A fix of a review or test finding always hands the task back to the tester (state Reviewed),
because a fix can break what was tested. Whatever changed after the full review is read once
more in the **delta review**: the reviewer reads only the commits since the commit it reviewed,
which its handoff section names. Changes to the handoff note and the board alone do not need one.

A red CI run (a check step failed) also goes back to a fresh builder, as a fix round. It sets the
state the task had before: Built when no reviewer section exists yet, so the full review still
comes next; otherwise Reviewed (D-075).

## Risk levels decide how much checking a task gets

Each task has a risk level. It keeps the process light where it can be and strict where it must be.

| Risk | Typical task | Path |
|---|---|---|
| **low** | Docs, copy, styling, a simple screen with no new logic | Builder → Reviewer → (fix → delta review) → owner merges |
| **normal** | Most features | Builder → Reviewer → (fix) → Tester → (fix → Tester) → (delta review) → owner merges |
| **critical** | Schema and migrations, login and permissions, tenant isolation, message planning and sending, patient links, consent, AI prompts, retention and deletion, anything touching real providers or production | Same as normal → **owner reads the diff personally** → merge |

Steps in brackets happen only when needed: a fix when the reviewer or tester reports something,
a delta review when code changed after the full review.

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
- One pull request per task. The builder pushes the branch and opens it when the task is
  Built (`gh pr create`); later roles push their commits to the same branch. The PR
  description links the task and the handoff note.
- Agents never merge, never push to `main` and never force-push. The owner merges.
- CI must be green before review. `.github/workflows/ci.yml` checks every pull request and every
  push to `main` (E00-T06a). After Build and after each Fix, the pipeline waits for the run of the
  branch's latest commit; Review and Test start only on green, a red check step becomes a fix
  round, and "ready to merge" comes only when the run of the last pushed commit is green. GitHub
  does not stop a merge on red (GitHub Free, D-075): the owner merges only on green (R-34).
- Migrations that are merged are never edited: a fix is a new migration.

## Handoffs

Each task has one note: `docs/progress/handoffs/<task-id>.md`.
Each role **appends** its own section (builder, reviewer, tester, and a builder section per
fix round). Nobody edits another role's section. The template is
`docs/process/templates/handoff.md`.

A good builder section lets the reviewer and tester work without reading the builder's mind:
what was built, where, how each criterion was verified, what is not done, what to look at hard.

When something fails in review or testing, the task goes back to **In progress** with the
findings in the note. A new builder session reads the note and fixes exactly those findings,
adds a test for each that fails without the fix, appends a fix-round section, and hands the
task to the tester (state Reviewed).

Reviewer suggestions (not required changes) do not go back to a builder. The reviewer adds
each as a line on the board's Discovered list.

## The board

`docs/progress/board.md` is the only place status lives (D-047). Agents update their task's
row when they start and when they finish. It also holds:

- **Now / Next:** the owner's current priorities, so a fresh session knows where to look.
- **Blocked:** what is waiting and for whom.
- **Discovered:** things agents noticed outside their task. The architect or owner turns
  them into tasks, or dismisses them.

## Starting a session (for the owner)

There are two ways. To pick the next task, read "Next" on the board.

**The pipeline (usual).** In a new Claude Code session, type `/pipeline E01-T04`. It runs the
whole rhythm below by itself, each role as a fresh subagent, and stops only when you are
needed (next section). Before you walk away:
- start it in a permission mode that does not ask before every command, or it waits for you;
- run `/remote-control` to follow it and answer from the Claude app on your phone;
- keep the computer on and Docker running: everything runs on this machine.
It sends a push notification when it stops for you and when the pull request is ready.

**One role per session (by hand).** Give the agent a role and a task id, for example
"Act as **builder** for task **E01-T04**." The agent follows the start ritual in `CLAUDE.md`
and the rules. Use this to redo one step, or when the pipeline stopped and you want to
continue step by step.

Typical rhythm for one task, by either way:
1. Builder → Built, branch pushed, pull request open. CI checks it; a red check step → a fresh
   builder fixes it → Built.
2. Reviewer → Reviewed, or required changes → a fresh builder fixes them → Reviewed.
3. Tester → Tested, or findings → a fresh builder fixes them → the tester checks again.
4. If code changed after the full review: the reviewer reads only those commits.
5. You look (critical tasks: read the diff), merge only on a green CI run, mark Done.

Two tasks can run in parallel when they do not depend on each other and touch different
modules (the board's notes column says which). Parallel tasks use separate branches or git
worktrees. Run one pipeline at a time: two would share the board and the local database.

## When the pipeline stops for the owner

The pipeline fixes what the reviewer, the tester and CI report without asking you, except when:

- a role stopped under agent rule 4 and set the task to **Blocked** (an open question, a data
  model change, a new library or secret, a login or tenant change the task did not ask for,
  deleting data, cost, a test whose expectation would have to change, a task too big);
- a third fix round would be needed: two automatic rounds per task, a round for a red CI run
  included, then something is wrong and you look;
- the full check fails and the role says it cannot make it pass;
- a role's result is unclear, or does not match what it wrote on the board;
- CI cannot give an answer, or gives one only you can act on (D-075), and the run is never
  counted as green: no run for the latest commit 10 minutes after the push, or a run still
  queued then; a run refused or cut short (Actions minutes used up, GitHub down: red with no red
  check step; cancelled; timed out); a red setup step; a red `pnpm audit --prod` (a dependency
  change falls under agent rule 4).

Each time, it sends a push notification and ends with what you must decide and where in the
handoff note to read. Questions that do not block (the builder's "Questions for the owner")
wait in the note for when you merge. The pipeline never merges and never marks a task Done.

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

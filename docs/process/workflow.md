# Workflow

How a piece of work moves from an idea to done, adapted to one owner working with AI agents.

## The people

| Role | Who | Does |
|---|---|---|
| **Owner** | Albin | Sets priorities and decides what agent rule 4 lists, asked in plain words with a recommendation first. Merges every task pull request on green. Uses the product. Does not review code: the roles do (D-087). |
| **Architect** | agent (`/architect <task-id>`) | Refines tasks until they are Ready, keeps the architecture documents true, records decisions. Writes no application code. After a merge, marks the task Done and settles what it left open. Merges its own documents-only planning pull request (D-087). |
| **Builder** | agent | Implements one task with its tests, pushes the branch and opens the pull request. A fresh builder session fixes the findings of a review or a test round. |
| **Reviewer** | agent, fresh session | Reviews the diff against the task, the rules and the security document. Reads only the new commits when a task comes back after its review (delta review). For a critical task, a second, fresh reviewer does the critical review after the tester and the delta review check (D-087). |
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
                      from the review, the test round, the delta review or the critical review

A red CI run: In progress, then back to the state it came from (below).
Blocked: from any state. The board says why and who must act.
```

| State | Means | Who moves it on |
|---|---|---|
| **Planned** | Exists in the backlog, may need refinement. | Architect (or owner) → Ready |
| **Ready** | Passes the Definition of Ready. Can be picked up. | Builder → In progress |
| **In progress** | A builder is building it, or fixing findings. One builder at a time. | Builder → Built (first build) or → Reviewed (after fixing findings); after fixing a red CI run, the state it had before (Built or Reviewed) |
| **Built** | Code and tests written, checks green, handoff note written, branch pushed, pull request open. | Reviewer → Reviewed, or → In progress with required changes |
| **Reviewed** | The reviewer has read the whole diff, and every required change from it is fixed. Code changed after that review is checked by the tester now and by the delta review at the end. | Tester → Tested, or → In progress with findings. Low-risk tasks have no tester: the delta review, if needed, then the owner merges. |
| **Tested** | Acceptance criteria verified independently. | Reviewer (delta review, only if code changed after the full review) → stays Tested, or → In progress. Then, for a critical task, a fresh reviewer (critical review) → stays Tested, or → In progress. Then the owner → Done (merge). |
| **Done** | Merged to `main`, board updated. | — |
| **Blocked** | Cannot continue. The board says why and who must act. | whoever unblocks |

A fix of a finding, from a review, a test round or the critical review, always hands the task
back to the tester (state Reviewed), because a fix can break what was tested. Whatever changed
after the full review is read once more in the **delta review**: the reviewer reads only the
commits since the commit it reviewed, which its handoff section names. Changes to the handoff
note and the board alone do not need one.

A critical task (below) gets one more review after the tester and the delta review (when one is
needed): the **critical review**, a second, independent review by a fresh reviewer that starts
from the tests, not the code (`.claude/agents/reviewer.md`, D-087). Its section is
`## Reviewer — YYYY-MM-DD (critical review)`, its result Approved or Changes required. Approved:
the state stays Tested. Changes required: In progress; the fix goes through the tester and the
delta review, then to the critical review again, which then reads only the commits after the
last commit it reviewed. Its fix is a fix round like any other and counts toward the two
automatic fix rounds of a task ("When the pipeline stops for the owner").

A red CI run (a check step failed) also goes back to a fresh builder, as a fix round. It sets the
state the task had before: Built when no reviewer section exists yet, so the full review still
comes next; otherwise Reviewed (D-075).

## Risk levels decide how much checking a task gets

Each task has a risk level. It keeps the process light where it can be and strict where it must be.

| Risk | Typical task | Path |
|---|---|---|
| **low** | Docs, copy, styling, a simple screen with no new logic | Builder → Reviewer → (fix → delta review) → owner merges |
| **normal** | Most features | Builder → Reviewer → (fix) → Tester → (fix → Tester) → (delta review) → owner merges |
| **critical** | An area of `test-strategy.md`'s table (below): migrations and policies, the tenant and action wrappers, login and permissions, message planning and sending, patient links, consent, the AI prompt builder, real providers, imports, retention and deletion, production configuration or secrets | Same as normal → **critical review** (a second, independent reviewer) → (fix → Tester → delta review → critical review) → owner merges |

Steps in brackets happen only when needed: a fix when the reviewer, the tester or the critical
review reports something, a delta review when code changed after the full review.

Critical means the diff touches an area in `test-strategy.md`'s table "What gets a second
review (the critical review)". A task that touches none of them is normal or low, whatever else
it changes: a lint rule, CI, a script, a process file. The architect sets the level when it
refines the task and names the area for a critical one (D-087).

The owner merges every task pull request on green and on the pipeline's "ready to merge". The
owner does not review code: the reviewer, the tester and, for a critical task, the critical
review do. The owner's part is to decide what only the owner can (agent rule 4: money, law,
scope, positioning, data), asked in plain words with a recommendation first, and to use the
product: the milestone check in "Keeping it honest", the receptionist trial (Q-09), and the
"Try it" steps a builder writes for a screen (D-087).

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
- [ ] For critical tasks: the critical review has approved.
- [ ] Merged to `main` by the owner; board updated.

## Git

- `main` is always releasable. Nobody commits to it directly.
- One branch per task: `task/E02-T04-planner-reminders`.
- Commit messages start with the task id: `E02-T04: plan reminder messages`.
- One pull request per task. The builder pushes the branch and opens it when the task is
  Built (`gh pr create`); later roles push their commits to the same branch. The PR
  description links the task and the handoff note.
- Agents never merge a task pull request, never push to `main` and never force-push. The owner
  merges, except a documents-only planning pull request (`git diff --name-only origin/main...HEAD`
  names only files under `docs/`, Markdown files under `.claude/`, `CLAUDE.md` and `README.md`),
  which the architect merges itself (D-087).
- CI must be green before review. `.github/workflows/ci.yml` checks every pull request that
  changes more than documents (a documents-only one gets no run, D-087) and every push to `main`
  (E00-T06a). After Build and after each Fix, the pipeline waits for the run of the
  branch's latest commit; Review and Test start only on green, a red check step becomes a fix
  round, and "ready to merge" comes only when the run of the last pushed commit is green. GitHub
  does not stop a merge on red (GitHub Free, D-075): the owner merges only on green (R-34).
- Migrations that are merged are never edited: a fix is a new migration.

## Handoffs

Each task has one note: `docs/progress/handoffs/<task-id>.md`.
Each role **appends** its own section (builder, reviewer, tester, a builder section per fix
round, and for a critical task the critical review's). Nobody edits another role's section. The
template is `docs/process/templates/handoff.md`.

Each section has a size (the template says it). The code, the tests and the diff are the
evidence; a section names what was run and what was found, and does not retell it. The cap is
on the writing, not on the checking (D-087).

A good builder section lets the reviewer and tester work without reading the builder's mind:
what was built, where, how each criterion was verified, what is not done, what to look at hard.
For a screen it adds "Try it": the steps the owner can click through in the app.

When something fails in review, testing or the critical review, the task goes back to
**In progress** with the findings in the note. A new builder session reads the note and fixes
exactly those findings, adds a test for each that fails without the fix, appends a fix-round
section, and hands the task to the tester (state Reviewed).

Reviewer suggestions (not required changes) do not go back to a builder. The reviewer adds
each as a line in `docs/progress/discovered.md`, starting with its weight (agent rule 15).

## The board

`docs/progress/board.md` is the only place status lives (D-047). Agents update their task's
row when they start and when they finish. It also holds:

- **Now / Next:** the owner's current priorities, so a fresh session knows where to look.
- **Blocked:** what is waiting and for whom.
- **Owner actions (standing):** what the owner must do outside any task, one line each (D-087).

Things agents noticed outside their task go to `docs/progress/discovered.md`, one line each,
starting with its weight (agent rule 15; D-079, D-087). Nobody reads it at the start of a
session. The architect or owner weighs its lines in the next planning pass (`data` and `message`
lines are always work), turns them into tasks or decisions, and deletes them; git history keeps
them. It left the board so that the board stays short enough to read every session.

## Starting a session (for the owner)

There are three ways. To pick the next task, read "Next" on the board.

**The architect pass (`/architect E01-T04`).** After you have merged a task's pull request, or
before a task that is not yet Ready starts. In a new Claude Code session, type `/architect` and
the task id. It marks the merged task Done, checks the first CI run on `main`, goes through what
the task left open (the note's questions for you, its Discovered lines) and asks you where the
choice is yours, refines the next task to Ready, and opens a planning pull request. A
documents-only one gets no CI run and the architect merges it itself; one that changes anything
else is yours to merge on green (D-087). Then `/pipeline` the next task. `/architect E05-T00`
refines a whole epic.

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
5. A critical task: the critical review, a second, independent reviewer that starts from the
   tests. Required changes → a fresh builder fixes them → steps 3 and 4 again → the critical
   review reads only the commits after the last one it reviewed.
6. You merge on the pipeline's "ready to merge" and a green CI run. For a screen, you then try
   the note's "Try it" steps on `main` (`pnpm dev`). Then `/architect <task-id>` marks it Done,
   asks what you saw when you tried it, and gets the next task Ready.

Two tasks can run in parallel when they do not depend on each other and touch different
modules (the board's notes column says which). Parallel tasks use separate branches or git
worktrees. Run one pipeline at a time: two would share the board and the local database.

## When the pipeline stops for the owner

The pipeline fixes what the reviewer, the tester and CI report without asking you, except when:

- a role stopped under agent rule 4 and set the task to **Blocked** (an open question, a data
  model change, a new library or secret, a login or tenant change the task did not ask for,
  deleting data, cost, a test whose expectation would have to change, a task too big);
- a third fix round would be needed: two automatic rounds per task, a round for a red CI run
  or for the critical review included, then something is wrong: you decide whether a third round
  runs, by hand ("One role per session"), before `/pipeline` resumes;
- the full check fails and the role says it cannot make it pass;
- a role's result is unclear, or does not match what it wrote on the board;
- CI cannot give an answer, or gives one only you can act on (D-075), and the run is never
  counted as green: no run for the latest commit 10 minutes after the push, or a run still
  queued then; a run refused or cut short (Actions minutes used up, GitHub down: red with no red
  check step; cancelled; timed out); a red setup step; a red `pnpm audit --prod` (a dependency
  change falls under agent rule 4).

Each time, it sends a push notification and ends with what you must decide or do, each question
with its recommended answer, and which section of the handoff note holds the detail. Questions
that do not block (the note's "Questions for the owner") wait in the note: `/architect <task-id>`
asks them after you merge. The pipeline never merges and never marks a task Done.

## Changing the plan

- **New task or changed task:** the architect edits the epic file and the board.
- **Changed scope or order:** update `roadmap.md` / `scope-v1.md` and add a decision.
- **Changed data model:** `data-model.md` + decision + the owner's decision (agent rule 4); the
  task is critical.
- **An open question is answered:** update `open-questions.md`, add a decision, and the
  architect checks which tasks change.

## Keeping it honest

At the end of each milestone the owner and an architect session do a 15-minute check:
does the milestone's "ends with" demo really work on staging? Are the board, the scope
document and the data model still true? What did agents repeatedly get wrong, and should a
rule or convention change because of it? Changes to the rules are decisions and are logged.

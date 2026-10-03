---
name: pipeline
description: Runs one Chairside task through builder, reviewer, fix rounds, tester and delta review, each role as a fresh subagent, and stops for the owner only when the rules say so. Started only by the owner with /pipeline <task-id>.
argument-hint: <task-id, e.g. E00-T03>
arguments: [task]
disable-model-invocation: true
---

# Pipeline for task $task

You coordinate task **$task** through the roles described in `docs/process/workflow.md`
("Starting a session" and "When the pipeline stops for the owner"). You are not one of the
roles. You never write product code, tests, handoff sections or board rows yourself. Each
role runs as a subagent you start with the Agent tool, `subagent_type` `builder`, `reviewer`
or `tester`. A subagent starts with none of your context and learns what happened only from
the handoff note, the board and the branch. That is the point: keep it that way.

## Before the first step

1. Read `docs/process/agent-rules.md`, the task in `docs/backlog/` (its risk level and
   dependencies), the task's row on `docs/progress/board.md`, and the handoff note
   `docs/progress/handoffs/$task.md` if it exists. Nothing more: the roles read the rest.
2. Check that `$task` is a task id that exists, that the working tree is clean
   (`git status --short`), and that the local database is up (`docker compose up -d --wait`).
   If any of this fails, **Stop**.
3. Start from the task's state on the board:

| Board state | Start with |
|---|---|
| Planned, or Ready with a dependency that is not Done | **Stop**: the task is not Ready |
| Ready | Build |
| In progress, and the note's last section is a reviewer or tester section with required changes or findings | Fix |
| In progress, anything else | **Stop**: a builder may still be at work, or a session ended halfway |
| Built | Review |
| Reviewed | Test (low risk: Delta review check) |
| Tested | Delta review check |
| Blocked | **Stop**: report what the note says the owner must decide |
| Done | **Stop**: nothing to do |

The checkout can be on `main` or on the task branch. The builder creates the branch; for every
later step, check out the task branch first (`git switch <branch>`, then `git pull`).

## The steps

Start each subagent in the foreground: the next step depends on its result. Give it only the
task id, the step, and the reply format below. Never pass on what an earlier role thought or
found: the reviewer and the tester judge from the note and the code alone.

**Build.** Builder: "Act as builder for task $task. Follow `.claude/agents/builder.md` and
the agent rules. When done, reply in three lines: the board state you set, the pull request
link, and one sentence on what is not done." Built → Review. Blocked → **Stop**.

**Review.** Reviewer: "Act as reviewer for task $task: full review of the task branch against
`main`, as `.claude/agents/reviewer.md` says. Reply in three lines: the result (Reviewed or
Changes required), the reviewed commit, the number of required changes." Reviewed → Test
(low risk: Finish). In progress → Fix.

**Fix.** Count the fix rounds already in the note (sections headed `(fix round N)`). If there
are two, **Stop**: a third round would be needed. Otherwise builder: "Act as builder for task
$task: fix round <N+1>. Fix exactly the required changes or findings in the last reviewer or
tester section of the handoff note, as `.claude/agents/builder.md` ('Fixing findings') says.
Reply with the board state you set, then one line per finding: fixed, or not fixed and why."
Reviewed → Test (low risk: Delta review check). Blocked → **Stop**.

**Test.** Tester: "Act as tester for task $task, as `.claude/agents/tester.md` says. Reply in
two lines: the result (Tested or Back to builder) and the number of findings." Tested → Delta
review check. In progress → Fix.

**Delta review check.** If the note has no reviewer section at all (a task started before
D-065, when the tester came first), there is nothing to compare against: start the reviewer
for a full review instead, with the prompt and reply of Review, and tell it the task is
already Tested. Reviewed → Finish. In progress → Fix.

Otherwise take the last commit a reviewer read: the `Reviewed commit` of the
full review, or the end of the `Reviewed commits` range of the latest delta review. List what
changed after it, leaving out the handoff notes and the board:
`git diff --name-only <commit>..HEAD -- . ":(exclude)docs/progress"`. Nothing → Finish.
Otherwise reviewer: "Act as reviewer for task $task: delta review of the commits after
<commit>, as `.claude/agents/reviewer.md` says. Reply in two lines: the result (Approved or
Changes required) and the number of required changes." Approved → Finish. In progress → Fix,
which leads through Test back to this check.

**After every step,** before the next one:
- Read the task's board row and the last section of the handoff note yourself. If they do not
  match the subagent's reply, or the subagent wrote nothing, **Stop**.
- If the branch is ahead of `origin` (`git status -sb`), run `git push`. Switching to the
  task branch, pulling it, pushing it and starting the database are the only things you do
  that change anything.

## Finish

The task is Tested (low risk: Reviewed), a reviewer has read the whole diff, and no code
changed after the last review. Send a push
notification: "$task ready to merge: <pull request link>". End your turn with a short report:
the state, the pull request link, how many fix rounds it took, and the headings of the
owner's open questions in the note. For a critical task, add that the owner reads the diff
personally, starting with the reviewer's "For the owner".

## Stop

Whenever a step says **Stop**, or anything unexpected happens, do not repair it yourself and
do not guess. Send a push notification: one line, under 200 characters, saying what the owner
must decide. End your turn with: where the task stands, what happened, what the owner must
decide, which section of the handoff note to read, and how to continue: answer in the note or
on the board, then `/pipeline $task` again (it resumes from the board state).

## Never

- Merge, mark a task Done, push to `main`, force-push, or rewrite history.
- Edit code, tests, the handoff note or the board.
- Run a third fix round, or skip a step because it looks unnecessary.
- Start two subagents at once, or a second task.

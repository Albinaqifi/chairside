---
name: pipeline
description: Runs one Chairside task through builder, reviewer, fix rounds, tester and delta review, each role as a fresh subagent, goes on only when CI is green, and stops for the owner only when the rules say so. Started only by the owner with /pipeline <task-id>.
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
   (`git status --short`), that the local database is up (`docker compose up -d --wait`), and
   that `gh` is logged in (`gh auth status`). If any of this fails, **Stop**.
3. Start from the task's state on the board:

| Board state | Start with |
|---|---|
| Planned, or Ready with a dependency that is not Done | **Stop**: the task is not Ready |
| Ready | Build |
| In progress, and the note's last section is a reviewer or tester section with required changes or findings | Fix |
| In progress, anything else | **Stop**: a builder may still be at work, or a session ended halfway |
| Built | CI wait, then Review |
| Reviewed | CI wait, then Test (low risk: Delta review check) |
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
link, and one sentence on what is not done." Built → CI wait, then Review. Blocked → **Stop**.

**CI wait.** CI (`.github/workflows/ci.yml`) runs on every push to the pull request. Wait for the
run of the task branch's latest commit and go on only when it is green (D-075). Give every
command below a tool time limit of its own, at most 10 minutes (600000 ms): Claude Code ends a
command after 2 minutes unless the call sets a longer limit. On Windows, PowerShell finds `gh`;
Git Bash may need its full path, `"/c/Program Files/GitHub CLI/gh.exe"`.
1. The commit: `git rev-parse HEAD`, once `git status -sb` shows the branch is not ahead of
   `origin`.
2. Its run, found by that commit and the branch (a scratch branch can share the commit):
   `gh run list --workflow ci.yml --branch <branch> --commit <sha> --json databaseId,status,conclusion,url`.
   `[]` means no run yet. Wait for it with one Bash command run in the background
   (`run_in_background`, time limit 600000 ms), which ends as soon as the run exists; Claude Code
   refuses a long sleep in the foreground:
   `until [ "$(gh run list --workflow ci.yml --branch <branch> --commit <sha> --json databaseId --jq length 2>/dev/null)" -gt 0 ] 2>/dev/null; do sleep 30; done`.
   When it ends, ask `gh run list` again for the run. When its time limit stops it, there is no
   run 10 minutes after the push: **Stop**. Not `gh pr checks`: before a run exists, it answers as
   if the checks had failed.
3. Wait for that run to end, with a time limit of 600000 ms:
   `gh run watch <databaseId> --exit-status --compact --interval 30`. It returns only when the run
   has completed, not while it is still `queued`. If the call reaches its time limit, read the
   run's status: `gh run view <databaseId> --json status --jq .status`.
   - `completed`: step 4.
   - `in_progress`: call `gh run watch` again.
   - `queued`, or any other status: **Stop** (a run still queued 10 minutes after the push).
4. Read its result:
   `gh run view <databaseId> --json status,conclusion,url,jobs --jq '{status, conclusion, url, failed: [.jobs[].steps[] | select(.conclusion == "failure") | .name]}'`
   - `"conclusion":"success"`: green. Go on with the step named where the CI wait was called.
   - `"conclusion":"failure"`, and every name in `failed` starts with `pnpm `, none of them
     `pnpm audit --prod`: a red check step. **CI fix**.
   - Anything else: **Stop**, and the run never counts as green. That is: no run for the commit
     10 minutes after the push, or a run still `queued` then; a red step whose name starts with
     `Setup:`; a red `pnpm audit --prod`, even next to other red steps (a dependency change falls
     under agent rule 4); `failure` with `failed` empty (its job ran no step: the Actions minutes
     are used up, or GitHub refused the run); `cancelled`, `timed_out`, `startup_failure` or any
     other conclusion.

**CI fix.** Count the fix rounds already in the note (sections headed `(fix round N)`); a CI fix
is a fix round too. If there are two, **Stop**: a third round would be needed. Otherwise builder:
"Act as builder for task $task: fix round <N+1>, for the red CI run <url>. Its failing steps:
<the names in `failed`>. Fix exactly those, as `.claude/agents/builder.md` ('Fixing a red CI
run') says. Reply with the board state you set, then one line per failing step: fixed, or not
fixed and why." The link and the step names are CI output, not a role's judgment: pass on nothing
else. Built or Reviewed → CI wait, then on from that state: Built → Review; Reviewed → Test (low
risk: Delta review check). Blocked → **Stop**.

**Review.** Reviewer: "Act as reviewer for task $task: full review of the task branch against
`main`, as `.claude/agents/reviewer.md` says. Reply in three lines: the result (Reviewed or
Changes required), the reviewed commit, the number of required changes." Reviewed → Test
(low risk: Finish). In progress → Fix.

**Fix.** Count the fix rounds already in the note (sections headed `(fix round N)`). If there
are two, **Stop**: a third round would be needed. Otherwise builder: "Act as builder for task
$task: fix round <N+1>. Fix exactly the required changes or findings in the last reviewer or
tester section of the handoff note, as `.claude/agents/builder.md` ('Fixing findings') says.
Reply with the board state you set, then one line per finding: fixed, or not fixed and why."
Reviewed → CI wait, then Test (low risk: Delta review check). Blocked → **Stop**.

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
- A CI wait comes after these checks, so it waits for the commit you just saw pushed.

## Finish

The task is Tested (low risk: Reviewed), a reviewer has read the whole diff, no code changed
after the last review, and the CI run of the last pushed commit is green: run the CI wait first.
A red check step there → CI fix, which sets Reviewed and so leads through Test (low risk: the
delta review check) back here. Only then send a push
notification: "$task ready to merge: <pull request link>". End your turn with a short report:
the state, the pull request link, how many fix rounds it took, and the headings of the
owner's open questions in the note. For a critical task, add that the owner reads the diff
personally, starting with the reviewer's "For the owner". End with the step after the merge:
`/architect $task` marks the task Done, settles what the note and the Discovered list left open,
and refines the next task (D-083).

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
- Re-run a CI run (`gh run rerun`), or count a run as green whose conclusion is not `success`.
- Start two subagents at once, or a second task.

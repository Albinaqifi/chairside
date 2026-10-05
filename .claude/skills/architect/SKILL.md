---
name: architect
description: Runs one architect pass for a Chairside task in this session. After the owner has merged the task, marks it Done, settles what its handoff note and the Discovered list left open, and refines the next task to Ready; for a task that has not started, refines it to Ready. Documents only, on a plan/ branch with a pull request. Started only by the owner with /architect <task-id>.
argument-hint: <task-id, e.g. E00-T10>
arguments: [task]
disable-model-invocation: true
---

# Architect pass for task $task

You are the **architect** for this pass: follow `.claude/agents/architect.md` and the agent
rules. The owner started you and is here, so where a choice is the owner's you ask (agent rule 4)
instead of ending the session. You write documents, never application code. Everything you change
goes on one planning branch and into one pull request that the owner merges before the next
`/pipeline`. Nothing here is new: it is what the owner used to write into a prompt by hand after
every pipeline run (D-083).

## Before the first step

1. Read `docs/intent.md`, `docs/process/agent-rules.md` and `docs/progress/board.md`, then the
   task's row and its section of the epic file in `docs/backlog/` (its `### $task` heading to the
   next `###`, plus the epic's introduction). Of `docs/log/decisions.md` read the headings
   (`grep -n '^### D-' docs/log/decisions.md`) and only the entries the task, its row or its note
   name; of `docs/log/open-questions.md` only the questions they name. The pass below says what
   else to read, and when.
2. Check that `$task` is a task id that exists, that the working tree is clean
   (`git status --short`) and that `gh` is logged in (`gh auth status`; in Git Bash on Windows,
   `gh` may need its full path, `"/c/Program Files/GitHub CLI/gh.exe"`). If any of this fails,
   **Stop**.
3. Choose the pass from the task's board state. The pull request's number is on the row;
   `gh pr view <n> --json state,mergeCommit,mergedAt` says whether it is merged.

| Board state | Pass |
|---|---|
| Tested (low risk: Reviewed), pull request merged | **Done pass** |
| Tested (low risk: Reviewed), pull request not merged | **Stop**: the owner merges first; say what the note asks the owner to review |
| In progress, Built, or Blocked | **Stop**: not the architect's turn; say what the board and the note's last section say |
| Planned, or Ready with leftovers that name it (Done pass, step 3) | **Ready pass** |
| Ready and nothing names it | **Stop**: it is Ready; `/pipeline $task` starts it |
| Done | **Stop**: nothing to do for this task; name the first task of the Next list that is not Ready |

A `T00` task ("Refine this epic") is a Ready pass over its whole epic: every task of the epic
against what was actually built, in the epic's order.

## Done pass

Precedents, documents only: `4393ecc` (E00-T06a Done) and `c4bb3cf` (E00-T09 Done, two
Discovered lines folded into E00-T10); the last architect section of `handoffs/E00-T06a.md`.

1. **Start from `main`.** `git switch main`, `git pull`, then a new branch `plan/$task-done`.
2. **The run on `main`.** The first CI run on `main` after the merge is the one check nobody has
   made yet. Find it by the merge commit:
   `gh run list --workflow ci.yml --branch main --commit <merge commit> --json databaseId,status,conclusion,url`.
   Still running: wait as the pipeline skill's "CI wait" does (`gh run watch <id> --exit-status
   --compact --interval 30`, tool time limit 600000 ms). Then read its steps:
   `gh run view <id> --json conclusion,url,jobs --jq '{conclusion, url, failed: [.jobs[].steps[] | select(.conclusion == "failure") | .name]}'`.
   Green: name the run on the board and in your section. Not green: do not fix anything; say
   which step is red, go on with the pass, and make it the first line of your reply. The owner
   decides what happens to `main`.
3. **The task's leftovers.** Collect these, and only these:
   - in `docs/progress/handoffs/$task.md`: "Questions for the owner" and "Not done / known gaps"
     of every builder section, "For the owner" of the reviewer's and the tester's sections, and
     the tester's notes for the owner. Not the rest of the note;
   - in `docs/progress/discovered.md`: every line whose second field names `$task` (`· $task ·`,
     `· $task review ·`, `· $task test ·`, `· $task delta review ·`).

   Sort each into one of four, and write where it went in your section:
   - **The owner's** (agent rule 4: the data model, a library, a service, a secret, login,
     permissions, tenant isolation, links, consent, what the AI sees, cost, scope): ask the owner
     now, every item in one round, each with its options and your recommendation (the
     AskUserQuestion tool; a numbered list if it is not available). An answer becomes a decision
     entry ("Owner, <date>: …"), and what it asks for becomes work (below). No answer: leave the
     line where it is, add one line under "Now" on the board ("Owner decides, before <the task it
     blocks>: …"), and build nothing on a guess.
   - **The architect's** (how a rule, a check, a convention or a task text should go): decide,
     record it as a decision entry when it affects more than one task, and put one line under
     "Now" for the owner to review ("Owner review, before <task> starts: …"), as D-081's spread
     choice was.
   - **Work:** a change that belongs in a task. Fold it into the task it names when that task has
     not started (a Do item, acceptance criteria, the Read line), as E00-T09's two lines went into
     E00-T10 (D-081). Otherwise a new task: a new id that is never reused (`E0X-T11`, or
     `E0X-T04a` for a split), a full section in the epic file, a row on the board. Several lines
     that close one kind of gap make one task (E00-T10 came from six lines, D-077). A line for a
     later epic stays on the list with a note after it ("→ E04-T00") until that epic is refined.
   - **Struck:** only with the reason written after it in your section.

   Delete every line you handled from `discovered.md` (git history keeps it). Leave every other
   line exactly as it is.
4. **The board.** The task's row: status **Done**; its notes start "Merged by the owner (PR #n)."
   then one short line on what shipped and where its leftovers went, then "See
   `handoffs/$task.md`". The Done list: `- $task · <title> · merged <date> (PR #n)`. "Now": "Next
   task to start" names the next task of the Next list, with `/pipeline <id>` when it is Ready, or
   that this pass refines it; drop the lines the merge settled; add the owner lines from step 3.
   The Next list, and the "Last updated" line.
5. **The next task.** The first task of the Next list that is not Ready (Planned, "refined
   first", "split when refined"), or a Ready one that step 3 changed: run the **Ready pass** below
   for it, on this same branch. One task is the usual; two when they are the next two and both
   small. A task you leave as it is: say so in your reply, and why.
6. **Your section.** Append `## Architect — <date> (Done pass)` to
   `docs/progress/handoffs/$task.md` (the template's section): the branch; the result (Done, the
   merge commit, the run on `main`); what you changed on the board and in the logs; where each
   leftover went; "For the owner: still to do".
7. **Hand off.** Documents only: `git status --short` shows nothing under `src/`, `tests/`,
   `eslint-rules/` or `.github/`. One commit whose message starts with the task ids, as
   `E00-T09: Done (PR #15 merged); E00-T10: the two form-lint gaps folded in (D-081)`;
   `git push -u origin plan/$task-done`; `gh pr create --base main --title "$task: Done" --body
   "…"` with what the owner must review or decide. Never merge. Reply with: whether the run on
   `main` is green; the pull request link; which task is Ready next and the command that starts
   it (`/pipeline <id>`, after the owner merges this pull request); the owner's open decisions.

## Ready pass

Precedents: `70d3288` (E00-T03 refined, E00-T08 split off), `3272384` (E00-T08), `66eb635`
(E00-T06a, E00-T09 and E00-T10 in one pass); the architect sections at the top of
`handoffs/E00-T09.md` and `handoffs/E00-T10.md`.

Branch: `plan/<task>-ready` from an up-to-date `main` (`git switch main`, `git pull`), unless
you are inside a Done pass: then its branch.

1. **Read for the task:** the documents on its Read line; the decisions and open questions they
   and the task name; every Discovered line that names the task anywhere, and every leftover of
   a Done task that names it (collected as in the Done pass, step 3, from that task's note); and
   the code on `main` that the task builds on (`git rev-parse HEAD` to name the commit you
   checked). Probes are fine: a scratch prototype, a lint snippet, a command. Commit none of it.
2. **Check it against the Definition of Ready** (`docs/process/workflow.md`), against the code
   that exists, not what the plan assumed:
   - every dependency Done, and the Depends-on line complete;
   - acceptance criteria a tester can check, each with a clear pass or fail, the unhappy paths
     included, and what each costs when it is more than a test run (one CI run is about 5
     minutes; a real browser is a session's worth of setup);
   - one session: one clear outcome, under about 400 changed lines of product code. If not,
     split it (`E0X-T04a`, `E0X-T04b`): each a full section, the order in the epic's
     introduction, a row each on the board, the old id kept on the board as "split (D-0xx)";
   - no open question blocks it; one that is involved has its working assumption named in the
     task and flagged for the owner, or the task is Blocked;
   - any schema it needs is in `data-model.md`; for screens, the `scope-v1.md` section and the
     `design-reference.md` lines are named;
   - it stays inside the safety rails (agent rule 7), and its risk level still fits what it
     touches.
3. **Edit the task** in the epic file: Role, Risk, Depends on, Read, Why, Do, Out of scope,
   Acceptance (`docs/process/templates/task.md`). Keep what is right; change what the code or the
   decisions made wrong. Record what you settled as a decision entry (`Origin: process, planning
   on <date>`; append, never edit an old one; "replaces D-0xx" when one changes). Keep
   `docs/architecture/*`, `docs/product/scope-v1.md` and `CLAUDE.md` true to it, in the same
   change. Where the choice is the owner's, ask as in the Done pass, step 3.
4. **The handoff note** `docs/progress/handoffs/<task>.md`: create it from the title line if it
   does not exist; append `## Architect — <date>` (the template's Ready-pass section): the
   branch; the result (Ready, or Planned or Blocked and why); "What was settled" (the owner's
   answers and your choices, each with its D-number, and which one the owner should look at);
   "Doc changes"; "For the builder: what is already there" (checked on `main` at `<sha>`: the
   files, functions and behaviours it builds on, the traps you found with your probes, what it
   must not change); "For the reviewer and tester" (what each criterion costs to check);
   "Questions for the owner".
5. **The board:** the task's row (Ready; notes: where it came from, its D-numbers, "See
   `handoffs/<task>.md`"), "Next task to start", the Next list, the "Last updated" line.
6. **Hand off** as in the Done pass, step 7, on the branch you are on, with the title
   `<task>: Ready` when the pass is its own.

## Never

- Write or commit application code, tests or migrations; a probe is thrown away.
- Edit a merged migration, an old decision entry, another role's handoff section, or
  `docs/intent.md`.
- Answer an open question yourself, or decide an item on agent rule 4's list without the owner.
- Mark a task Done whose pull request is not merged, or count a run on `main` as green whose
  conclusion is not `success`.
- Merge, push to `main`, force-push, or start a `/pipeline` yourself.

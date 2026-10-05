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
goes on one planning branch and into one pull request, merged before the next `/pipeline`: by you
when it changes only documents, otherwise by the owner on green (Done pass, step 7; D-087). It is
what the owner used to write into a prompt by hand after every pipeline run (D-083).

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
| Tested (low risk: Reviewed), pull request not merged | **Stop**: the owner merges it first, on green and after the pipeline's "ready to merge"; list the note's questions for the owner, each with its recommended answer |
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
   - in `docs/progress/handoffs/$task.md`: "Questions for the owner" of every architect, builder
     and tester section, "Not done / known gaps" of every builder section, and, for a critical
     task, the critical review's sections (`(critical review)`). Not the rest of the note;
   - in `docs/progress/discovered.md`: every line whose second field names `$task` (`· $task ·`,
     `· $task review ·`, `· $task test ·`, `· $task delta review ·`, `· $task critical review ·`);
   - for a screen, what the owner saw trying the note's "Try it" steps (ask).

   Weigh every leftover first (agent rule 15: `data`, `message`, `speed`, `slice` or `none`). A
   leftover becomes work now only when its weight is `data` or `message`, or a task on the Next
   list needs it; a `none` is struck as "review check" in one line, and so is a lint gap, unless
   product code on `main` would hit it today (D-087). A way past a lint guard that a reviewer can
   check on a diff also goes into `CLAUDE.md`, one line next to the rule it gets past, as module
   rule 7's "reviewers check where a handler is written" (D-086). A `speed` or `slice` that no task
   on the Next list needs stays on the Discovered list (a note leftover goes there), weighed, with
   the epic it waits for after it ("→ E04-T00"). A new task that would go ahead of the Next list is
   the owner's choice: the question's first option is "not now", whatever you recommend (mark the
   recommended one), with the cost in sessions. On "not now", a `data` or `message` leftover still
   becomes its task, after the Next list (rule 15); a `speed` or `slice` one stays on the
   Discovered list, as above.

   Then sort each into one of four, and write where it went, with its weight, in your section:
   - **The owner's** (agent rule 4: the data model, a library, a service, a secret, login,
     permissions, tenant isolation, links, consent, what the AI sees, cost, scope): ask the owner
     now, every item in one round (the AskUserQuestion tool; a numbered list if it is not
     available), in plain words, short, without code, answerable without reading a diff, each with
     the recommended answer first (a new task ahead of the Next list: "not now" first, above). An
     answer that makes a document untrue or adds a dependency becomes a decision entry ("Owner,
     <date>: …"), and what an answer asks for becomes work (below). No answer: leave the line
     where it is, add one line to the board ("Owner decides, before <the task it blocks>: …"),
     under "Now" when it blocks the next task, otherwise under "Owner actions (standing)", and
     build nothing on a guess.
   - **The architect's** (how a rule, a check, a convention or a task text should go): decide. A
     choice that makes a document untrue or adds a dependency gets a decision entry; one inside a
     task's words stays in the task text and your section. No line on the board for the owner to
     review: technical choices are yours (D-087).
   - **Work:** a change that belongs in a task. Fold it into the task it names when that task has
     not started (a Do item, acceptance criteria, the Read line), as E00-T09's two lines went into
     E00-T10 (D-081). Otherwise a new task: a new id that is never reused (`E0X-T11`, or
     `E0X-T04a` for a split), a full section in the epic file, a row on the board. Several lines
     that close one kind of gap make one task (E00-T10 came from six lines, D-077). A line for a
     later epic stays on the list with a note after it ("→ E04-T00") until that epic is refined.
   - **Struck:** only with the reason written after it in your section.

   A decision entry is about 15 lines (Origin, What, Why, Revisit if), only for a choice that makes
   a document untrue (the data model, a rule, a convention, scope) or adds a dependency; the task
   text and the note hold the detail, and the entry points to them (D-087). Delete every line you
   handled from `discovered.md` (git history keeps it). Leave every other line exactly as it is.
4. **The board.** The task's row: status **Done**; its notes start "Merged by the owner (PR #n)."
   then one short line on what shipped and where its leftovers went, then "See
   `handoffs/$task.md`". The Done list: `- $task · <title> · merged <date> (PR #n)`. "Now": "Next
   task to start" names the next task of the Next list, with `/pipeline <id>` when it is Ready, or
   that this pass refines it, and the line below it names the decisions that task waits on, or
   none; drop the lines the merge settled, there and under "Owner actions (standing)"; add the
   owner lines from step 3. The Next list.
5. **The next task.** The first task of the Next list that is not Ready (Planned, "refined
   first", "split when refined"), or a Ready one that step 3 changed: run the **Ready pass** below
   for it, on this same branch. One task is the usual; two when they are the next two and both
   small. A task you leave as it is: say so in your reply, and why.
6. **Your section.** Append `## Architect — <date> (Done pass)` to
   `docs/progress/handoffs/$task.md` (the template's section): the branch; the result (Done, the
   merge commit, the run on `main`); what you changed on the board and in the logs; where each
   leftover went; "For the owner: still to do".
7. **Hand off.** Documents only: `git status --short` shows nothing under `src/`, `tests/` or
   `eslint-rules/`. One commit whose message starts with the task ids, as
   `E00-T09: Done (PR #15 merged); E00-T10: the two form-lint gaps folded in (D-081)`;
   `git push -u origin plan/$task-done`; `gh pr create --base main --title "$task: Done" --body
   "…"` with what changed and the owner's open decisions. Then the merge (D-087): when
   `git diff --name-only origin/main...HEAD` names only files under `docs/`, Markdown files under
   `.claude/`, `CLAUDE.md` and `README.md`, it is a documents-only pull request, on which CI does
   not run: merge it yourself, `gh pr merge <number> --merge` (a merge commit, as the owner's
   merges are). When it names anything else (a change the owner asked for, such as
   `.github/workflows/ci.yml`), the owner merges it on green. A merge that fails is left to the
   owner: never force it. Reply to the owner short and plain, what the owner must do first (a red
   run on `main`, a merge, a decision; each decision listed with your recommended answer), then: the
   pull request link and whether you merged it; the run on `main`; which task is Ready next and
   the command that starts it (`/pipeline <id>`, once the pull request is merged).

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
   - it stays inside the safety rails (agent rule 7), and its risk level follows `workflow.md`'s
     definition: critical when it touches an area of `test-strategy.md`'s table (name the area
     next to the level), otherwise normal or low, whatever else it changes (a lint rule, CI, a
     script, a process file).
3. **Edit the task** in the epic file: Role, Risk, Depends on, Read, Why, Do, Out of scope,
   Acceptance (`docs/process/templates/task.md`). Keep what is right; change what the code or the
   decisions made wrong. A choice you settle that makes a document untrue or adds a dependency
   gets a decision entry of about 15 lines, as in the Done pass, step 3 (`Origin: process,
   planning on <date>`; append, never edit an old one; "replaces D-0xx" when one changes); a
   choice inside the task's words is the task text. Keep `docs/architecture/*`,
   `docs/product/scope-v1.md` and `CLAUDE.md` true to it, in the same change. Where the choice is
   the owner's, ask as in the Done pass, step 3.
4. **The handoff note** `docs/progress/handoffs/<task>.md`: create it from the title line if it
   does not exist; append `## Architect — <date>` (the template's Ready-pass section): the
   branch; the result (Ready, or Planned or Blocked and why); "What was settled" (the owner's
   answers and your choices, each with its D-number);
   "Doc changes"; "For the builder: what is already there" (checked on `main` at `<sha>`: the
   files, functions and behaviours it builds on, the traps you found with your probes, what it
   must not change); "For the reviewer and tester" (what each criterion costs to check);
   "Questions for the owner".
5. **The board:** the task's row (Ready, and its Risk when you set it; notes: where it came from,
   its D-numbers, "See
   `handoffs/<task>.md`"), "Next task to start" and the Next list.
6. **Hand off** as in the Done pass, step 7, on the branch you are on, with the title
   `<task>: Ready` when the pass is its own.

## Never

- Write or commit application code, tests or migrations; a probe is thrown away.
- Edit a merged migration, an old decision entry, another role's handoff section, or
  `docs/intent.md`.
- Answer an open question yourself, or decide an item on agent rule 4's list without the owner.
- Mark a task Done whose pull request is not merged, or count a run on `main` as green whose
  conclusion is not `success`.
- Merge any pull request but your own documents-only one (Done pass, step 7), push to `main`,
  force-push, or start a `/pipeline` yourself.

# Handoff note template

One file per task: `docs/progress/handoffs/<task-id>.md`.
Each role appends its own section and never edits another role's section.
No personal data here, not even synthetic names: use ids.

Sizes (D-087): a builder section about 80 lines; a reviewer section about 40, plus one per
required change; a tester section about 60; a fix round as long as its table; an architect
section about 60. The evidence is the test case, the command and the CI run, named, not retold.
The cap is on the writing, not on the checking. Every finding, required change, suggestion and
Discovered line starts with its weight (agent rule 15): `data`, `message`, `speed`, `slice` or
`none`.

Sections appear in the order the work happened: builder, reviewer, tester. A fix round adds a
builder section after the reviewer or tester section it answers (for a red CI run, at the end);
a delta review adds a reviewer section at the end, and so does the critical review of a critical
task, after the tester and the delta review. An architect's Ready pass opens the note,
before the builder; its Done pass, after the owner's merge, closes it (`/architect <task-id>`,
D-083).

```markdown
# E0X-T0Y · Task title

## Architect — YYYY-MM-DD
**Branch:** plan/E0X-T0Y-ready (documents only; the architect merges it before the builder starts, D-087)
**Result:** Ready | Planned | Blocked

**What was settled** (the owner's answers and the architect's choices, each with its D-number)
- …

**Doc changes** (the task's section, files touched in docs/, Discovered lines deleted)

**For the builder: what is already there** (checked on `main` at <sha>)
- …

**For the reviewer and tester** (what each criterion costs to check)
- …

**Questions for the owner**
- …

## Builder — YYYY-MM-DD
**Branch:** task/E0X-T0Y-short-name
**Result:** Built | Blocked | Partly done

**What I built** (3 lines)

**Where** (main files or folders)

**Acceptance criteria**
| # | Criterion (short) | Met? | Test or command |
|---|---|---|---|
| 1 | … | yes | test `…` / command `…` / saw … on screen |

**Checks run in this session:** `<command>` → result

**Not done / known gaps**
- …

**Decisions and doc changes** (D-numbers, files touched in docs/)

**For the reviewer and tester: look hard at**
- …

**Try it** (only for a screen: the steps the owner can click through in the app, with the seed
login to use by role name, never a name or email)
1. …

**Questions for the owner** (they do not block; plain words, each with your recommended answer;
the architect's Done pass asks them after the merge)
- …

**Pull request:** <link>

## Reviewer — YYYY-MM-DD
**Result:** Reviewed | Changes required
**Reviewed commit:** <sha>
**CI run:** <link> (green on that commit)

**Checked:** scope stayed inside the task · safety rails (rule 7) · tests not weakened ·
docs updated · conventions

**Required changes**, weighed (rule 15)
1. …

**Suggestions (optional, not blocking; weighed (rule 15); each is also a line in `docs/progress/discovered.md`)**

**For the critical review** (only for critical tasks: what to read first, where the risk is)

## Builder — YYYY-MM-DD (fix round N)
**Fixes:** the required changes of the reviewer section above | the findings of the tester section above | the red CI run <link>: its failing steps (one row per step)

| # | Finding (short) | What I changed | Test that fails without the fix | Result |
|---|---|---|---|---|
| 1 | … | … | `…` | fixed |

**Checks run in this session:** `<command>` → result

## Tester — YYYY-MM-DD
**Result:** Tested | Back to builder

**Acceptance criteria**
| # | Criterion (short) | Met? | Case or command |
|---|---|---|---|
| 1 | … | yes | case `…` / command `…` |

**What I ran beyond the builder's tests** (case names and commands)
- …

**Findings** (each weighed (rule 15): what I did, what happened, what should happen)
1. …

**Tests I added**

**Questions for the owner** (they do not block; plain words, each with your recommended answer;
the architect's Done pass asks them after the merge)

## Reviewer — YYYY-MM-DD (delta review)
**Result:** Approved | Changes required
**Reviewed commits:** <the last commit a review read, which the pipeline names>..<sha>
**CI run:** <link> (its state on the last commit when you wrote; the pipeline waits for it)

**Required changes**, weighed (rule 15)
1. …

## Reviewer — YYYY-MM-DD (critical review)
**Result:** Approved | Changes required
**Reviewed commits:** main..<sha> (after a fix: <the end of your last critical review>..<sha>)
**CI run:** <link> (its state on the last commit when you wrote; the pipeline waits for it)

**Areas and cases** (each area of `test-strategy.md`'s table the task touches; the cases that
table and `security-privacy.md` ask for)
| # | Area | Case | Test |
|---|---|---|---|
| 1 | … | … | `…` · missing → required change 1 · added by me: `…` |

**Read line by line** (migrations and policies against `data-model.md`; where the diff reads or
writes who, which clinic, which patient, what is sent, what is deleted)

**Required changes**, weighed (rule 15)
1. …

**Suggestions (optional, not blocking; weighed (rule 15); each is also a line in `docs/progress/discovered.md`)**

**Tests I added**

## Architect — YYYY-MM-DD (Done pass)
**Branch:** plan/E0X-T0Y-done (documents only; pull request "E0X-T0Y: Done", merged by the architect, D-087)
**Result:** Done. Merged by the owner (PR #n) at <sha>; CI run on `main` <link>: green | red at step …

**What I changed** (the board, the logs, the tasks the leftovers went into)

**Where each leftover went**
| # | Leftover (weight · short) | From | Went to |
|---|---|---|---|
| 1 | `data` · … | builder question 1 · critical review · Discovered line of … | owner: … · D-0xx · E0X-T0Z Do item · struck: … |

**For the owner: still to do**
- …
```

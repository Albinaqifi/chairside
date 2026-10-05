# Handoff note template

One file per task: `docs/progress/handoffs/<task-id>.md`.
Each role appends its own section and never edits another role's section.
No personal data here, not even synthetic names: use ids.

Sections appear in the order the work happened: builder, reviewer, tester. A fix round adds a
builder section after the reviewer or tester section it answers (for a red CI run, at the end);
a delta review adds a reviewer section at the end. An architect's Ready pass opens the note,
before the builder; its Done pass, after the owner's merge, closes it (`/architect <task-id>`,
D-083).

```markdown
# E0X-T0Y · Task title

## Architect — YYYY-MM-DD
**Branch:** plan/E0X-T0Y-ready (documents only; the owner merges it before the builder starts)
**Result:** Ready | Planned | Blocked

**What was settled** (the owner's answers and the architect's choices, each with its D-number;
which one the owner should look at)
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

**What I built** (3–6 lines, plain words)

**Where** (main files or folders)

**Acceptance criteria**
| # | Criterion (short) | Met? | How I verified it |
|---|---|---|---|
| 1 | … | yes | test `…` / command `…` / saw … on screen |

**Checks run in this session:** `<command>` → result

**Not done / known gaps**
- …

**Decisions and doc changes** (D-numbers, files touched in docs/)

**For the reviewer and tester: look hard at**
- …

**Questions for the owner** (they do not block; the owner answers them before merging)
- …

**Pull request:** <link>

## Reviewer — YYYY-MM-DD
**Result:** Reviewed | Changes required
**Reviewed commit:** <sha>
**CI run:** <link> (green on that commit)

**Checked:** scope stayed inside the task · safety rails (rule 7) · tests not weakened ·
docs updated · conventions

**Required changes**
1. …

**Suggestions (optional, not blocking; each is also a line in `docs/progress/discovered.md`)**

**For the owner** (only for critical tasks: what to read first, where the risk is)

## Builder — YYYY-MM-DD (fix round N)
**Fixes:** the required changes of the reviewer section above | the findings of the tester section above | the red CI run <link>: its failing steps (one row per step)

| # | Finding (short) | What I changed | Test that fails without the fix | Result |
|---|---|---|---|---|
| 1 | … | … | `…` | fixed |

**Checks run in this session:** `<command>` → result

## Tester — YYYY-MM-DD
**Result:** Tested | Back to builder

**What I checked beyond the builder's tests**
- …

**Findings** (each: what I did, what happened, what should happen)
1. …

**Tests I added**

## Reviewer — YYYY-MM-DD (delta review)
**Result:** Approved | Changes required
**Reviewed commits:** <sha of the full review>..<sha>
**CI run:** <link> (its state on the last commit when you wrote; the pipeline waits for it)

**Required changes**
1. …

## Architect — YYYY-MM-DD (Done pass)
**Branch:** plan/E0X-T0Y-done (documents only; pull request "E0X-T0Y: Done")
**Result:** Done. Merged by the owner (PR #n) at <sha>; CI run on `main` <link>: green | red at step …

**What I changed** (the board, the logs, the tasks the leftovers went into)

**Where each leftover went**
| # | Leftover (short) | From | Went to |
|---|---|---|---|
| 1 | … | builder question 1 · reviewer "For the owner" · Discovered line of … | owner: … · D-0xx · E0X-T0Z Do item · struck: … |

**For the owner: still to do**
- …

## Owner — YYYY-MM-DD
Merged / sent back, with a line of why.
```

# Handoff note template

One file per task: `docs/progress/handoffs/<task-id>.md`.
Each role appends its own section and never edits another role's section.
No personal data here, not even synthetic names: use ids.

Sections appear in the order the work happened: builder, reviewer, tester. A fix round adds a
builder section after the reviewer or tester section it answers; a delta review adds a
reviewer section at the end.

```markdown
# E0X-T0Y · Task title

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

**Checked:** scope stayed inside the task · safety rails (rule 7) · tests not weakened ·
docs updated · conventions

**Required changes**
1. …

**Suggestions (optional, not blocking; each is also a line on the board's Discovered list)**

**For the owner** (only for critical tasks: what to read first, where the risk is)

## Builder — YYYY-MM-DD (fix round N)
**Fixes:** the required changes of the reviewer section above | the findings of the tester section above

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

**Required changes**
1. …

## Owner — YYYY-MM-DD
Merged / sent back, with a line of why.
```

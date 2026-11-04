# How the Chairside workflow came to be, and how to reuse it on another project

Reconstructed from the repository (git history, `docs/log/decisions.md`, the skills and agent files)
and your memory notes. **Caveat:** the sessions before 2 Oct 2026 (the planning phase) have no
transcripts on this machine, only a memory note from 25 Sep. Phases 0–2 below are inferred from
the documents they produced; phases 3–5 are documented in the decision log with dates.

---

## Part 1 — How it was built (the story)

### Phase 0 · Idea → two visual artefacts (before 25 Sep)
You started from a product idea and made two HTML files: an **Architecture Explorer** and a
clickable **Demo v3**. These are `design/originals/`. Lesson: you did not start with documents,
you started by making the idea concrete enough to argue about.

### Phase 1 · Requirements analysis (late Sep → 2 Oct)
A planning conversation turned the two files into a document set. Evidence:
- Your 25 Sep memory note: *"when sources have gaps or contradictions, list open questions
  instead of guessing"*, with `[P]` (proposal) and `[OQ-n]` tags in `intent.md`. This rule is
  the seed of the whole project.
- `docs/product/reconciliation.md`: a critical review of the two files against each other.
  Findings sorted into A (demo promises more than architecture), B (architecture needs screens
  the demo lacks), C (data model cannot hold what the demo shows), D (weak spots). Each finding
  has a resolution and a decision number.
- `docs/log/open-questions.md`: every owner-only decision (market, legal, hosting, pilot…) with
  a **working assumption** so planning can continue, and a "needed before" column.
- `docs/log/decisions.md`: D-001…D-063, one entry each (origin, what, why, revisit-if). The
  stack choices are in here too, with reasons.

### Phase 2 · Documents → backlog (≈ 1–2 Oct)
- `intent.md` (anchor, owner-only edits) → `roadmap.md` (milestones M0–M7, each ending in a demo
  someone can use) → one epic file per milestone in `docs/backlog/` → tasks.
- Epics E00–E02 fully specified, E03–E07 only **outlined**, with an "epic T00 refine" task.
  Deliberate: detail written months ahead is wrong by the time it is used.
- A task = Role, Risk, Depends on, Read, Why, Do, Out of scope, Acceptance (template in
  `docs/process/templates/task.md`). "Read" tells the agent the *only* docs it needs.
- Definition of Ready / Done in `workflow.md`. A task fits one session (~400 changed lines).

### Phase 3 · First build, and the process is born from pain (2–3 Oct)
- E00-T01 ran by hand: builder, then you as go-between, then tester. It took **3 rounds and 17
  tester findings**. You were relaying prompts between sessions.
- 3 Oct: **D-065** — builder → reviewer → tester, fix rounds, delta review, and `/pipeline`
  (one session that runs every role as a fresh subagent). Reason: the tester finds most
  defects, so the chain must absorb fix rounds without you.
- Fresh sessions per role is the key idea: a reviewer who shares the builder's context inherits
  its blind spots.

### Phase 4 · Trimming and automating the repeats (4–6 Oct)
Each change was triggered by *measuring* the real runs, not by theory:
- **D-075** CI on GitHub; the pipeline waits for green before review.
- **D-079** (4 Oct) after four runs (1h25–2h25 per task, notes of 440–900 lines): agents read
  less at start, Discovered list moved out of the board, reviewer does not re-run CI's checks.
- **D-083** (5 Oct) `/architect <task-id>`: you noticed you asked a session to write the same
  architect prompt five times (24 min each). Repeated prompt → skill.
- **D-087** (5–6 Oct): after 8 tasks, four of them lint guards: *weigh what you find*
  (`data / message / speed / slice / none`, in the order of `intent.md`), risk levels, the
  **critical review**, size caps on notes, "owner does not review code".

### Phase 5 · Scaling (12 Oct →)
Second checkout for two pipelines in parallel (needed per-folder ports and DB names), process
weight plan, baseline measurements kept in memory.

### The pattern underneath
1. Make the idea concrete (demo). 2. Attack it for contradictions and write down what only the
owner can decide. 3. Write the *why* once (`intent.md`). 4. Slice into thin, checkable tasks.
5. Separate roles, each in a fresh context, talking only through files. 6. Measure, then trim.
7. Any prompt you type twice becomes a skill.

---

## Part 2 — The kit (what to copy to a new project)

```
CLAUDE.md                         start ritual + never-broken rules + commands + conventions
docs/intent.md                    why / who / goals / constraints / non-goals / tie-break order (owner-only)
docs/README.md                    one-line job per document
docs/process/agent-rules.md       ~15 short rules, each with a "why"
docs/process/workflow.md          roles, states, risk levels, Ready/Done, git, handoffs
docs/process/test-strategy.md     levels + "what gets a second review" table
docs/process/templates/{task,handoff}.md
docs/product/{roadmap,scope-v1}.md
docs/architecture/{overview,data-model,security}.md   (only what the project needs)
docs/backlog/README.md + E00-….md…   epics, tasks
docs/progress/{board,discovered}.md + handoffs/<task>.md
docs/log/{decisions,open-questions,risks}.md           append-only
.claude/agents/{architect,builder,reviewer,tester}.md
.claude/skills/{pipeline,architect}/SKILL.md           (disable-model-invocation: true)
.github/workflows/ci.yml          CI the pipeline waits on
```

**Keep generic:** the roles, states, Ready/Done, handoff template, fix-round limit (2), delta
review, weights, pipeline and architect skills (replace "Chairside"/"owner" names, the
`pnpm` commands, the `clinic_id` rules).
**Rewrite per project:** `intent.md`, the "never broken" rules (Chairside: tenant isolation,
patient data, message pipeline), the critical-areas table, the stack decisions.

Start **small** — Chairside's current docs are 10,000 lines and were trimmed repeatedly. Day one
you need: `intent.md`, `agent-rules.md`, `board.md`, one epic, the task/handoff templates, the
builder/reviewer/tester agent files. Add the architect skill, risk levels and critical review only
when you feel the pain they solve.

---

## Part 3 — Run it on a new project, step by step

Each step is its own fresh Claude Code session. Hand over by files, never by chat.
Replace `<…>`.

### Session 1 · Discovery / requirements (you + Claude, interactive)
Goal: `docs/intent.md`, `docs/log/open-questions.md`, `docs/product/scope-v1.md`.
> I want to build `<idea>` for `<users>`. Interview me, one topic at a time, until you can write
> `docs/intent.md` (one sentence, problem, who pays, users and needs, v1 goals, constraints,
> non-goals, and an ordered "how to decide when things conflict" list). Rules: when something is
> undecided or contradicts something I said, do not guess. Write it as an open question with
> options and your recommendation, and tag invented details `[P]`. Push back, with reasons,
> when you think a decision of mine is wrong. Explain jargon plainly. At the end, list the
> open questions that block the first milestone.

### Session 2 · Reconcile and design (only if you have a prototype/design/spec)
Goal: `reconciliation.md`, `architecture/*`, first `decisions.md`.
> Read `<prototype/spec files>` and `docs/intent.md`. Review them critically against each other.
> List every gap and contradiction in three groups (design does more than architecture; architecture
> needs things the design lacks; data model cannot hold what the design shows) plus weak spots.
> For each: resolution + decision id, or an open question if it is mine to decide. Then write
> `architecture/overview.md` (stack, processes, modules, request flow), `data-model.md`,
> `security-privacy.md`, and `decisions.md` (one entry per stack choice: origin, what, why,
> revisit-if). Prefer boring technology; I am one developer with AI agents.

### Session 3 · Roadmap and backlog (the "stories" session)
Goal: `roadmap.md`, `backlog/*`, `board.md`, templates.
> Read intent, scope, architecture. Write `roadmap.md`: milestones in dependency order, risk early,
> thin end-to-end slices, each ending in a demo I can click. Then one epic file per milestone.
> Fully specify the first two epics; outline the rest, each with a T00 "refine this epic" task.
> Each task uses `templates/task.md`: Role, Risk, Depends on, Read, Why, Do, Out of scope,
> Acceptance. Acceptance criteria must be testable with a clear pass/fail, including unhappy paths.
> One task = one session = under ~400 changed lines; split otherwise. Create `board.md` with
> every task's state. Status lives only on the board.

### Session 4 · Process kit (once, then copy it)
> Read `docs/process/*` from `<path to Chairside>` and adapt them to this project: keep the
> roles, states, Definition of Ready/Done, handoff template, delta review and the two-fix-round
> limit. Replace project-specific rules with ones from our `intent.md` constraints. Draft the
> critical-areas table from our risks. Create `.claude/agents/*` and `.claude/skills/pipeline`,
> `architect`. Write `CLAUDE.md` (start ritual, never-broken rules, commands).

### Session 5 · Refine the first task (`/architect <T00>`), then `/pipeline <T01>`
Same loop as here: `/architect` (make Ready) → `/pipeline` (builder → CI → reviewer → tester →
fixes → delta review) → you merge on green → `/architect <task>` (mark Done, settle leftovers,
refine next). After the first 3–4 tasks, **measure** (minutes per role, notes length) and trim.

---

## Part 4 — Lessons worth carrying (from your own memory notes and the log)

- **Short, plain replies; action first.** Every question to the owner carries a recommended
  answer, in product words, never function names.
- **Never make the owner a relay** between roles. If you type the same prompt twice, make a skill.
- **A pipeline session never fixes the process;** it writes a note, you fix it elsewhere.
- **Fresh context per role** and **read less at the start** (rule 1) kept quality up.
- **Weigh findings by what they protect**; otherwise lint guards eat the project.
- **Outline far epics, specify near ones.**
- **Open questions with working assumptions** beat both guessing and blocking.
- **Windows:** no bash-only scripts in `package.json`; `gh` path; long Bash commands fail.
- Cost reality: ~1.5–2.5 h per task, ~20–25 min per fix round. Decide if that suits the new project.

## Part 5 — Suggested simplification for a smaller project
Skip: critical review, weights, two-checkout parallelism, per-task decision entries. Keep:
intent, rules, board, task template, builder → reviewer → tester with fresh contexts, handoff note,
CI, `/pipeline`.

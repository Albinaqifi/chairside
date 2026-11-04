# New project: the sessions to run, in order, with copy-paste prompts

Background and reasons: `porting-the-workflow.md`. This file is the doing.

**Rules for all sessions**
- One **new** Claude Code session per step (`/clear` or a new window). Sessions talk through
  files, never through your memory of the chat.
- Open the session in the **new project's folder**.
- After each step: read what it wrote, say "commit it", then go on. Do not start the next step
  until the "Done when" line is true.
- Replace only the `<…>` parts. Everything else is copy-paste.

| # | Session | Who talks | Roughly | Produces |
|---|---|---|---|---|
| 0 | Setup | you | 10 min | folder, reference kit, `notes/idea.md` |
| 1 | Discovery interview | you + Claude | 45–90 min | `intent.md`, open questions |
| 2 | Architecture and decisions | you + Claude | 45–90 min | `architecture/*`, `decisions.md` |
| 3 | Scope and roadmap | you + Claude | 30–60 min | `scope-v1.md`, `roadmap.md` |
| 4 | Process kit | Claude, you approve | 30–60 min | rules, workflow, agents, skills, `CLAUDE.md` |
| 5 | Backlog | Claude, you answer | 60–120 min | epics, tasks, board |
| 6 | Plan review (fresh eyes) | Claude | 20–40 min | list of holes, fixed |
| 7 | First task | `/architect`, `/pipeline` | hours | first merged task |

---

## Session 0 · Setup (you, by hand)

PowerShell. Change the two paths first.

```powershell
$new = "C:\Users\Albin\<new-project>"
$src = "C:\Users\Albin\chairside_2"
New-Item -ItemType Directory -Force "$new\notes", "$new\reference" | Out-Null
Copy-Item "$src\docs\process" "$new\reference\chairside-process" -Recurse
Copy-Item "$src\.claude\agents", "$src\.claude\skills" "$new\reference\" -Recurse
Copy-Item "$src\docs\README.md", "$src\docs\backlog\README.md" "$new\reference\"
Copy-Item "$src\CLAUDE.md" "$new\reference\CLAUDE.chairside.md"
Copy-Item "$src\docs\intent.md" "$new\reference\intent.chairside.md"
Copy-Item "$src\docs\process\porting-the-workflow.md" "$new\reference\"
cd $new; git init
```

Then create `notes\idea.md` and dump everything you have, messy is fine: the idea, who it is for,
what exists today, competitors, what you already decided, what you are afraid of. Put any
prototype, screenshots, spec or design files in `notes\` too.

**Done when:** `reference\` and `notes\idea.md` exist.

---

## Session 1 · Discovery interview

Goal: the "why" written down, and every owner-only decision listed instead of guessed.

```
You are my product analyst. I am a developer/QA with about 3-4 years of experience building
<one-line idea> alone, with AI agents. Explain jargon plainly.

Read notes/idea.md and every other file in notes/. Also read reference/intent.chairside.md only
as an example of the format and level of detail, not for content.

Interview me to write docs/intent.md. Rules:
- Ask 3-5 questions at a time, about one topic at a time, in this order: the problem and who has
  it; who pays and why they would; each kind of user and what they need; goals for version 1;
  constraints (people, money, law/privacy, time); non-goals.
- When I am vague, offer 2-3 concrete options with your recommendation and ask me to pick.
- When something is undecided, or contradicts something I said earlier, do NOT guess. Write it
  to docs/log/open-questions.md as Q-01, Q-02... with: the question, options, your
  recommendation, a working assumption so planning can continue, and "needed before" (which
  milestone is blocked until it is answered). Tag details you invented as [P] (proposal).
- If you think a decision of mine is wrong, say so with the reason.
- Finish docs/intent.md with "How to decide when things conflict": an ordered list of what
  wins over what (for example safety beats speed beats features). I will approve the order.

Sections of intent.md: In one sentence / The problem / Why someone would pay / Who uses it and
what they need / Goals for version 1 / Constraints / Non-goals / How to decide when things
conflict. Keep it short: a new person must read it in 5 minutes.

At the end, show me the open questions that block the first milestone and ask me to answer
or defer each. Record my answers in the file (Answered <date>), and do not edit intent.md
after I approve it.
```

**Done when:** `docs/intent.md` approved by you; `docs/log/open-questions.md` exists with answers
or deferrals. Commit.

---

## Session 2 · Architecture and decisions

Goal: stack, data, security, each choice with a reason.

```
You are a software architect. I am one developer working with AI agents, so prefer simple,
common, boring technology and few moving parts.

Read docs/intent.md and docs/log/open-questions.md. Read everything in notes/ (including any
prototype or spec). Look at reference/chairside-process and reference/CLAUDE.chairside.md only
for the format of decisions and the architecture documents.

Do this in order:
1. If notes/ holds a prototype, design or spec: review it critically against intent.md and
   write docs/product/reconciliation.md. Group findings as: (A) the design promises more than
   we should build; (B) things the system needs that the design has no screen for; (C) things
   the data would need to store but cannot; (D) weak spots. For each: the finding, and the
   resolution with a decision id, or an open question if it is mine to decide.
   If there is no prototype, skip this step.
2. Propose the stack and the main design choices, as a short list with 2 options each and your
   recommendation. Ask me to confirm or change them before writing anything.
3. After my answers write: docs/architecture/overview.md (stack, processes, modules, folder
   structure, how one request flows), docs/architecture/data-model.md (tables, fields, state
   machines, constraints), and the security/privacy document if the product holds personal or
   sensitive data (who can see what, what is logged, what leaves the system).
4. Write docs/log/decisions.md, append-only: D-001... one entry each, with Origin, What, Why,
   Revisit if. Also docs/log/risks.md, short.
5. Add anything that is mine to decide to docs/log/open-questions.md. Never answer those yourself.

Keep each document to what an agent needs to build, not an essay.
```

**Done when:** you understand and agree with the stack; every decision has a reason. Commit.

---

## Session 3 · Scope and roadmap

Goal: what is in version 1, in what order, each step ending in something you can click.

```
You are a product manager and delivery planner.

Read docs/intent.md, docs/architecture/overview.md, docs/architecture/data-model.md,
docs/log/decisions.md (headings first, then entries you need) and docs/log/open-questions.md.

1. Write docs/product/scope-v1.md: screen by screen or feature by feature, what is IN version 1,
   what is deliberately OUT, and for each item that goes beyond intent.md, why.
2. Write docs/product/roadmap.md:
   - Order by: dependencies first; value early in thin end-to-end slices; risk early (the
     hardest and most dangerous parts first, while change is cheap); decide late what can wait.
   - Milestones M0, M1, ... Each has: name, epic id (E00, E01, ...), "Ends with" (a demo I can
     run myself, from the screen to the database), "Needs first" (milestones and open questions).
   - M0 is always the foundation: running app, login, whatever isolation or security the
     product needs, CI. 
   - Add "The cut line": what can ship after the first real user without rework, and what can
     never be cut.
   - Add "What version 1 does not contain" and a short "After version 1".
3. Show me the milestone table and ask me to confirm the order before you finalise.
Anything that needs my decision goes to docs/log/open-questions.md with a working assumption.
Record changes of the original plan as new decisions in decisions.md.
```

**Done when:** you can say, for each milestone, what you will click at the end. Commit.

---

## Session 4 · Process kit

Goal: the roles, rules and commands, adapted from Chairside to this project.

```
You are setting up the working process for this project. It is a copy of the process we used on
the Chairside project, adapted. Read these first, in this order:
docs/intent.md, docs/architecture/overview.md, docs/product/roadmap.md, then everything in
reference/ (chairside-process/, agents/, skills/, README.md, CLAUDE.chairside.md,
porting-the-workflow.md).

Create, adapting every file to THIS project (no mention of Chairside, clinics, patients, pnpm
unless it truly applies):
1. docs/process/agent-rules.md: about 15 short rules, each with a "why". Keep the structure:
   read in order and no more; check the task is Ready; one task one branch; STOP-and-ask list
   (agent rule 4); no real personal data; tests are not negotiable; do not invent; match what
   is there; docs are the plan; done means you ran it; say what is not done; hand off cleanly;
   weigh what you find. Rewrite the safety rails and the weights for this project using the
   constraints and the conflict order in docs/intent.md.
2. docs/process/workflow.md: roles, task states (Planned, Ready, In progress, Built, Reviewed,
   Tested, Done, Blocked), risk levels low/normal/critical, Definition of Ready, Definition of
   Done, git rules (one branch and one pull request per task, agents never merge to main),
   handoffs, the board, when the pipeline stops for the owner (two automatic fix rounds).
3. docs/process/test-strategy.md: test levels for the stack in docs/architecture/overview.md,
   and a table of "areas that get a second review (critical)" derived from our risks.
4. docs/process/templates/task.md and handoff.md (keep sizes and sections).
5. docs/progress/board.md (empty for now), docs/progress/discovered.md, docs/progress/handoffs/.
6. .claude/agents/architect.md, builder.md, reviewer.md, tester.md.
7. .claude/skills/pipeline/SKILL.md and .claude/skills/architect/SKILL.md, with
   disable-model-invocation: true, adapted to our commands and CI.
8. CLAUDE.md: start-of-session ritual, the rules never broken, the command table (leave
   <TODO> for commands that do not exist yet), folder structure, conventions.
9. docs/README.md: one line per document saying its job. docs/backlog/README.md: task format.
10. .github/workflows/ci.yml only if the stack is chosen; otherwise a task for it in E00.

Constraints: Windows is my OS (no bash-only commands in scripts). Keep every file shorter than
its Chairside original unless the project needs more. When you have to guess a rule for this
domain, list it at the end as "Rules I invented, please confirm".
```

**Done when:** you read `agent-rules.md` and the "Rules I invented" list and agree. Commit.

---

## Session 5 · Backlog

Goal: epics and tasks that pass the Definition of Ready, the first two fully, the rest outlined.

```
You are the architect. Follow docs/process/workflow.md and docs/process/templates/task.md.

Read docs/intent.md, docs/process/agent-rules.md, docs/product/roadmap.md, docs/product/scope-v1.md,
docs/architecture/*, docs/log/open-questions.md.

1. Create docs/backlog/E00-<name>.md ... one file per roadmap milestone, plus docs/backlog/README.md
   (the epic index with milestone, outcome, number of tasks and detail level).
2. Fully specify E00 and E01: every task has Role, Risk, Depends on, Read, Why, Do, Out of
   scope, Acceptance. Acceptance criteria describe behaviour a tester can check with a clear
   pass or fail, and include the unhappy paths (wrong role, bad input, double click, other
   user's data). A task fits one agent session: under about 400 changed lines. Split if not
   (E00-T04a, E00-T04b). Set the risk level using the critical table in test-strategy.md and
   name the area for critical tasks.
3. Outline the other epics: every task has all its fields but less detail, and each epic starts
   with a T00 task "Refine this epic against what was built".
4. E00-T01 is the project skeleton: repo structure, tooling, the single check command, CI, a
   seed with SYNTHETIC data only.
5. Task ids never change and are never reused. Any task that touches an open question must name
   the working assumption and be flagged.
6. Fill docs/progress/board.md: every task with state Planned (the first task Ready), a "Now"
   and "Next" section, "Blocked", "Done".
7. Do not write status in the epic files. Status lives only on the board.

Ask me about anything that is mine to decide. At the end list which tasks are Ready, which
are Planned, and the 5 riskiest tasks.
```

**Done when:** E00-T01 is Ready on the board. Commit.

---

## Session 6 · Plan review (fresh eyes; my addition, not in the Chairside history)

Goal: catch contradictions before agents build on them. It costs 30 minutes; a wrong plan costs days.

```
You are a skeptical reviewer who did not write any of these documents. Do not praise.

Read docs/intent.md, docs/process/*, docs/product/*, docs/architecture/*, docs/log/*,
docs/backlog/*, docs/progress/board.md and CLAUDE.md.

Find, with file and line:
1. Contradictions between documents (stack, names, rules, states, ids).
2. Tasks that are not truly Ready: missing dependency, untestable acceptance criterion, too
   big for one session, depends on an open question without a working assumption.
3. Anything in the roadmap order that violates its own rules (a task needing something built later).
4. Rules in agent-rules.md that no role file or skill enforces, and role steps no rule backs.
5. Risks from intent.md "Constraints" that no task or test covers.
6. Documents that repeat each other (one fact in two places will drift).

Report as a list ordered by what it protects (following the conflict order in intent.md).
Do not fix anything. Then ask me which to fix, and fix only those, in the right document.
Append decisions to docs/log/decisions.md; never edit old ones.
```

**Done when:** you fixed the holes you agreed with. Commit.

---

## Session 7 · The loop, per task (repeat forever)

New session each time, in this order. These are the commands from Chairside (adapted in session 4).

1. **`/architect E00-T01`** — only if the task is not Ready yet. (Planned → Ready, a `plan/…` pull request.)
2. **`/pipeline E00-T01`** — builder → CI → reviewer → tester → fixes → delta review. It stops for you only
   when the rules say so. Before you leave: permission mode that does not ask before every command, Docker
   running if used, computer on.
3. **You merge the pull request** on green. You do not review code; you decide what rule 4 lists and
   use the product.
4. **`/architect E00-T01`** again — marks it Done, settles leftovers, makes the next task Ready.
5. Next task: back to step 2.

After the **third or fourth** task, stop and measure: minutes per role, length of handoff notes,
what agents got wrong repeatedly. Change one thing at a time and log it as a decision. That is how
Chairside's pipeline got from 2.5 hours per task to something smaller.

---

## If something goes wrong

- **A session wrote the wrong thing:** do not argue in the same session; say what is wrong, let it fix,
  or `git restore` and re-run with a sharper prompt.
- **Pipeline stopped:** read the one-line reason; answer in the handoff note or on the board; run
  `/pipeline <task>` again, it resumes from the board.
- **You typed the same prompt twice:** make it a skill.

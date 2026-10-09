# Documentation map

Each document has one job. Read only what your task points you to.

## Always read

| File | Job |
|---|---|
| [intent.md](intent.md) | Why this product exists, for whom, goals, constraints, non-goals. Owner-only edits. |
| [process/agent-rules.md](process/agent-rules.md) | The working rules every agent follows. |
| [progress/board.md](progress/board.md) | Status of every task. The single place status lives. Also the owner's standing actions. |

## Product

| File | Job |
|---|---|
| [product/roadmap.md](product/roadmap.md) | What version 1 contains, the milestones, the order and why. |
| [product/scope-v1.md](product/scope-v1.md) | Screen by screen: what is in v1, what changed from the demo, what is out. |
| [product/design-reference.md](product/design-reference.md) | How to use the HTML demo: screen index with line ranges, design tokens, deliberate differences. |
| [product/reconciliation.md](product/reconciliation.md) | The review of the two original files: every gap and contradiction found, and how each was resolved. Background reading, not needed for most tasks. |

## Architecture

| File | Job |
|---|---|
| [architecture/overview.md](architecture/overview.md) | The system in one page: stack, processes, modules, folder structure, how a request flows. |
| [architecture/data-model.md](architecture/data-model.md) | Every table, its fields, state machines and constraints. The target schema. |
| [architecture/messaging.md](architecture/messaging.md) | How messages are planned and sent: timing rules, idempotency, quiet hours, caps, retries. |
| [architecture/security-privacy.md](architecture/security-privacy.md) | Rules for health data: tenancy, auth, patient links, AI boundary, logging, retention, the go-live gate. |

## Process

| File | Job |
|---|---|
| [process/workflow.md](process/workflow.md) | How a task moves from planned to done. Roles, the pipeline, Definition of Ready, Definition of Done, handoffs. |
| [process/test-strategy.md](process/test-strategy.md) | What is tested how, AI evals, and the areas that get a second review (the critical review), which define a critical task. |
| [process/templates/](process/templates/) | Templates for tasks and handoff notes. |

## Work

| File | Job |
|---|---|
| [backlog/README.md](backlog/README.md) | Epic index and the task format. One file per epic next to it. |
| [progress/board.md](progress/board.md) | Status board. |
| [progress/handoffs/](progress/handoffs/) | One note per task, appended by each role that worked on it. |
| [progress/discovered.md](progress/discovered.md) | Things agents noticed outside their task, one line each, weighed by agent rule 15. Not read at the start of a session; the architect turns `data` and `message` lines into work. |

## Operations

| File | Job |
|---|---|
| [runbook.md](runbook.md) | How the operator runs the system by hand: creating a clinic and its first owner (`pnpm clinic:create`); the host's part comes with E00-T07. |

## Logs (append-only)

| File | Job |
|---|---|
| [log/decisions.md](log/decisions.md) | Every decision with its reason, including changes to the original plan and the stack choices. |
| [log/risks.md](log/risks.md) | What could hurt the project and what we do about it. |
| [log/open-questions.md](log/open-questions.md) | Decisions that belong to the owner. Agents never guess these. |

## Outside `docs/`

| Path | Job |
|---|---|
| `CLAUDE.md` | Loaded automatically by every agent session: start ritual, the rules that are never broken, technical conventions. |
| `.claude/agents/` | Role definitions (architect, builder, tester, reviewer) for Claude Code. |
| `.claude/skills/pipeline/` | `/pipeline <task-id>`: runs one task through builder, reviewer and tester, each as a fresh subagent. |
| `.claude/skills/architect/` | `/architect <task-id>`: the architect pass after a merge (Done, leftovers, the next task Ready) or before a task starts (Ready). |
| `design/unpacked/` | Readable copies of the original HTML design files, and how to regenerate them. |

## Who reads what

| Role | Usually reads |
|---|---|
| Architect | intent, the architecture docs, decisions, open questions, the epic being refined |
| Builder | intent, rules, the task, the docs the task lists, `CLAUDE.md` conventions |
| Tester | intent, rules, the task, test-strategy, the builder's sections of the handoff note |
| Reviewer | intent, rules, the task, security-privacy, the diff, the builder's sections of the note (delta review: its own section and those after it; critical review: the first reviewer's "For the critical review" lines, test-strategy's table, security-privacy, data-model and the tests, and its own earlier critical reviews) |

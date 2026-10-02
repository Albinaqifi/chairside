# Chairside

Scheduling app for dental clinics with automated patient communication. Multi-clinic,
holds health data, built by one developer with AI agents.

**Status: planning is done, no application code exists yet.** The first build task is
`E00-T01` in `docs/backlog/E00-foundation.md`.

## Start of every session (in this order)

1. `docs/intent.md` — what we build and why. Short. Always read it.
2. `docs/process/agent-rules.md` — the working rules. Short. Always read it.
3. `docs/progress/board.md` — what is done, in progress, next, blocked.
4. Your task in `docs/backlog/` — then **only** the documents its "Read" line lists.

Do not read the whole `docs/` tree. `docs/README.md` is the map if you need to find something.

## Rules that are never broken

- **No real patient data** anywhere outside production. Synthetic data only.
- **Every tenant table has `clinic_id` and Row-Level Security.** No query bypasses the tenant context.
- **Every outgoing message goes through the message pipeline** (a row in `messages` first). Never call a provider directly.
- **Nothing AI-written reaches a patient without human approval,** and no patient identifiers go to the AI.
- **No patient data in logs, errors, test snapshots, commits or handoff notes.**
- **Stay inside your task.** Found something else? Write it in the board's "Discovered" list. Do not fix it.
- **Never weaken or delete a test to make it pass.**
- **Stop and ask the owner** when the rules say so (`agent-rules.md`, rule 4).

## Design reference

The two HTML files in the repo root are the original plan and UI design. They are compressed
bundles; readable copies are in `design/unpacked/`. They are a **visual and behavioural
reference, not code to copy**. Where the demo and the docs disagree, the docs win
(`docs/product/design-reference.md` lists every deliberate difference).

## Technical conventions

_To be written by task E00-T01 (commands, folder structure, coding conventions, testing
commands). Until then, the intended stack and structure are in `docs/architecture/overview.md`._

# Agent rules

Every agent on this project follows these, whatever its role. They are short on purpose.
The **why** is included where it matters, because a rule you understand is a rule you can
apply to a case nobody foresaw.

If a rule and your task conflict, the rule wins and you stop and say so.

---

## Before you start

**1. Read in this order, and no more.**
`docs/intent.md` → this file → `docs/progress/board.md` → your task → only the documents on
your task's "Read" line → the task's handoff note if one exists.
"Your task" is its own section of the epic file, from its `### <task-id>` heading to the next
`###`, plus the epic's introduction above the first task; another task only when yours names
it. Of the handoff note, read the sections your role needs: your role file in `.claude/agents/`
says which. Read a long file in parts and a log only for what you look for: everything you read
stays in your context for the whole session.
*Why:* your attention is limited. Agents that load everything get worse at the one thing
they were asked to do. The task tells you what you need.

**2. Check the task is Ready before touching anything.**
Dependencies done? Acceptance criteria clear? No open question blocking it?
If not, do not start: mark it Blocked on the board with the reason.

## While you work

**3. One task, one branch, one session. Stay inside the task.**
Do what the task says, no more. You will notice other things: a bug, an ugly function, a
missing feature. Write one line in `docs/progress/discovered.md` and move on.
*Why:* "while I was here" changes are the main way agents break working code and make
reviews impossible. A small diff can be checked. A large one gets waved through.

**4. Stop and ask the owner. Do not decide yourself when:**
- an open question (`docs/log/open-questions.md`) affects what you are building;
- you need to change the data model beyond what the task says;
- you want to add a library, a service, or a new environment variable with a secret;
- the change touches login, permissions, tenant isolation, link tokens, consent, or what is
  sent to the AI, and the task did not ask for exactly that;
- something would delete or overwrite data, rewrite a merged migration, or be hard to undo;
- anything would send a real message or cost money;
- the acceptance criteria are ambiguous in a way that changes behaviour;
- you cannot make the tests pass without changing what the tests expect;
- the task turns out to be much bigger than one session.

How to stop: write what you found, the options, and your recommendation in the handoff
note; set the task to **Blocked** on the board; end the session. When the pipeline started
you, ending is how you hand the question over: the pipeline tells the owner. You cannot ask
the owner yourself and wait for an answer.
*Why:* a wrong guess in these areas is expensive or irreversible. A question costs minutes.

**5. No real patient data. Ever. Anywhere but production.**
Use the seed generator. Invented names, test phone ranges, `@example.test` emails.
Never paste real data into code, tests, fixtures, prompts, commits or notes, even if the
owner's message contains some: say so and ask for a synthetic version.
You never have production credentials and never connect to production.

**6. No personal data in logs, errors, snapshots, commits or handoff notes.**
Log ids and codes. This applies to synthetic data too, so the habit holds.

**7. Never go around the safety rails.**
- Database access only through the tenant wrappers. Every new table gets `clinic_id` and a policy.
- Every outgoing message is a `messages` row first. Never call a provider directly.
- The AI is called only through the aftercare prompt builder. Nothing patient-identifying goes in.
- Business logic never reads the system clock. "Now" is passed in.
- Staff actions go through the action wrapper (auth, permission, validation, audit).
*Why:* each of these exists because the failure it prevents is silent and serious: another
clinic's data, a duplicate SMS, a leaked name, a reminder at the wrong hour.

**8. Tests come with the code, and tests are not negotiable.**
Write tests for what you build. Never delete, skip or weaken a test to get a green run.
If a test is wrong, say why in the handoff note and let the tester or owner decide.
*Why:* an agent under pressure to finish will "fix" the test instead of the code. The tests
are how the owner knows what you say is true.

**9. Do not invent.**
If you cannot see a function, option or API in the code, the installed package or its
documentation, it does not exist. Check before you call it. No new dependency without a
decision-log entry (and see rule 4).

**10. Match what is there.**
Read two or three neighbouring files first. Follow `CLAUDE.md` conventions, existing names
and patterns. The demo HTML is a visual reference, not code to copy
(`docs/product/design-reference.md`).

**11. Docs are the plan. Keep them true.**
If the code must differ from a document, change the document in the same change:
- data model change → `data-model.md` + decision log
- a decision others must know → `docs/log/decisions.md` (append, never edit old entries)
- a new risk → `docs/log/risks.md`
- something only the owner can decide → `docs/log/open-questions.md`
Never edit `docs/intent.md`. Never rewrite history in the logs.

## When you finish

**12. "Done" means you ran it and saw it pass.**
Run the full check command from `CLAUDE.md`. For each acceptance criterion, write how you
verified it (command, test name, or what you saw on screen). "Should work" is not a result.
The reviewer is the exception: it reviews a commit CI has already run (the pipeline starts a
full review only on a green run) and names that run instead of running the check again. A single
command to settle a doubt of its own is fine; the full check only when the commit has no green
run (a review started by hand).

**13. Say what is not done.**
Tests you could not run, criteria you did not meet, shortcuts you took, things you are
unsure about: list them plainly. A clear "this part failed" is worth more than a tidy
summary that hides it.

**14. Hand off cleanly.**
1. Append your section to `docs/progress/handoffs/<task-id>.md` (template in `docs/process/templates/`).
2. Update the task's row on `docs/progress/board.md`.
3. Commit on the task branch with the task id in the message, and push the branch. The
   builder opens the pull request if there is none yet (`gh pr create`). Never merge a task
   pull request; the architect merges its own documents-only planning pull request (D-087),
   and every other pull request is the owner's to merge. Never push to `main`, never
   force-push.
4. Stop. Do not start the next task in the same session.
*Why:* the next agent has none of your context. The note, the board and the pull request are
all it gets.

## What matters most

**15. Weigh what you find.** Look as hard as the rules say, and write down everything you
notice. But every finding, suggestion and Discovered line says what it protects, in one word at
the start of its text (a Discovered line: `date · task · weight · what you saw`): `data`
(patient data safety, tenant isolation, login), `message` (the right message to the right
patient at the right time, and nothing sent by mistake), `speed` (front-desk speed), `slice` (a
thin slice that works end to end), or `none`. That is the order of `docs/intent.md`, and the
order of the work: `data` and `message` are always work; `speed` and `slice` are work when a task
on the Next list needs them; `none` is kept as a note for reviewers and is not built. The lint
guards are finished (D-087): a new way past one is a review check, weighed `none`, not a task,
unless product code on `main` would hit it today. A finding against the task's own acceptance
criteria or these rules goes back to the builder whatever its weight: the weights order what is
left over (suggestions, Discovered lines, the architect's leftovers).
*Why:* care spread evenly is care spent on the wrong things. A guard against a mistake nobody
has made costs as much as one that protects a patient, and the hours come from the same place.

---

## Role-specific additions

**Architect.** You write and refine tasks and documents, not application code. A task you
mark Ready must pass the Definition of Ready (`workflow.md`). You record every decision.

**Builder.** You implement one task and its tests. You do not review your own work. When the
task comes back with findings, you fix exactly those: nothing else, and never by changing
what a test expects (rule 8).

**Reviewer.** You read the diff with fresh eyes against the task, these rules,
`security-privacy.md` and the conventions. You look hardest at rule 7. You do not rewrite:
you approve, or list required changes. You confirm the docs were updated (rule 11). When a
task comes back after your full review, you read only the commits since then. A critical task
also gets the critical review: a second, independent review by a fresh reviewer, after the
tester and the delta review check, that starts from the tests (`.claude/agents/reviewer.md`).

**Tester.** You come after the review. You start from the acceptance criteria and the handoff
note, not from the code. Try to break it: wrong role, other clinic, double click, bad input,
wrong time zone. You may add tests. You do not fix product code: you report, and the task
goes back to a builder.

**Owner.** Decides what rule 4 lists, asked in plain words with a recommendation first.
Merges every task pull request on green and on the pipeline's "ready to merge". Uses the
product: the milestone check, the receptionist trial (Q-09), a screen's "Try it" steps. Does
not review code: the reviewer, the tester and, for a critical task, the critical review do.

---

## Quick self-check before handing off

- [ ] Only files my task needed were changed
- [ ] Full checks pass; I ran them in this session
- [ ] Every acceptance criterion has a "how verified" line
- [ ] No real or personal data anywhere I wrote
- [ ] New tables have `clinic_id` + policy; no direct provider, AI or clock calls
- [ ] Docs updated if behaviour or schema differs from them
- [ ] Every finding, suggestion and Discovered line I wrote starts with its weight (rule 15)
- [ ] Handoff note written, board updated, branch pushed; nothing merged by me (the architect:
      only its own documents-only planning pull request)

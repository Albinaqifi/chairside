# Task template

Copy this block into the epic file. Keep it short: a task is an instruction, not an essay.

```markdown
### E0X-T0Y · Short title that names the outcome

- **Role:** builder | architect | tester | owner
- **Risk:** low | normal | critical
- **Depends on:** E0X-T0Z, … (or "none")
- **Read:** the documents and sections needed, and nothing else.
  For screens: `scope-v1.md` section + `design-reference.md` line ranges.

**Why.** One or two sentences: the value, or what breaks without it.

**Do.**
- Concrete steps or outcomes.
- …

**Out of scope.** What a reasonable agent might be tempted to add, and must not.

**Acceptance.**
- [ ] Something a tester can check, with a clear pass or fail.
- [ ] …
```

## Writing good acceptance criteria

- Describe **behaviour**, not implementation: "booking a second appointment in the same slot
  is refused with a clear message", not "uses an exclusion constraint".
- Include the unhappy paths: wrong role, other clinic, bad input, double click.
- Name the test level when it matters: "integration test proves…", "journey J3 passes".
- If a criterion needs data, say which seed data.
- If you cannot write a checkable criterion, the task is not understood well enough yet.

## Sizing

One clear outcome. If the "Do" list has more than about six items, or covers both a schema
change and a full screen, split it.

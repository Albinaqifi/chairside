# Runbook

How the operator runs Chairside by hand. Started in E00-T05b (creating a clinic); E00-T07a adds how
to build the app's image and run it here, E00-T07c the host's part: how to run a command in the
app's image on staging, and where its output goes.

## Create a clinic and its first owner

There is no sign-up page (D-042). The operator creates every real clinic, and its first owner, with
`pnpm clinic:create`. The owner then chooses their own password through a one-time link the command
prints, so nobody else ever knows it (D-101).

```
pnpm clinic:create --name "Lakeside Dental" --owner-email owner@example.test --owner-name "Owner"
```

| Option | What it is |
|---|---|
| `--name` | The clinic's name, as its staff will see it. Required. |
| `--owner-email`, `--owner-name` | The first owner's email (their login) and name. Required. |
| `--time-zone` | IANA name. `Europe/Skopje` when left out. |
| `--country` | Two capital letters, as the phone package knows them (`GB`, not `UK`). `MK` when left out. |
| `--currency` | Three capital letters. `MKD` when left out. |
| `--locale` | `en`, the only language the app has texts in (D-053). |
| `--remote-database` | The database is not on this machine. Only on a host, inside the app's image (below). |
| `--help` | Shows the options. |

What it does, in this order:

1. Checks every option before it connects. A wrong one is refused with a message that names the
   option; nothing is written.
2. Checks where it writes: the database `DATABASE_URL` names must be on this machine, unless
   `--remote-database` is given, and it connects as the app's own login (`chairside_app`), so the
   database's clinic rules bind it as they bind every page. It reads only the app's settings:
   `DATABASE_URL`, `BETTER_AUTH_URL` (the address the link starts with: it must be the address the
   owner will open) and `BETTER_AUTH_SECRET`.
3. Makes the owner, without a password: nobody can log in as them yet.
4. Makes the link, then the clinic, the owner's place in it, and one line in the clinic's audit log
   (`clinic.created`).
5. Prints the clinic's id and the link.

### The link

- It opens `/login/set-password`, where the owner chooses their password. It works **once**, and
  for **3 days**. Only a fingerprint of it (its SHA-256 hash) is stored, and the part that matters
  sits after `#`, which a browser never sends to a server, so no server log holds it.
- When it is used, the password is set, any session the person had ends, and the page points to the
  login page. The owner logs in there with their email and the new password.
- A link that was used, is more than 3 days old, or was not copied whole: the page says it does not
  work, the same words for each, and nothing changes.

**Send it by hand, to the owner alone.** Chairside sends no email for it. Use a channel only the owner
reads; never a shared chat, a ticket or a document others can open. Whoever has the link can choose
the owner's password until it is used or expires. Close the terminal window afterwards.

### When something goes wrong

- **The same command run twice:** the second run writes nothing and says the person is already in a
  clinic. It makes no second clinic, person or link.
- **A run that stopped halfway** (the database refused the clinic, the connection dropped): run the
  same command again. It finds the owner the first run made (no clinic, no password yet) and finishes
  the work. The first run's link was never printed; it expires unused.
- **A link that expired unused:** the command makes no new link for a person who is already in a
  clinic. Until staff management brings "forgot password" and new links (E04-T02), on staging create
  a new clinic under another email.
- **An email that already has a password and no clinic:** refused, nothing written. The command makes
  owners of new people only.

### Where it runs

- **This machine:** against the local database in `.env`, to try it out. The link then starts with
  `http://localhost:3000`; `pnpm dev` serves the page.
- **A host** (staging, later production): inside the app's image, as the worker runs, with
  `--remote-database` (E00-T07c writes the steps). Never from a development machine against
  production: production credentials never exist on one (D-044).

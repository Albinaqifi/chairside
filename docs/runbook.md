# Runbook

How the operator runs Chairside by hand. Started in E00-T05b (creating a clinic); E00-T07a added how
to build the app's image and run it here; E00-T07c adds the host's part: how to run a command in the
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
  `--remote-database`: `node --import tsx src/db/clinic-create.ts` and the same options (below, "Run
  `clinic:create` from the image"; E00-T07c writes the host's steps). Never from a development
  machine against production: production credentials never exist on one (D-044).

## Build the app's image and run it here

Staging and production run one Docker image, made from `Dockerfile` (D-007, D-103). By default it
runs the web (`next start`); with a command of its own it runs `clinic:create`; the worker's command
comes with E00-T07b. The image holds no `.env` file and no secret, and is built without either: every
setting comes from where it runs (`-e` below, the host's settings on a host).

With Docker Desktop running, in the project's folder (the first build takes several minutes):

```
docker build -t chairside .
```

### Run the web against the local database

The local database runs in Docker too (`docker compose up -d --wait`). Seen from a container,
`127.0.0.1` is the container itself, so the image joins the database's network, `chairside_default`,
and reaches the database as `db:5432`. The values below are `.env.example`'s local ones, never real
ones; the port is 3200, so `pnpm dev` can keep 3000. One line, in any terminal:

```
docker run --rm --name chairside-web --network chairside_default -p 127.0.0.1:3200:3000 -e DATABASE_URL=postgres://chairside_app:local-app-password@db:5432/chairside -e BETTER_AUTH_URL=http://localhost:3200 -e BETTER_AUTH_SECRET=local-image-check-secret-for-http-only chairside
```

Open http://localhost:3200: the login page, where a seeded login (README.md) reaches Today.
http://localhost:3200/api/health answers `{"ok":true}` (below). Stop the web with Ctrl+C, or
`docker stop chairside-web` from another window.

### Run `clinic:create` from the image

`node --import tsx src/db/clinic-create.ts` is `pnpm clinic:create` without pnpm, which the image
does not hold; it takes the same options. Seen from the container the database is not on this
machine, so the command refuses before it connects unless `--remote-database` is given, as on a host:

```
docker run --rm --network chairside_default -e DATABASE_URL=postgres://chairside_app:local-app-password@db:5432/chairside -e BETTER_AUTH_URL=http://localhost:3200 -e BETTER_AUTH_SECRET=local-image-check-secret-for-http-only chairside node --import tsx src/db/clinic-create.ts --name "Lakeside Dental" --owner-email owner2@example.test --owner-name "Owner" --remote-database
```

It prints the clinic's id and the link, which opens on the web started above: the same
`BETTER_AUTH_URL`.

### The health check: `/api/health`

The host's check of the web (D-102). A `GET`, no session needed, no cookie set, never cached;
any other method gets 405. It answers 200 `{"ok":true}`, or 503 `{"ok":false}`, which names no
reason: the web's log then has one line `health check failed` with a `code`:

| Code | What to fix |
|---|---|
| `auth_settings_missing` | `BETTER_AUTH_URL` or `BETTER_AUTH_SECRET` is not set. |
| `auth_secret_example` | `BETTER_AUTH_URL` is https and `BETTER_AUTH_SECRET` is `.env.example`'s. Set a random one, for example from `openssl rand -base64 32`. |
| `auth_secret_short` | `BETTER_AUTH_URL` is https and `BETTER_AUTH_SECRET` is shorter than 32 characters. The same fix. |
| `database_unreachable` | The database did not answer through `DATABASE_URL`. The line holds the error: the host, the port, a refused login. |
| `database_login_past_policies` | `DATABASE_URL` logs in as a role that gets past the clinics' row rules: a superuser, a role with `BYPASSRLS`, the tables' owner (the migration role) or a member of it. Use the app's own login, `chairside_app`. |

It never waits on the worker: a host restarts a web whose check fails, and the web must stay up while
the worker is down. With a refused secret the web serves no page at all (500, the same error in its
log): the auth library does not start, so no session is ever signed with a secret anyone can read. To
see it here, run the web as above with `-e BETTER_AUTH_URL=https://chairside.example.test` and
`.env.example`'s `BETTER_AUTH_SECRET`: `/api/health` answers 503 and the log names
`auth_secret_example`. Over http (this machine, CI) any secret is taken, as before.

### What the image holds

Its settings, which list no database URL, password or auth setting:

```
docker image inspect chairside --format "{{json .Config.Env}}"
```

answers `PATH`, `NODE_VERSION`, `YARN_VERSION`, `NEXT_TELEMETRY_DISABLED=1` and `NODE_ENV=production`
(Next.js sends no usage data, D-075). Inside it, `/app` holds the build (`.next`), the production
dependencies, `src/` and `package.json`, `next.config.ts` and `tsconfig.json`; `.dockerignore` keeps
every `.env` file, `.env.example` included, the end-to-end checks' session and the docs out of its
build. It runs as the `node` user, never root.

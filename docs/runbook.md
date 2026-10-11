# Runbook

How the operator runs Chairside by hand. Started in E00-T05b (creating a clinic); E00-T07a added how
to build the app's image and run it here; E00-T07b the worker, its log lines and how it stops;
E00-T07c adds the host's part: how to run a command in the app's image on staging, and where its
output goes.

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
runs the web (`next start`); with a command of its own it runs `clinic:create` or the worker (below).
The image holds no `.env` file and no secret, and is built without either: every setting comes from
where it runs (`-e` below, the host's settings on a host).

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
docker run --rm --name chairside-web --network chairside_default -p 127.0.0.1:3200:3000 -e DATABASE_URL=postgres://chairside_app:local-app-password@db:5432/chairside -e BETTER_AUTH_URL=http://localhost:3200 -e BETTER_AUTH_SECRET=WvmU7awnhS+hURz48Xzur7L/WDwpIn2OzurTHxKrCr0= chairside
```

Open http://localhost:3200: the login page, where a seeded login (README.md) reaches Today.
http://localhost:3200/api/health answers `{"ok":true}` (below). Stop the web with Ctrl+C, or
`docker stop chairside-web` from another window.

### Run `clinic:create` from the image

`node --import tsx src/db/clinic-create.ts` is `pnpm clinic:create` without pnpm, which the image
does not hold; it takes the same options. Seen from the container the database is not on this
machine, so the command refuses before it connects unless `--remote-database` is given, as on a host:

```
docker run --rm --network chairside_default -e DATABASE_URL=postgres://chairside_app:local-app-password@db:5432/chairside -e BETTER_AUTH_URL=http://localhost:3200 -e BETTER_AUTH_SECRET=WvmU7awnhS+hURz48Xzur7L/WDwpIn2OzurTHxKrCr0= chairside node --import tsx src/db/clinic-create.ts --name "Lakeside Dental" --owner-email owner2@example.test --owner-name "Owner" --remote-database
```

It prints the clinic's id and the link, which opens on the web started above: the same
`BETTER_AUTH_URL`.

### Run the worker from the image

The worker is the image's second process (D-102, D-103): the job queue, pg-boss, in the database's
`pgboss` schema, and for now a heartbeat once a minute. It reads `DATABASE_URL` alone, the app's own
login; no auth setting. The database must hold migration 0005 (`pnpm db:migrate`, or `pnpm db:reset`).
On the database's network, as the web above, in any terminal:

```
docker run --rm --name chairside-worker --network chairside_default -e DATABASE_URL=postgres://chairside_app:local-app-password@db:5432/chairside chairside node --import tsx src/worker/index.ts
```

Within a few seconds it logs `worker started`, then a `heartbeat` line once a minute (below, "The
worker"). Stop it with Ctrl+C, or `docker stop chairside-worker` from
another window. On this machine without the image, `pnpm worker` runs the same against the database in
`.env`.

### The health check: `/api/health`

The host's check of the web (D-102). A `GET`, no session needed, no cookie set, never cached;
any other method gets 405. It answers 200 `{"ok":true}`, or 503 `{"ok":false}`, which names no
reason: the web's log then has one line `health check failed` with a `code`:

| Code | What to fix |
|---|---|
| `auth_settings_missing` | `BETTER_AUTH_URL` or `BETTER_AUTH_SECRET` is not set. |
| `auth_secret_example` | `BETTER_AUTH_URL` is https and `BETTER_AUTH_SECRET` is `.env.example`'s, with or without spaces or a line break around it. Set a random one, for example from `openssl rand -base64 32`. |
| `auth_secret_short` | `BETTER_AUTH_URL` is https and `BETTER_AUTH_SECRET` is shorter than 32 characters, spaces and line breaks around it not counted. The same fix. |
| `auth_secrets_set` | `BETTER_AUTH_URL` is https and `BETTER_AUTH_SECRETS` is set: the auth library's own list of secrets, which it would sign with in place of `BETTER_AUTH_SECRET`, and which nothing checks. Chairside uses `BETTER_AUTH_SECRET` alone: remove `BETTER_AUTH_SECRETS`. |
| `database_unreachable` | The database did not answer through `DATABASE_URL`. The line holds the error: the host, the port, a refused login. |
| `database_login_past_policies` | `DATABASE_URL` logs in as a role that gets past the clinics' row rules: a superuser, a role with `BYPASSRLS`, the tables' owner (the migration role) or a member of it. Use the app's own login, `chairside_app`. |

It never waits on the worker: a host restarts a web whose check fails, and the web must stay up while
the worker is down. With a refused secret the web serves no page at all (500, the same error in its
log): the auth library does not start, so no session is ever signed with a secret anyone can read. To
see it here, run the web as above with `-e BETTER_AUTH_URL=https://chairside.example.test` in place of
the http one; its secret is already `.env.example`'s: `/api/health` answers 503 and the log names
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

## The worker

The second process beside the web (`src/worker/index.ts`, E00-T07b): the job queue, which E02's
planner and dispatcher will use, and a heartbeat once a minute, which shows the queue fires on time,
not only that the process lives. The monitor that listens for it comes with E00-T07c. How to start it:
"Run the worker from the image" above, or `pnpm worker`.

### Its log lines

One JSON line per event, each with a `code`, never a patient's details:

| Code | Level | When |
|---|---|---|
| `worker_started` | info | The database answered, the queue runs and the heartbeat is scheduled. |
| `heartbeat` | info | Once a minute, about 35 s after the minute turns (pg-boss looks at its schedules every 30 s, then forwards the job through a queue it polls every 5 s), with `at`, the time it ran, and nothing else. One line per minute, never two. A minute whose job was forwarded just before a stop runs at the next start, however much later, so a restart logs one heartbeat at once (measured in E00-T07b). |
| `worker_stopping` | info | A stop signal came: `signal` is `SIGTERM` or `SIGINT`. |
| `worker_stopped` | info | The queue stopped and both of its connection pools closed; the process ends, exit code 0. |
| `job_failed` | error | A job's handler threw. The error is in this line, with the queue and the job's id, once per run; the job's row keeps only `job_failed` (the queue's tables serve every clinic), and pg-boss runs it twice more. A job whose handler runs past its queue's time limit (`expireInSeconds`, 900 s by default) is failed by pg-boss instead, so its row keeps pg-boss's own words — `handler execution exceeded 900s` with its stack, or `job timed out` — and the handler's own error, when it comes, is still a `job_failed` line of its own. |
| `queue_error` | error | One of the queue's passes failed (a poll, a schedule, its upkeep); it tries again on the next. Many in a row: the database is gone, or a grant is missing. |
| `worker_failed` | error | Something unexpected after the start, such as the heartbeat's schedule failing: the line holds the error, exit code 1. |

It does not start, and ends with exit code 1 after one line, `worker not started`, with one of:

| Code | What to fix |
|---|---|
| `database_unreachable` | The database did not answer through `DATABASE_URL`; the line holds the error. The queue never started. |
| `database_login_past_policies` | `DATABASE_URL` logs in as a role that gets past the clinics' row rules, as for the web's health check above. Use `chairside_app`. The queue never started. |
| `queue_not_installed` | The database has no `pgboss` schema: migration 0005 is not applied. Run the migrations. |
| `queue_version_mismatch` | The `pgboss` schema is at another version than this pg-boss's (45): the code and the migrations disagree. Deploy them together. |
| `queue_start_failed` | Anything else that stopped the queue starting; the line holds the error. |

A host restarts a worker that ended, so a refusal repeats until it is fixed.

### How it stops

`docker stop` and a host's stop send SIGTERM; Ctrl+C sends SIGINT, on Windows too. Either way the
worker logs `worker stopping`, takes no new job, waits up to 20 s for a job that is running, closes its
connections, logs `worker stopped` and ends with exit code 0. A job still running after 20 s goes back
to the queue: its row says `retry`, with pg-boss's words "pg-boss shut down while active", and it runs
again on the next start. On this machine a second signal while it stops ends it at once; in the image,
where Node.js is process 1, a second one changes nothing, and the host kills it when its wait is over.

Ctrl+C on `pnpm worker` on Windows stops the worker itself cleanly — both lines, exit code 0 — and
then cmd asks "Terminate batch job (Y/N)?" and pnpm prints a red `ELIFECYCLE` line with a large
negative exit code. Answer `Y`. That is pnpm's own shim for any script, not the worker: by then the
worker has already logged `worker stopped` (E00-T07b test). `node --import tsx src/worker/index.ts`,
which is how the image runs it, has neither.

Render waits 30 s after its stop signal before it kills a process (E00-T07c checks it), which leaves
the 20 s room. `docker stop` waits only 10 s: `docker stop --time 30 chairside-worker` gives it the
host's 30 s.

### Upgrading pg-boss

pg-boss is pinned at 12.37.1, whose schema is version 45 (D-104). The worker runs it with
`migrate: false`, so it never changes its schema itself, and the app role could not. An upgrade is a new
migration in the same change: the SQL pg-boss's `getMigrationPlans('pgboss', 45)` gives, read and
committed as 0005 was (without its own `BEGIN;` and `COMMIT;`, nothing named after a day), with the
pinned version in `package.json`. A worker of the old version then refuses the new schema, and the new
one the old, both with `queue_version_mismatch`: deploy the migration and the worker together.
`src/db/pgboss-migration.test.ts` reads migration 0005 against the installed pg-boss, so it fails on an
upgrade: the reminder, and the model for the new migration's own check.

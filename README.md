# Chairside

Scheduling for small dental clinics, with automatic patient reminders. What and why:
`docs/intent.md`. How it is built: `docs/architecture/overview.md`.

## What you need

- **Node.js 24** (LTS): https://nodejs.org. Check with `node --version`.
- **pnpm**: `npm install -g pnpm`. The project pins its exact version in `package.json` and
  pnpm switches to it by itself.
- **Docker Desktop**, running: https://www.docker.com/products/docker-desktop. It runs the local
  PostgreSQL database.
- **Git**.

The commands below work in PowerShell, Command Prompt and macOS or Linux terminals. The one
command that differs is copying the settings file (step 3).

## Run it locally, from zero

1. Get the code and go into the folder:
   ```
   git clone <repository-url> chairside
   cd chairside
   ```
2. Install the dependencies:
   ```
   pnpm install
   ```
3. Create your local settings file from the template:
   ```
   Copy-Item .env.example .env      # PowerShell
   copy .env.example .env           # Command Prompt
   cp .env.example .env             # macOS or Linux
   ```
   The values in it only work with the local database and are fine as they are.
4. Start the database and wait until it is ready:
   ```
   docker compose up -d --wait
   ```
   It listens on port 5433 of this machine, so it does not clash with a PostgreSQL you may
   already have on 5432.
5. Build the database from the migrations:
   ```
   pnpm db:reset
   ```
6. Start the app:
   ```
   pnpm dev
   ```
   Open http://localhost:3000. The page says the app is running.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the app with live reload. |
| `pnpm check` | Runs every check a change must pass: formatting, lint, types, unit tests and database tests. The database must be running. |
| `pnpm test` | Unit tests only (fast, no database). |
| `pnpm test:integration` | Tests against the real database. They use their own database (`chairside_test`), so your local data is not touched. |
| `pnpm db:reset` | Deletes the local database and builds it again from the migrations. |
| `pnpm format` | Fixes code formatting. |
| `docker compose stop` | Stops the database. Your data stays until the next `db:reset`. |

## If something goes wrong

- **`POSTGRES_PASSWORD` is missing** when starting Docker: step 3 was skipped. Create `.env`.
- **`... is not set`** from a `pnpm` command: `.env` is missing or incomplete. Compare it with
  `.env.example`.
- **Cannot connect to the database:** start Docker Desktop, then `docker compose up -d --wait`.
- **Port 5433 is already in use:** another program uses it. Stop that program, or change the
  port in `docker-compose.yml` and in the three database URLs in `.env`.

## Working on this project

Read `CLAUDE.md` first: the start-of-session ritual, the rules that are never broken, and the
technical conventions. Tasks and their status: `docs/backlog/` and `docs/progress/board.md`.

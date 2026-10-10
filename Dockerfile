# syntax=docker/dockerfile:1

# The one image staging and production run (D-007; E00-T07a, D-103). Its default command is the web,
# `next start`, in whose Node.js process the request proxy runs (src/proxy.ts, D-067). With a command
# of its own it runs the operator's `clinic:create` (D-101); E00-T07b adds the worker's. Every setting
# comes from the environment it runs in: the image holds no .env file and no secret, and is built
# without either (.dockerignore). How to build it and run it: docs/runbook.md.

# Node.js 24, as package.json's engines name it, on Debian's current release.
FROM node:24-trixie-slim AS base
# Next.js sends anonymous usage data unless this is set: off while the image is built and while it
# runs (D-075).
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# pnpm at the version package.json names (packageManager), for the two stages that install.
FROM base AS pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global "$(node --print "require('./package.json').packageManager")"

# Every dependency, then the production build in .next. Its build cache stays behind.
FROM pnpm AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && rm -rf .next/cache

# The production dependencies alone, tsx among them (D-103): what `pnpm audit --prod` checks (D-075).
FROM pnpm AS production-dependencies
RUN pnpm install --frozen-lockfile --prod

# What runs: the build, the production dependencies, and the TypeScript that tsx runs. No pnpm.
FROM base
ENV NODE_ENV=production
COPY --from=production-dependencies /app/node_modules ./node_modules
# Next.js may write under .next while it runs (its caches), so the web's user owns it.
COPY --from=build --chown=node:node /app/.next ./.next
COPY package.json next.config.ts tsconfig.json ./
COPY src ./src
USER node
# `next start` listens on PORT, 3000 when the host sets none, on every address of the container.
EXPOSE 3000
# Node.js itself, not pnpm or a shell, so the host's stop signal reaches Next.js, which then finishes
# the requests under way.
CMD ["node", "node_modules/next/dist/bin/next", "start"]

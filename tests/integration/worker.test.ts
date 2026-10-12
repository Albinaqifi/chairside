import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import { scheduleJob, stopQueue, workJobs, type QueueTimings } from '@/db/queue';
import type { Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { createLogger, logger } from '@/lib/logger';
import { HEARTBEAT_QUEUE, runWorker, type WorkerOptions } from '@/worker';
import { emptyJobQueue, migratorPool } from './fixtures';
import { testDatabase } from './test-database';

// E00-T07b, acceptance 3, 4, 6 and 7: the worker (src/worker/index.ts), run in the test's own process
// as runWorker(), whose answer is the exit code. On Windows a child process gets no SIGTERM (kill()
// ends it at once, without its handler), so a stop signal is emitted in this process, where it reaches
// the worker's listeners as a real one would. Each test starts with the queue's tables empty; the queue
// itself, with every interval at its lowest: queue.test.ts. The passwords are markers, the roles real.

const database = testDatabase();
const migrator = migratorPool();

/** As fast as pg-boss's schedules go: a schedule pass and a forward a second, a queue polled twice. */
const FAST: QueueTimings = {
  cronMonitorIntervalSeconds: 1,
  cronWorkerIntervalSeconds: 1,
  pollingIntervalSeconds: 0.5,
};

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
type Line = { level: string; fields: Record<string, unknown>; message: unknown };
let spies: { level: string; spy: { mock: { calls: unknown[][] } } }[];

/** Every line given to the logger since the test began, in the order of the levels. */
function lines(): Line[] {
  return spies.flatMap(({ level, spy }) =>
    spy.mock.calls.map(([fields, message]) => ({
      level,
      fields: (fields ?? {}) as Record<string, unknown>,
      message,
    })),
  );
}

function linesWith(code: string): Line[] {
  return lines().filter((line) => line.fields.code === code);
}

/** What the logger writes for those lines: each one given again to a logger made as the real one. */
function written(): string {
  const out: string[] = [];
  const real = createLogger({ write: (text: string) => void out.push(text) });
  for (const { level, fields, message } of lines()) {
    real[level as (typeof LEVELS)[number]](fields, String(message));
  }
  return out.join('');
}

/** The worker a test started and has not stopped yet: afterEach stops it. */
let running: Promise<number> | undefined;

function startWorker(options: WorkerOptions = {}): Promise<number> {
  running = runWorker({ timings: FAST, ...options });
  return running;
}

beforeEach(async () => {
  await emptyJobQueue(migrator);
  spies = LEVELS.map((level) => ({
    level,
    spy: vi.spyOn(logger, level).mockImplementation(() => undefined),
  }));
});

afterEach(async () => {
  if (running) {
    process.emit('SIGTERM'); // nothing listens once the worker has stopped
    await running;
    running = undefined;
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await stopQueue(); // and the app's pool, which the next test makes from its own DATABASE_URL
});

afterAll(() => migrator.end());

describe('the worker refuses to start', { timeout: 60_000 }, () => {
  it.each([
    {
      login: 'the migration role, which gets past the policies',
      url: () => database.migratorUrl,
      code: 'database_login_past_policies',
    },
    {
      login: 'a database that does not answer',
      // Nothing listens on port 1 of this machine.
      url: () => `postgres://chairside_app:MARKER-worker-pw@127.0.0.1:1/${database.name}`,
      code: 'database_unreachable',
    },
  ])(
    'when DATABASE_URL names $login: one log line with the code, exit code 1, pg-boss never started',
    async ({ url, code }) => {
      vi.stubEnv('DATABASE_URL', url());
      await closeDb();
      const start = vi.spyOn(PgBoss.prototype, 'start');

      expect(await startWorker()).toBe(1);
      expect(start).not.toHaveBeenCalled();
      expect(lines()).toEqual([
        {
          level: 'error',
          fields: expect.objectContaining({ code }),
          message: 'worker not started',
        },
      ]);
    },
  );

  // Tester (E00-T07b): a URL the driver cannot read, or none, is refused the same way, and the line
  // as the logger writes it holds no password: `new URL()` keeps its input in its error.
  it.each([
    { shape: 'not set', url: undefined },
    {
      shape: 'with a host no URL can hold',
      url: `postgres://chairside_app:MARKER-worker-pw@[::1/${database.name}`,
    },
    {
      shape: 'with a port past 65535',
      url: `postgres://chairside_app:MARKER-worker-pw@localhost:99999/${database.name}`,
    },
  ])(
    'when DATABASE_URL is $shape: one log line with the code, exit code 1, pg-boss never started, no password written',
    async ({ url }) => {
      vi.stubEnv('DATABASE_URL', url);
      await closeDb();
      const start = vi.spyOn(PgBoss.prototype, 'start');

      expect(await startWorker()).toBe(1);
      expect(start).not.toHaveBeenCalled();
      expect(lines()).toEqual([
        {
          level: 'error',
          fields: expect.objectContaining({ code: 'database_unreachable' }),
          message: 'worker not started',
        },
      ]);
      expect(written()).toContain('"code":"database_unreachable"');
      expect(written()).not.toContain('MARKER-worker-pw');
    },
  );

  it.each([
    {
      pointed: 'a schema that is not there',
      change: 'alter schema pgboss rename to pgboss_elsewhere',
      undo: 'alter schema pgboss_elsewhere rename to pgboss',
      code: 'queue_not_installed',
    },
    {
      pointed: 'an older version of its schema',
      change: 'update pgboss.version set version = 44',
      undo: 'update pgboss.version set version = 45',
      code: 'queue_version_mismatch',
    },
    {
      pointed: 'a newer version of its schema',
      change: 'update pgboss.version set version = 46',
      undo: 'update pgboss.version set version = 45',
      code: 'queue_version_mismatch',
    },
  ])(
    'when the queue is pointed at $pointed: one log line with the code, exit code 1, both pools ended',
    async ({ change, undo, code }) => {
      // Test files run one after another (vitest.config.ts), so no other test sees the change.
      await migrator.query(change);
      try {
        const ends = vi.spyOn(pg.Pool.prototype, 'end');
        expect(await startWorker()).toBe(1);
        expect(lines()).toEqual([
          {
            level: 'error',
            fields: { code, err: expect.any(Error) },
            message: 'worker not started',
          },
        ]);
        expectBothPoolsEnded(ends.mock.contexts as pg.Pool[]);
      } finally {
        await migrator.query(undo);
      }
      const version = await migrator.query('select version from pgboss.version');
      expect(version.rows).toEqual([{ version: 45 }]);
    },
  );
});

// E00-T07e (E00-T07a critical review 1): the worker's start asks the web's check (databaseProblem()),
// which judges the login itself too, not only the role the session is now. So a superuser login whose
// role is set to the app role when it connects, in DATABASE_URL or on the role, starts no worker: one
// `SET ROLE NONE` would put the job handlers past the clinics' policies. The role is synthetic, its
// password a marker, and dropped again; the check's every login shape: health.test.ts.
describe(
  'the worker refuses a login whose role is set when it connects',
  { timeout: 60_000 },
  () => {
    const SUPER_SETS_ROLE = 'chairside_worker_super_sets_role';
    const PASSWORD = 'MARKER-worker-pw-sets-role';
    let superuser: pg.Pool;

    beforeAll(async () => {
      superuser = new pg.Pool({ connectionString: database.adminUrl, max: 1 });
      const name = pg.escapeIdentifier(SUPER_SETS_ROLE);
      await superuser.query(`drop role if exists ${name}`); // left by a run that stopped halfway
      await superuser.query(
        `create role ${name} LOGIN SUPERUSER password ${pg.escapeLiteral(PASSWORD)}`,
      );
      await superuser.query(`alter role ${name} set role = 'chairside_app'`);
    });

    afterAll(async () => {
      await superuser.query(`drop role if exists ${pg.escapeIdentifier(SUPER_SETS_ROLE)}`);
      await superuser.end();
    });

    it.each([
      {
        login: 'a superuser login whose role is set to the app role in DATABASE_URL',
        url: () => {
          const url = new URL(database.adminUrl);
          url.pathname = `/${database.name}`;
          url.searchParams.set('options', '-c role=chairside_app');
          return url.href;
        },
      },
      {
        login:
          'a superuser login whose role is set to the app role on the role (ALTER ROLE … SET role)',
        url: () => {
          const url = new URL(database.appUrl);
          url.username = SUPER_SETS_ROLE;
          url.password = PASSWORD;
          return url.href;
        },
      },
    ])(
      'when DATABASE_URL names $login: one log line with the code, exit code 1, pg-boss never started',
      async ({ url }) => {
        vi.stubEnv('DATABASE_URL', url());
        await closeDb();
        const start = vi.spyOn(PgBoss.prototype, 'start');

        expect(await startWorker()).toBe(1);
        expect(start).not.toHaveBeenCalled();
        expect(lines()).toEqual([
          {
            level: 'error',
            fields: expect.objectContaining({ code: 'database_login_past_policies' }),
            message: 'worker not started',
          },
        ]);
        expect(written()).not.toContain(PASSWORD);
      },
    );
  },
);

describe('the heartbeat', { timeout: 90_000 }, () => {
  it('runs once a minute of the clock pg-boss reads, and logs one line per run: its code and time only', async () => {
    await untilEarlyInAMinute();
    // The clock runs with the process's, `ahead` further on: pg-boss measures it against the
    // database's once, at start, so only what `ahead` gains after that moves its schedules.
    let ahead = 0;
    const clock: Clock = { now: () => new Date(Date.now() + ahead) };
    const heartbeats = () => linesWith('heartbeat');
    void startWorker({ clock });

    await vi.waitFor(() => expect(heartbeats()).toHaveLength(1), {
      timeout: 15_000,
      interval: 100,
    });
    await sleep(3_000); // three more schedule passes in the same minute
    expect(heartbeats()).toHaveLength(1);
    ahead += 60_000;
    await vi.waitFor(() => expect(heartbeats()).toHaveLength(2), {
      timeout: 15_000,
      interval: 100,
    });
    ahead += 60_000;
    await vi.waitFor(() => expect(heartbeats()).toHaveLength(3), {
      timeout: 15_000,
      interval: 100,
    });
    await sleep(2_000);
    expect(heartbeats()).toHaveLength(3);

    for (const line of heartbeats()) {
      expect(line).toEqual({
        level: 'info',
        fields: {
          code: 'heartbeat',
          at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
        },
        message: 'worker heartbeat',
      });
    }
    const at = heartbeats().map((line) => Date.parse(String(line.fields.at)));
    for (const [earlier, later] of [
      [at[0], at[1]],
      [at[1], at[2]],
    ]) {
      expect(later! - earlier!).toBeGreaterThanOrEqual(60_000);
      expect(later! - earlier!).toBeLessThan(90_000);
    }
    const jobs = await migrator.query('select state, data from pgboss.job where name = $1', [
      HEARTBEAT_QUEUE,
    ]);
    expect(jobs.rows).toEqual(Array(3).fill({ state: 'completed', data: null }));
  });
});

describe('on a host', { timeout: 60_000 }, () => {
  it("starts with pg-boss's own timings, as on a host, and stops on SIGTERM with exit code 0", async () => {
    running = runWorker(); // no clock and no timings: the process's and pg-boss's
    await vi.waitFor(() => expect(linesWith('worker_started')).toHaveLength(1), {
      timeout: 15_000,
      interval: 100,
    });
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    running = undefined;
    expect(lines().filter((line) => line.level !== 'info')).toEqual([]);
  });
});

describe('a stop signal', { timeout: 60_000 }, () => {
  it.each(['SIGTERM', 'SIGINT'] as const)(
    '%s lets a running job finish, ends both pools, takes its listeners away and exits with code 0',
    async (signal) => {
      const listeners = () => ({
        SIGTERM: process.listenerCount('SIGTERM'),
        SIGINT: process.listenerCount('SIGINT'),
      });
      const before = listeners();
      const run = startWorker();
      await vi.waitFor(() => expect(linesWith('worker_started')).toHaveLength(1), {
        timeout: 15_000,
        interval: 100,
      });
      expect(listeners()).toEqual({ SIGTERM: before.SIGTERM + 1, SIGINT: before.SIGINT + 1 });

      // A job that takes a while, on the queue the worker runs.
      const queue = `slow-${newId().slice(-12)}`;
      let started = false;
      let finished = false;
      await scheduleJob(queue, '* * * * *');
      await workJobs(queue, async () => {
        started = true;
        await sleep(1_500);
        finished = true;
      });
      await vi.waitFor(() => expect(started).toBe(true), { timeout: 15_000, interval: 50 });
      const ends = vi.spyOn(pg.Pool.prototype, 'end');

      process.emit(signal);
      expect(await run).toBe(0);
      running = undefined;

      expect(finished).toBe(true);
      const jobs = await migrator.query('select state from pgboss.job where name = $1', [queue]);
      expect(jobs.rows).toEqual([{ state: 'completed' }]);
      expectBothPoolsEnded(ends.mock.contexts as pg.Pool[]);
      expect(listeners()).toEqual(before);
      expect(lines().filter((line) => line.fields.code !== 'heartbeat')).toEqual([
        { level: 'info', fields: { code: 'worker_started' }, message: 'worker started' },
        { level: 'info', fields: { code: 'worker_stopping', signal }, message: 'worker stopping' },
        { level: 'info', fields: { code: 'worker_stopped' }, message: 'worker stopped' },
      ]);
    },
  );

  // Tester (E00-T07b): the listeners are there from the start, so a signal before the queue runs
  // is kept, and acted on once it does.
  it('that comes while the worker starts is kept: it starts, then stops, ends both pools and exits with code 0', async () => {
    const before = process.listenerCount('SIGTERM');
    const ends = vi.spyOn(pg.Pool.prototype, 'end');
    const run = startWorker();
    process.emit('SIGTERM'); // before the database has answered its check

    expect(await run).toBe(0);
    running = undefined;
    expectBothPoolsEnded(ends.mock.contexts as pg.Pool[]);
    expect(process.listenerCount('SIGTERM')).toBe(before);
    expect(lines().filter((line) => line.fields.code !== 'heartbeat')).toEqual([
      { level: 'info', fields: { code: 'worker_started' }, message: 'worker started' },
      {
        level: 'info',
        fields: { code: 'worker_stopping', signal: 'SIGTERM' },
        message: 'worker stopping',
      },
      { level: 'info', fields: { code: 'worker_stopped' }, message: 'worker stopped' },
    ]);
  });
});

// Tester (E00-T07b): a host that starts the new worker before it stops the old one runs two at once.
// This process runs one queue (src/db/queue.ts), so the second is a pg-boss of its own with the same
// options; both read the same clock.
describe('two workers at once', { timeout: 90_000 }, () => {
  it('start together on empty queue tables, and send one heartbeat a minute between them', async () => {
    await untilEarlyInAMinute();
    let ahead = 0;
    const clock: Clock = { now: () => new Date(Date.now() + ahead) };
    const second = new PgBoss({
      schema: 'pgboss',
      max: 2,
      migrate: false,
      persistQueueStats: false,
      persistWarnings: false,
      reindex: false,
      openTelemetry: { enabled: false },
      connectionString: database.appUrl,
      cronMonitorIntervalSeconds: 1,
      cronWorkerIntervalSeconds: 1,
      clock: {
        now: () => clock.now().getTime(),
        setTimeout: (run, ms) => setTimeout(run, ms),
        clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
        setInterval: (run, ms) => setInterval(run, ms),
        clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
      },
    });
    const secondErrors: unknown[] = [];
    second.on('error', (error) => secondErrors.push(error));
    let secondRuns = 0;
    try {
      const secondStarted = (async () => {
        await second.start();
        await second.createQueue(HEARTBEAT_QUEUE, { partition: false });
        await second.schedule(HEARTBEAT_QUEUE, '* * * * *');
        await second.work(HEARTBEAT_QUEUE, { pollingIntervalSeconds: 0.5 }, () => {
          secondRuns += 1;
          return Promise.resolve();
        });
      })();
      void startWorker({ clock });
      await secondStarted;
      const jobs = async () =>
        (
          await migrator.query('select state, data, output from pgboss.job where name = $1', [
            HEARTBEAT_QUEUE,
          ])
        ).rows;

      await vi.waitFor(async () => expect(await jobs()).toHaveLength(1), {
        timeout: 15_000,
        interval: 100,
      });
      await sleep(3_000); // three more schedule passes of each, in the same minute
      expect(await jobs()).toHaveLength(1);
      ahead += 60_000;
      await vi.waitFor(async () => expect(await jobs()).toHaveLength(2), {
        timeout: 15_000,
        interval: 100,
      });
      await sleep(3_000);
      await vi.waitFor(
        async () =>
          expect(await jobs()).toEqual(
            Array(2).fill({ state: 'completed', data: null, output: null }),
          ),
        { timeout: 5_000, interval: 100 },
      );
      expect(linesWith('heartbeat').length + secondRuns).toBe(2);
      expect(secondErrors).toEqual([]);
      expect(lines().filter((line) => line.level !== 'info')).toEqual([]);
    } finally {
      await second.stop({ graceful: false, close: true });
    }
  });
});

// Tester (E00-T07b): a database restart or failover ends the queue's connections under it.
describe("when the database ends the queue's connections", { timeout: 90_000 }, () => {
  it('logs queue_error lines with the code, keeps running, and the heartbeat goes on', async () => {
    await untilEarlyInAMinute();
    let ahead = 0;
    const clock: Clock = { now: () => new Date(Date.now() + ahead) };
    void startWorker({ clock });
    await vi.waitFor(() => expect(linesWith('heartbeat')).toHaveLength(1), {
      timeout: 15_000,
      interval: 100,
    });

    // Only a superuser may end another role's connections.
    const superuser = new pg.Pool({ connectionString: database.adminUrl, max: 1 });
    try {
      const ended = await superuser.query(
        `select pg_terminate_backend(pid) from pg_stat_activity
          where datname = $1 and application_name like 'pgboss:%'`,
        [database.name],
      );
      expect(ended.rowCount).toBeGreaterThan(0);
    } finally {
      await superuser.end();
    }
    await vi.waitFor(() => expect(linesWith('queue_error').length).toBeGreaterThan(0), {
      timeout: 10_000,
      interval: 100,
    });
    ahead += 60_000;
    await vi.waitFor(() => expect(linesWith('heartbeat')).toHaveLength(2), {
      timeout: 20_000,
      interval: 100,
    });

    for (const line of lines().filter((line) => line.level !== 'info')) {
      expect(line).toMatchObject({
        level: 'error',
        fields: { code: 'queue_error', err: expect.any(Error) },
        message: 'job queue error',
      });
    }
  });
});

/** pg-boss's pool, its connections named `pgboss:…`, and the app's (client.ts) both ended. */
function expectBothPoolsEnded(pools: pg.Pool[]): void {
  const named = (pool: pg.Pool) => pool.options.application_name?.startsWith('pgboss:') ?? false;
  expect(pools.map(named).sort()).toEqual([false, true]);
  expect(pools.map((pool) => pool.ended)).toEqual([true, true]);
}

/**
 * Waits, when the database's clock is past the 35th second of its minute, until the next minute has
 * begun: a schedule sends one job a minute, so the heartbeat's test, about 15 s long, must not cross
 * a minute the database's clock turns, which would send one more.
 */
async function untilEarlyInAMinute(): Promise<void> {
  const { rows } = await migrator.query<{ second: number }>(
    'select extract(second from clock_timestamp())::float as second',
  );
  const second = rows[0]?.second ?? 0;
  if (second > 35) await sleep((60 - second) * 1_000 + 500);
}

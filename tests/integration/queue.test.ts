import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOB_FAILED,
  scheduleJob,
  startQueue,
  stopQueue,
  workJobs,
  type QueueTimings,
} from '@/db/queue';
import { newId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { emptyJobQueue, migratorPool, withoutGrant } from './fixtures';

// E00-T07b, acceptance 3, 5 and 7: the job queue (src/db/queue.ts) as the app role, the integration
// tests' DATABASE_URL, with every pg-boss interval at its lowest so its passes run in seconds. A job
// reaches a test's handler through a schedule, as the heartbeat's do: the worker sends no other job
// yet (E02). Each test has a queue of its own, and starts with the queue's tables empty. The worker
// around it (its refusals, its heartbeat, its stop signals): worker.test.ts.

const migrator = migratorPool();

/** Every interval at the lowest pg-boss allows: its passes a second apart, a queue polled twice a second. */
const FAST: QueueTimings = {
  cronMonitorIntervalSeconds: 1,
  cronWorkerIntervalSeconds: 1,
  superviseIntervalSeconds: 1,
  monitorIntervalSeconds: 1,
  maintenanceIntervalSeconds: 1,
  queueCacheIntervalSeconds: 1,
  flowIntervalSeconds: 1,
  clockMonitorIntervalSeconds: 1,
  instanceHeartbeatSeconds: 1,
  reindexIntervalSeconds: 1,
  pollingIntervalSeconds: 0.5,
};

/** A value no row of the queue may hold: a failed job's message, cause or row. */
const MARKER = 'MARKER-queue-5c2e';

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

beforeEach(async () => {
  await emptyJobQueue(migrator);
  spies = LEVELS.map((level) => ({
    level,
    spy: vi.spyOn(logger, level).mockImplementation(() => undefined),
  }));
});

afterEach(async () => {
  await stopQueue(1_000); // a test that failed halfway leaves nothing running
  vi.restoreAllMocks();
});

afterAll(() => migrator.end());

/** A queue name no other test uses. */
function freshQueue(): string {
  return `test-${newId().slice(-12)}`;
}

/** A promise and the function that resolves it. */
function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined as void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function jobsOf(queue: string) {
  const { rows } = await migrator.query<{
    id: string;
    state: string;
    data: unknown;
    output: unknown;
    row: string;
  }>(
    `select id, state, data, output, row_to_json(j)::text as row
       from pgboss.job j where name = $1 order by created_on`,
    [queue],
  );
  return rows;
}

/**
 * The `pgboss` schema as the catalog describes it: every relation and its kind, every column with its
 * type, default and nullability, every index, constraint and function definition, and the enum's
 * values. Equal before and after a run: the run changed nothing in the schema.
 */
async function schemaOfQueue(): Promise<unknown> {
  const { rows } = await migrator.query(`
    select
      (select json_agg(relname || ' ' || relkind::text order by relname) from pg_class
        where relnamespace = 'pgboss'::regnamespace) as relations,
      (select json_agg(format('%s.%s %s %s %s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
                              a.attnotnull, pg_get_expr(d.adbin, d.adrelid)) order by c.relname, a.attnum)
         from pg_attribute a join pg_class c on c.oid = a.attrelid
         left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where c.relnamespace = 'pgboss'::regnamespace and a.attnum > 0 and not a.attisdropped) as columns,
      (select json_agg(indexdef order by indexname) from pg_indexes where schemaname = 'pgboss') as indexes,
      (select json_agg(conname || ' ' || pg_get_constraintdef(oid) order by conname, conrelid)
         from pg_constraint where connamespace = 'pgboss'::regnamespace) as constraints,
      (select json_agg(pg_get_functiondef(oid) order by proname) from pg_proc
        where pronamespace = 'pgboss'::regnamespace) as functions,
      (select json_agg(enumlabel order by enumsortorder) from pg_enum
        where enumtypid = 'pgboss.job_state'::regtype) as job_states`);
  return rows[0];
}

describe('the job queue as the app role', { timeout: 60_000 }, () => {
  it('starts, schedules, works and runs its maintenance with no error and no change to the schema', async () => {
    const before = await schemaOfQueue();
    const queue = freshQueue();
    const worked: string[] = [];
    expect(await startQueue({ timings: FAST })).toBeNull();
    await scheduleJob(queue, '* * * * *');
    await workJobs(queue, (job) => {
      worked.push(job.id);
      return Promise.resolve();
    });
    await vi.waitFor(
      async () => {
        expect(worked).toHaveLength(1);
        const { rows } = await migrator.query(
          `select q.monitor_claim_on is not null as monitored, q.maintain_on is not null as maintained,
                  v.cron_on is not null as scheduled, v.flow_on is not null as flowed
             from pgboss.queue q, pgboss.version v where q.name = $1`,
          [queue],
        );
        expect(rows).toEqual([
          { monitored: true, maintained: true, scheduled: true, flowed: true },
        ]);
      },
      { timeout: 20_000, interval: 250 },
    );
    await sleep(3_000); // a few more of every pass: schedules, maintenance, flows, its registry
    await stopQueue();

    expect(lines().filter((line) => line.level !== 'info')).toEqual([]);
    expect(await schemaOfQueue()).toEqual(before);
    expect(await jobsOf(queue)).toEqual([
      expect.objectContaining({ id: worked[0], state: 'completed', data: null }),
    ]);
    const instances = await migrator.query(
      'select stopped_on is not null as stopped from pgboss.instance',
    );
    expect(instances.rows).toEqual([{ stopped: true }]);
  });

  it.each([
    {
      thrown: 'a database error, whose detail quotes the failing row',
      fail: async () => {
        await migrator.query(
          `insert into clinics (id, name, timezone, locale, currency, default_country, status)
           values ($1, $2, 'Europe/Skopje', 'en', 'MKD', 'MK', 'no-such-status')`,
          [newId(), `${MARKER} clinic`],
        );
      },
    },
    {
      thrown: 'an error with a cause',
      fail: () => {
        throw new Error(`${MARKER} message`, { cause: new Error(`${MARKER} cause`) });
      },
    },
    {
      thrown: 'something that is no error',
      fail: () => {
        throw { note: `${MARKER} value` };
      },
    },
  ])(
    'keeps job_failed in the row of a job whose handler throws $thrown, and the error in one log line per attempt',
    async ({ fail }) => {
      const queue = freshQueue();
      const thrown: unknown[] = [];
      expect(await startQueue({ timings: FAST })).toBeNull();
      await scheduleJob(queue, '* * * * *');
      await workJobs(queue, async () => {
        try {
          await fail();
        } catch (error) {
          thrown.push(error);
          throw error;
        }
      });
      // pg-boss runs a job three times (two retries, its default) before it fails for good.
      await vi.waitFor(
        async () => expect(await jobsOf(queue)).toMatchObject([{ state: 'failed' }]),
        {
          timeout: 20_000,
          interval: 250,
        },
      );
      await stopQueue();

      const [job] = await jobsOf(queue);
      expect(job?.output).toEqual({ name: 'Error', message: JOB_FAILED });
      expect(job?.row).not.toContain(MARKER);
      expect(thrown).toHaveLength(3);
      if (thrown[0] instanceof Error && 'detail' in thrown[0]) {
        expect(thrown[0]).toMatchObject({ code: '23514', detail: expect.stringContaining(MARKER) });
      }
      const failures = lines().filter((line) => line.fields.code === JOB_FAILED);
      expect(failures).toEqual(
        thrown.map((err) => ({
          level: 'error',
          fields: { code: JOB_FAILED, queue, jobId: job?.id, err },
          message: 'job failed',
        })),
      );
      expect(
        lines().filter((line) => line.level !== 'info' && line.fields.code !== JOB_FAILED),
      ).toEqual([]);
    },
  );

  it('waits for a running job to finish before it stops, then ends its pool', async () => {
    const queue = freshQueue();
    const started = signal();
    let finished = false;
    expect(await startQueue({ timings: FAST })).toBeNull();
    await scheduleJob(queue, '* * * * *');
    await workJobs(queue, async () => {
      started.resolve();
      await sleep(1_500);
      finished = true;
    });
    await started.promise;
    const ends = vi.spyOn(pg.Pool.prototype, 'end');
    await stopQueue(10_000);

    expect(finished).toBe(true);
    expect(await jobsOf(queue)).toMatchObject([{ state: 'completed' }]);
    const pools = ends.mock.contexts as pg.Pool[];
    expect(pools.filter((pool) => pool.options.application_name?.startsWith('pgboss:'))).toEqual([
      expect.objectContaining({ ended: true }),
    ]);
  });

  it('hands a job still running when the timeout ends back to the queue, and aborts its signal', async () => {
    const queue = freshQueue();
    const started = signal();
    let aborted = false;
    expect(await startQueue({ timings: FAST })).toBeNull();
    await scheduleJob(queue, '* * * * *');
    await workJobs(queue, async (job) => {
      started.resolve();
      await Promise.race([
        new Promise((resolve) => job.signal.addEventListener('abort', resolve, { once: true })),
        sleep(15_000),
      ]);
      aborted = job.signal.aborted;
    });
    await started.promise;
    const begun = performance.now();
    await stopQueue(1_000);
    const took = performance.now() - begun;

    expect(took).toBeGreaterThanOrEqual(1_000);
    expect(took).toBeLessThan(10_000);
    await vi.waitFor(() => expect(aborted).toBe(true));
    // Back in the queue: a retry the next start runs, with pg-boss's own words for why, no error.
    expect(await jobsOf(queue)).toMatchObject([
      { state: 'retry', output: { value: 'pg-boss shut down while active' } },
    ]);
  });

  // Tester (E00-T07b): "goes back to the queue" in full, as docs/runbook.md says: it runs again on
  // the next start, and to its end.
  it('runs a job handed back at a stop again on the next start', async () => {
    const queue = freshQueue();
    const started = signal();
    expect(await startQueue({ timings: FAST })).toBeNull();
    await scheduleJob(queue, '* * * * *');
    await workJobs(queue, async (job) => {
      started.resolve();
      await new Promise((resolve) => job.signal.addEventListener('abort', resolve, { once: true }));
    });
    await started.promise;
    await stopQueue(1_000);
    const [handedBack] = await jobsOf(queue);
    expect(handedBack).toMatchObject({ state: 'retry' });

    const ran: string[] = [];
    expect(await startQueue({ timings: FAST })).toBeNull(); // a host's restart
    await workJobs(queue, (job) => {
      ran.push(job.id);
      return Promise.resolve();
    });
    await vi.waitFor(() => expect(ran).toContain(handedBack?.id), {
      timeout: 15_000,
      interval: 250,
    });
    await stopQueue();
    const again = await migrator.query('select state, retry_count from pgboss.job where id = $1', [
      handedBack?.id,
    ]);
    expect(again.rows).toEqual([{ state: 'completed', retry_count: 1 }]);
    expect(lines().filter((line) => line.level !== 'info')).toEqual([]);
  });

  // Tester (E00-T07b): pg-boss keeps a row per worker in pgboss.instance, a table every clinic shares
  // (tenant-allow-list.ts: "no connection string"), with the options the worker runs with.
  it('keeps neither the connection string nor its password in its row of pgboss.instance', async () => {
    expect(await startQueue({ timings: FAST })).toBeNull();
    await workJobs(freshQueue(), () => Promise.resolve());
    await sleep(2_000); // two of its heartbeats, which write the row again
    const { rows } = await migrator.query<{ row: string }>(
      'select row_to_json(i)::text as row from pgboss.instance i',
    );
    await stopQueue();

    expect(rows).toHaveLength(1);
    const row = rows[0]?.row ?? '';
    const url = process.env.DATABASE_URL ?? '';
    const password = decodeURIComponent(new URL(url).password);
    // Compared as booleans, so a failure prints neither value. The password alone only when it is
    // long enough to mean something: .env.example's, which CI uses, is.
    expect(row.includes(url)).toBe(false);
    expect(row.includes('://')).toBe(false);
    expect(password.length >= 8 && row.includes(password)).toBe(false);
  });

  it("logs pg-boss's errors with a code, as an error, and keeps running", async () => {
    const queue = freshQueue();
    const worked: string[] = [];
    expect(await startQueue({ timings: FAST })).toBeNull();
    await scheduleJob(queue, '* * * * *');
    // Its polls cannot take a job while the app role may not update the jobs.
    await withoutGrant(migrator, 'update', 'pgboss.job_common', async () => {
      await workJobs(queue, (job) => {
        worked.push(job.id);
        return Promise.resolve();
      });
      await vi.waitFor(
        () => {
          const errors = lines().filter((line) => line.fields.code === 'queue_error');
          expect(errors.length).toBeGreaterThan(0);
          for (const line of errors) {
            expect(line).toMatchObject({ level: 'error', message: 'job queue error' });
            expect(line.fields.err).toBeInstanceOf(Error);
          }
          expect(errors.map((line) => line.fields.err)).toContainEqual(
            expect.objectContaining({ code: '42501', queue }),
          );
        },
        { timeout: 20_000, interval: 250 },
      );
    });
    await vi.waitFor(() => expect(worked).toHaveLength(1), { timeout: 20_000, interval: 250 });
  });

  // Critical review (E00-T07b): a job fails too when its handler runs past the queue's
  // expireInSeconds (900 s, pg-boss's default; 1 s here). pg-boss then fails it in its own words, and
  // the handler's error, thrown afterwards, still reaches one log line and never the job's row, in a
  // table every clinic shares (security-privacy.md, section 1).
  // E00-T07d: nothing in here counts runs of its own. A schedule sends a job at every minute boundary
  // it is worked over, so a case that crosses one gets a second job: this one then saw six runs where
  // it wanted three, and a run on `main` went red on it (D-106). It takes 1 s per run and no number
  // of jobs is promised, so the case follows the first job its handler ran, by that job's id, and
  // reads every count off pg-boss's own row for it.
  it("keeps only pg-boss's words in the row of a job whose handler runs past its time, and the handler's error in one log line per attempt", async () => {
    const queue = freshQueue();
    // Made first, as the migration role, with a 1 s limit: workJobs() leaves a queue that is there as
    // it is. pg-boss's supervisor at its own pace (a minute), so the worker's own timer ends each run.
    await migrator.query(
      `select pgboss.create_queue($1, '{"policy": "standard", "expireInSeconds": 1}')`,
      [queue],
    );
    const thrown: { jobId: string; error: unknown }[] = [];
    /** What the handler threw on each run of one job, in the order it ran. */
    const runsOf = (id: string) => thrown.filter((run) => run.jobId === id);
    /** The failure lines the log holds for one job. */
    const linesOf = (id: string) =>
      lines().filter((line) => line.fields.code === JOB_FAILED && line.fields.jobId === id);
    expect(
      await startQueue({
        timings: {
          cronMonitorIntervalSeconds: 1,
          cronWorkerIntervalSeconds: 1,
          pollingIntervalSeconds: 0.5,
        },
      }),
    ).toBeNull();
    await scheduleJob(queue, '* * * * *');
    await workJobs(queue, async (job) => {
      // Past its time pg-boss aborts the job's signal; the handler fails only then.
      await new Promise((resolve) => job.signal.addEventListener('abort', resolve, { once: true }));
      const error = new Error(`${MARKER} late`, { cause: new Error(`${MARKER} cause`) });
      thrown.push({ jobId: job.id, error });
      throw error;
    });
    // Waits until pg-boss has failed that first job for good: no run of it can follow, whatever the
    // schedule sends afterwards, so every count below stands still from here on. Its last run's line
    // is in the log by then: pg-boss aborts the signal before it writes the failure, and the handler
    // throws on the abort itself, with no query in between.
    const jobId = await vi.waitFor(
      async () => {
        const first = thrown[0];
        expect(first).toBeDefined();
        const row = (await jobsOf(queue)).find((job) => job.id === first?.jobId);
        expect(row).toMatchObject({ state: 'failed' });
        return first?.jobId ?? '';
      },
      { timeout: 30_000, interval: 250 },
    );
    await stopQueue();

    const rows = await jobsOf(queue);
    const job = rows.find((row) => row.id === jobId);
    // pg-boss's words, from whichever saw the time run out: the worker's timer, or the supervisor.
    expect(job?.output).toBeOneOf([
      expect.objectContaining({ name: 'Error', message: 'handler execution exceeded 1s' }),
      { value: { message: 'job timed out' } },
    ]);
    // No row of the queue holds a word the handler threw: not this job's, and not another job's.
    expect(rows.filter((row) => row.row.includes(MARKER))).toEqual([]);
    // One run per attempt pg-boss made of it (a first claim and its two retries, its default), the
    // attempts counted from its own row: retry_count rises with every claim after the first.
    const attempts = await migrator.query<{ runs: number }>(
      'select retry_count + 1 as runs from pgboss.job where id = $1',
      [jobId],
    );
    const runs = runsOf(jobId);
    expect(runs).toHaveLength(attempts.rows[0]?.runs ?? 0);
    // Each of those runs in one log line of its own, with the error that run threw.
    expect(linesOf(jobId)).toEqual(
      runs.map(({ error }) => ({
        level: 'error',
        fields: { code: JOB_FAILED, queue, jobId, err: error },
        message: 'job failed',
      })),
    );
    // And every failure line of the whole case belongs to a run: one line per run, never two.
    expect(lines().filter((line) => line.fields.code === JOB_FAILED)).toHaveLength(thrown.length);
    expect(
      lines().filter((line) => line.level !== 'info' && line.fields.code !== JOB_FAILED),
    ).toEqual([]);
  });
});

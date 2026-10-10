// The job queue (pg-boss 12.37.1; D-005, D-102, D-104): the worker's (src/worker/index.ts), as the app
// role (DATABASE_URL), in the `pgboss` schema migration 0005 makes as the migration role. pg-boss stays
// in this file, beside the other drivers (lint keeps every pg-… package in src/db/): it exports
// functions, never pg-boss's object or class. One queue per process, as client.ts keeps one pool.
// A job's data holds ids and codes only, never a patient's details: its tables are shared by every
// clinic (security-privacy.md, section 1). How the worker runs and stops: docs/runbook.md.
import {
  PgBoss,
  type Clock as QueueClock,
  type ConstructorOptions,
  type Job,
  type WorkOptions,
} from 'pg-boss';
import type { Clock } from '@/lib/clock';
import { logger } from '@/lib/logger';
import { closeDb } from './client';
import { requiredEnv } from './required-env';

/** The schema migration 0005 makes. */
export const QUEUE_SCHEMA = 'pgboss';

/** The code a failed job keeps in its row (`output`), in place of its error (D-104). */
export const JOB_FAILED = 'job_failed';

/**
 * How long stopQueue() gives a running job to finish: 10 s less than the 30 s Render waits after its
 * stop signal before it kills the process (E00-T07c checks it), for pg-boss to hand the job back and
 * end its pool.
 */
export const STOP_TIMEOUT_MS = 20_000;

/**
 * How pg-boss runs (D-104). Its schema is the migration's: with `migrate: false` it only checks the
 * version, and nothing that changes the schema while it runs is on: no queue statistics (a table a
 * day), no reindexing, no partitioned queue (makeQueue below). No warnings kept: the app role has no
 * grant on their table. No OpenTelemetry: Chairside registers no tracing SDK, and what may leave the
 * process is decided with the error tracker (E07-T03). A small pool of its own, from pg-boss's 10: its
 * passes run one statement at a time, and a handler's own work uses the app's pool (client.ts).
 */
const OPTIONS = {
  schema: QUEUE_SCHEMA,
  max: 4,
  migrate: false,
  persistQueueStats: false,
  persistWarnings: false,
  reindex: false,
  openTelemetry: { enabled: false },
} as const satisfies ConstructorOptions;

/**
 * How often pg-boss looks, for tests: its own defaults otherwise (schedules every 30 s, maintenance
 * every 60 s, a worked queue polled every 2 s), each no lower than pg-boss allows (1 s, a poll 0.5 s).
 */
export type QueueTimings = Pick<
  ConstructorOptions,
  | 'cronMonitorIntervalSeconds'
  | 'cronWorkerIntervalSeconds'
  | 'superviseIntervalSeconds'
  | 'monitorIntervalSeconds'
  | 'maintenanceIntervalSeconds'
  | 'queueCacheIntervalSeconds'
  | 'flowIntervalSeconds'
  | 'clockMonitorIntervalSeconds'
  | 'instanceHeartbeatSeconds'
  | 'reindexIntervalSeconds'
> &
  Pick<WorkOptions, 'pollingIntervalSeconds'>;

/** Why the queue did not start, as a code. */
export type QueueProblem = 'queue_not_installed' | 'queue_version_mismatch' | 'queue_start_failed';

/** A job as its handler gets it: ids and codes only (data), and the signal a stop aborts. */
export interface QueuedJob {
  id: string;
  data: unknown;
  /** Aborted when a stop has waited STOP_TIMEOUT_MS and handed the job back: stop then. */
  signal: AbortSignal;
}

export type JobHandler = (job: QueuedJob) => Promise<void>;

/** The queue this process runs, from startQueue() until stopQueue(). */
let running: { boss: PgBoss; polling: Pick<WorkOptions, 'pollingIntervalSeconds'> } | undefined;

/**
 * Starts the queue as the app role. pg-boss checks that its schema is there, at its version (45),
 * and changes nothing; then it runs its schedules and its maintenance. Null when the queue runs;
 * otherwise why not, with the error, and nothing of it left running (its pool ended). `clock` is what
 * pg-boss and its schedules read as now: the process's when not given.
 */
export async function startQueue({
  clock,
  timings = {},
}: { clock?: Clock; timings?: QueueTimings } = {}): Promise<{
  code: QueueProblem;
  cause: unknown;
} | null> {
  if (running) throw new Error('startQueue: the queue runs already.');
  const { pollingIntervalSeconds, ...intervals } = timings;
  let boss: PgBoss | undefined;
  try {
    boss = new PgBoss({
      ...OPTIONS,
      ...intervals,
      connectionString: requiredEnv('DATABASE_URL'),
      ...(clock && { clock: queueClock(clock) }),
    });
    boss.on('error', logQueueError);
    await boss.start();
  } catch (cause) {
    // A start that failed halfway has opened pg-boss's pool and may have started its timers.
    await boss?.stop({ graceful: false, close: true });
    return { code: startProblem(cause), cause };
  }
  // Only when given: pg-boss refuses a work() option that is there but undefined.
  running = {
    boss,
    polling: pollingIntervalSeconds === undefined ? {} : { pollingIntervalSeconds },
  };
  return null;
}

/**
 * Sends a job to `queue` on a cron schedule, in UTC, with no data. pg-boss's schedules go no faster
 * than once a minute, and an occurrence missed while no worker ran is not caught up. Kept in the
 * schedule table, so a second call, or a second worker, changes nothing. Makes the queue if needed.
 */
export async function scheduleJob(queue: string, cron: string): Promise<void> {
  const { boss } = runningQueue();
  await makeQueue(boss, queue);
  await boss.schedule(queue, cron);
}

/**
 * Works the jobs of `queue`, one at a time, with `handler`. A handler that throws fails its job: the
 * error goes to the log once, with the job's id, and pg-boss gets JOB_FAILED, with no cause, so the
 * job's row, in a table every clinic shares, never holds the error's message, a database error's
 * `detail` or its cause (D-104). pg-boss retries a failed job twice, its default. Makes the queue if
 * needed.
 */
export async function workJobs(queue: string, handler: JobHandler): Promise<void> {
  const { boss, polling } = runningQueue();
  await makeQueue(boss, queue);
  await boss.work<unknown>(queue, { ...polling, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await runJob(queue, job, handler);
  });
}

/**
 * Stops the queue, then closes the app's pool (client.ts, closeDb()): the worker's last step, so both
 * of its pools end. pg-boss stops fetching and scheduling, and waits up to `timeoutMs` for a running
 * job; one still running then goes back to the queue (pg-boss fails it as "pg-boss shut down while
 * active", so it runs again, as a retry) and its signal is aborted. Then pg-boss's pool ends. With no
 * queue running (a start refused), only the app's pool closes.
 */
export async function stopQueue(timeoutMs = STOP_TIMEOUT_MS): Promise<void> {
  const current = running;
  running = undefined;
  try {
    await current?.boss.stop({ graceful: true, timeout: timeoutMs, close: true });
  } finally {
    await closeDb();
  }
}

function runningQueue(): NonNullable<typeof running> {
  if (!running) throw new Error('The job queue is not running: startQueue() first.');
  return running;
}

/**
 * Makes the queue if it is not there, with pg-boss's defaults, never partitioned: a queue of its own
 * table would be a table made while the worker runs (D-104).
 */
async function makeQueue(boss: PgBoss, queue: string): Promise<void> {
  await boss.createQueue(queue, { partition: false });
}

async function runJob(queue: string, job: Job<unknown>, handler: JobHandler): Promise<void> {
  try {
    await handler({ id: job.id, data: job.data, signal: job.signal });
  } catch (err) {
    logger.error({ code: JOB_FAILED, queue, jobId: job.id, err }, 'job failed');
    throw jobFailed();
  }
}

/**
 * What pg-boss keeps of a failed job (serializeError: its name, message and stack): the code alone.
 * Without the stack, which names only this file's lines, the row holds `{"name":"Error","message":"job_failed"}`.
 */
function jobFailed(): Error {
  const error = new Error(JOB_FAILED);
  delete error.stack;
  return error;
}

/** pg-boss's clock from ours: its now() in milliseconds, its timers the process's own. */
function queueClock(clock: Clock): QueueClock {
  return {
    now: () => clock.now().getTime(),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
    setInterval: (run, ms) => setInterval(run, ms),
    clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
  };
}

/**
 * pg-boss refuses to start, with `migrate: false`, when its schema is not there or is at another
 * version than its own (12.37.1's Contractor.check()); anything else is a failed start.
 */
function startProblem(cause: unknown): QueueProblem {
  const message = cause instanceof Error ? cause.message : '';
  if (message === 'pg-boss is not installed') return 'queue_not_installed';
  if (message === 'pg-boss database requires migrations') return 'queue_version_mismatch';
  return 'queue_start_failed';
}

/**
 * pg-boss's 'error' events: a failure in one of its background passes (a poll, a schedule, its
 * maintenance), which it tries again on the next. Without a listener the first one would end the
 * process (D-104). It sends an error, or a plain copy of one with the queue's name ({ ...error,
 * message, stack, queue, worker }), made an Error again here, so the logger takes a failed query's
 * values out of its message as it does for every error (src/lib/query-errors.ts).
 */
function logQueueError(event: unknown): void {
  logger.error({ code: 'queue_error', err: asError(event) }, 'job queue error');
}

function asError(event: unknown): unknown {
  if (event instanceof Error || typeof event !== 'object' || event === null) return event;
  const { message, ...fields } = event as { message?: unknown };
  return Object.assign(new Error(typeof message === 'string' ? message : ''), fields);
}

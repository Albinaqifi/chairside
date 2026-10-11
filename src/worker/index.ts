// The worker (E00-T07b; D-002, D-005, D-013): the second process beside the web, for the slow and timed
// work, E02's planner and dispatcher among it. For now it runs the job queue (src/db/queue.ts) and a
// heartbeat once a minute, which shows the queue fires on time, not only that the process lives; the
// monitor that listens for it comes with E00-T07c. `pnpm worker` runs it with tsx, as clinic:create;
// the image as `node --import tsx src/worker/index.ts` (D-103). Its log lines, and how it starts and
// stops: docs/runbook.md.
import { databaseProblem } from '@/db/health';
import { scheduleJob, startQueue, stopQueue, workJobs, type QueueTimings } from '@/db/queue';
import { systemClock, type Clock } from '@/lib/clock';
import { logger } from '@/lib/logger';

/** The heartbeat's queue and its schedule: every minute, as often as pg-boss's schedules go. */
export const HEARTBEAT_QUEUE = 'heartbeat';
export const HEARTBEAT_CRON = '* * * * *';

/** The signals that stop the worker: the host's (SIGTERM: Render, `docker stop`) and Ctrl+C (SIGINT). */
const STOP_SIGNALS = ['SIGTERM', 'SIGINT'] as const;
type StopSignal = (typeof STOP_SIGNALS)[number];

export interface WorkerOptions {
  /** What the worker and the queue read as now: the process's clock unless a test gives one. */
  clock?: Clock;
  /** How often the queue looks: pg-boss's defaults unless a test gives them. */
  timings?: QueueTimings;
}

/**
 * Runs the worker until a stop signal, and answers its exit code.
 *
 * First the web's check of the database (databaseProblem(), E00-T07a): the database answers through
 * DATABASE_URL, and that login cannot get past the clinics' policies, which the job handlers will rely
 * on. Then the queue, which checks its own schema. Either one refused: one log line, `worker not
 * started` with the code, and 1; pg-boss never started for a database problem.
 *
 * Then the heartbeat, and the worker waits. On SIGTERM or SIGINT it stops the queue (a running job
 * finishes, or goes back to the queue after STOP_TIMEOUT_MS), closes both pools and answers 0. A second
 * signal while it stops gets Node's default: it ends the process, except as process 1 in a container,
 * which ignores it (the host then kills it when its wait is over).
 */
export async function runWorker({
  clock = systemClock,
  timings,
}: WorkerOptions = {}): Promise<number> {
  const stop = stopSignal();
  try {
    const problem = (await databaseProblem()) ?? (await startQueue({ clock, timings }));
    if (problem) {
      logger.error({ code: problem.code, err: problem.cause }, 'worker not started');
      return 1;
    }
    await scheduleJob(HEARTBEAT_QUEUE, HEARTBEAT_CRON);
    await workJobs(HEARTBEAT_QUEUE, () => heartbeat(clock));
    logger.info({ code: 'worker_started' }, 'worker started');
    const signal = await stop.received;
    logger.info({ code: 'worker_stopping', signal }, 'worker stopping');
  } catch (err) {
    logger.error({ code: 'worker_failed', err }, 'worker failed');
    return 1;
  } finally {
    stop.remove();
    await stopQueue();
  }
  logger.info({ code: 'worker_stopped' }, 'worker stopped');
  return 0;
}

/** A heartbeat's run: one log line, its code and the time it ran, nothing else (E00-T07c pings). */
function heartbeat(clock: Clock): Promise<void> {
  logger.info({ code: 'heartbeat', at: clock.now().toISOString() }, 'worker heartbeat');
  return Promise.resolve();
}

/**
 * The first stop signal, listened for from the start, so one that comes while the worker starts is
 * not lost. The listeners replace Node's default, which ends the process at once, and are taken away
 * as soon as one signal came, or by `remove()`.
 */
function stopSignal(): { received: Promise<StopSignal>; remove: () => void } {
  const listeners: { signal: StopSignal; listener: () => void }[] = [];
  const remove = () => {
    for (const { signal, listener } of listeners) process.removeListener(signal, listener);
  };
  const received = new Promise<StopSignal>((resolve) => {
    for (const signal of STOP_SIGNALS) {
      const listener = () => {
        remove();
        resolve(signal);
      };
      listeners.push({ signal, listener });
      process.on(signal, listener);
    }
  });
  return { received, remove };
}

if (import.meta.main) {
  process.exitCode = await runWorker();
}

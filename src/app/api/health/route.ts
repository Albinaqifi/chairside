import { databaseProblem } from '@/db/health';
import { logger } from '@/lib/logger';
import { authSettingsProblem } from '@/modules/auth';

/**
 * `/api/health`, the host's check of the web (E00-T07a, D-102), public on purpose: the host asks
 * with a GET and no session. The request proxy lets this one path through untouched (src/proxy.ts),
 * and nothing here reads or sets a cookie. Next.js answers any other method but HEAD with 405.
 *
 * 200 when the auth library's settings pass its check (over https, never .env.example's secret or a
 * short one, nor BETTER_AUTH_SECRETS; over http too, never BETTER_AUTH_TRUSTED_ORIGINS: auth-secret.ts)
 * and the database answers through DATABASE_URL with a login that cannot get past the policies,
 * however its role is set when it connects (src/db/health.ts); otherwise 503. The answer names
 * no reason; one log line names it, with a code. It never waits on the worker: a host restarts a web
 * whose check fails, and the web stays up while the worker is down (overview.md); a monitor watches
 * the worker (E00-T07c).
 */

// Answered for each request, never at build time and never from a cache.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const settings = authSettingsProblem();
  const problem: { code: string; cause?: unknown } | null =
    settings === null ? await databaseProblem() : { code: settings };
  if (problem === null) return answer(200);
  logger.error({ code: problem.code, err: problem.cause }, 'health check failed');
  return answer(503);
}

/** One body for every failure, so it names no reason; never kept by a browser or a cache. */
function answer(status: 200 | 503): Response {
  return Response.json(
    { ok: status === 200 },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

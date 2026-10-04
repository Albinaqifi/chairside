import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { createLogger } from '@/lib/logger';
import { insertClinic, migratorPool, rawQueryError } from './fixtures';

// A failed query is the error the app will log most often. The values it was sent are row
// values (later: patient names, phone numbers), so none of them may reach a log line
// (security-privacy.md, section 6). The marker is synthetic; finding it in a line means a leak.
const MARKER = 'MARKER-5d1c';
const CHECK_VIOLATION = '23514';

const admin = migratorPool();
let failedQuery: unknown;

beforeAll(async () => {
  const clinicId = await insertClinic(admin);
  // Fails on the currency check constraint. The marker is one of the values sent. Run outside
  // withTenant, which cleans its errors since E00-T03 (D-070): the logger must clean a raw one.
  failedQuery = await rawQueryError(
    admin,
    sql`update clinics set name = ${MARKER}, currency = 'invalid' where id = ${clinicId}`,
  );
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

function logLine(write: (logger: Logger) => void): string {
  const lines: string[] = [];
  write(createLogger({ write: (line: string) => void lines.push(line) }));
  return lines.join('');
}

describe('logging a failed database query', () => {
  it('starts from a real failed query whose error carries the marker', () => {
    // Guards the tests below: without this they could pass by logging nothing of interest.
    expect(failedQuery).toBeInstanceOf(Error);
    expect(`${(failedQuery as Error).message} ${(failedQuery as Error).stack}`).toContain(MARKER);
  });

  it.each([
    ['under err', (logger: Logger) => logger.error({ err: failedQuery }, 'update failed')],
    ['as the only argument', (logger: Logger) => logger.error(failedQuery as Error)],
    ['under another key', (logger: Logger) => logger.error({ error: failedQuery }, 'failed')],
  ])('drops the values the query was sent, with the error logged %s', (_, write) => {
    const line = logLine(write);

    expect(line).not.toContain(MARKER);
    // The line stays useful: the database error code is kept.
    expect(line).toContain(CHECK_VIOLATION);
  });
});

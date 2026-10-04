import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { createLogger } from '@/lib/logger';
import { migratorPool, rawQueryError } from './fixtures';

// Added by the tester (round 2). PostgreSQL also quotes a value it could not read outside
// SQLSTATE class 22: the full-text search parsers report `syntax error in tsquery: "<the text>"`
// with code 42601. A patient search may parse what staff type, which can be a patient's name or
// phone number, so these values may not reach a log line either (security-privacy.md, section 6).
// Values are synthetic. The queries run outside withTenant, which cleans its errors since E00-T03
// (D-070): the logger must clean a raw error too.
const MARKER = 'MARKER-3e8b';
const SYNTAX_ERROR = '42601';

const admin = migratorPool();

afterAll(async () => {
  await closeDb();
  await admin.end();
});

function logLine(write: (logger: Logger) => void): string {
  const lines: string[] = [];
  write(createLogger({ write: (line: string) => void lines.push(line) }));
  return lines.join('');
}

const cases = [
  { name: 'to_tsquery() with search text', query: sql`select to_tsquery(${`${MARKER} &`})` },
  { name: 'a tsquery cast', query: sql`select ${`${MARKER} & |`}::tsquery` },
  { name: 'a tsvector cast', query: sql`select ${`'${MARKER}`}::tsvector` },
];

describe('logging a failed full-text search query', () => {
  it.each(cases)('drops the value from $name', async ({ query }) => {
    const error = await rawQueryError(admin, query);
    // Guards the test: the database error really quotes the value.
    const cause = (error as { cause?: Record<string, unknown> } | undefined)?.cause ?? {};
    expect(cause.code).toBe(SYNTAX_ERROR);
    expect(String(cause.message)).toContain(MARKER);

    for (const write of [
      (logger: Logger) => logger.error({ err: error }, 'search failed'),
      (logger: Logger) => logger.error(error as Error),
    ]) {
      const line = logLine(write);
      expect(line).not.toContain(MARKER);
      // Still useful: the error code and what went wrong stay.
      expect(line).toContain(SYNTAX_ERROR);
      expect(line).toMatch(/in ts(query|vector)/);
    }
  });
});

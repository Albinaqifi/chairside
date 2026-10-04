import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { createLogger } from '@/lib/logger';
import { migratorPool, rawQueryError } from './fixtures';

// PostgreSQL quotes the value it could not read in the message of a data error (SQLSTATE class
// 22), and the start of invalid JSON in the error's context (`where`). Both are values a query
// was sent, so neither may reach a log line (security-privacy.md, section 6). Values are synthetic.
// The queries run outside withTenant, which cleans its errors since E00-T03 (D-070): the logger
// must clean a raw error too.
const MARKER = 'MARKER-9b2e';

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
  {
    name: 'text that is not a uuid',
    cast: 'uuid',
    value: MARKER,
    kept: 'type uuid',
    code: '22P02',
  },
  {
    name: 'a number out of range',
    cast: 'int',
    value: '98765432109876',
    kept: 'is out of range for type integer',
    code: '22003',
  },
  {
    name: 'a day that does not exist',
    cast: 'date',
    value: '2026-02-30',
    kept: 'date/time field value out of range',
    code: '22008',
  },
  {
    name: 'invalid JSON',
    cast: 'jsonb',
    value: `{"note": "${MARKER}`,
    kept: 'invalid input syntax for type json',
    code: '22P02',
  },
];

describe('logging a failed query whose PostgreSQL error quotes the value', () => {
  it.each(cases)('drops the value from $name', async ({ cast, value, kept, code }) => {
    const error = await rawQueryError(admin, sql`select ${value}::${sql.raw(cast)}`);
    // Guards the test: the database error really carries the value (or, for JSON, the marker).
    const secret = cast === 'jsonb' ? MARKER : value;
    const cause = (error as { cause?: Record<string, unknown> } | undefined)?.cause ?? {};
    expect(`${cause.message} ${cause.where}`).toContain(secret);

    for (const write of [
      (logger: Logger) => logger.error({ err: error }, 'query failed'),
      (logger: Logger) => logger.error(error as Error),
    ]) {
      const line = logLine(write);
      expect(line).not.toContain(secret);
      // Still useful: the error code and what went wrong stay.
      expect(line).toContain(code);
      expect(line).toContain(kept);
    }
  });
});

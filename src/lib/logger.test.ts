import { DrizzleQueryError } from 'drizzle-orm';
import type { Logger } from 'pino';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';
import { PERSONAL_FIELD_ENDINGS, PERSONAL_FIELD_WORDS, PERSONAL_FIELDS } from './personal-fields';

// Every personal value in these tests is a marker. A marker in the output means a leak.
const MARKER = 'MARKER-7f3a';

function capture() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line: string) => void lines.push(line) });
  const output = () => lines.join('');
  return { logger, output };
}

describe('logger', () => {
  it('drops every listed personal field', () => {
    const { logger, output } = capture();
    const fields = [...PERSONAL_FIELDS, ...PERSONAL_FIELD_ENDINGS, ...PERSONAL_FIELD_WORDS];
    const entry = Object.fromEntries(fields.map((field) => [field, `${MARKER}-${field}`]));
    logger.info({ ...entry, clinicId: 'clinic-1' }, 'appointment booked');

    expect(output()).not.toContain(MARKER);
    expect(JSON.parse(output())).toMatchObject({ clinicId: 'clinic-1', msg: 'appointment booked' });
  });

  it('drops compound names that end with, or contain, a personal word', () => {
    const { logger, output } = capture();
    logger.info({
      patientEmail: MARKER,
      guardian_phone: MARKER,
      recipientName: MARKER,
      patientFirstName: MARKER,
      emailAddress: MARKER,
      accessToken: MARKER,
      requestBody: MARKER,
      smsText: MARKER,
      staffNotes: MARKER,
      passwordConfirmation: MARKER,
      clientSecretValue: MARKER,
      pathname: `/p/${MARKER}`,
    });

    expect(output()).not.toContain(MARKER);
  });

  it('keeps ids, codes and names that only look similar', () => {
    const { logger, output } = capture();
    const kept = {
      clinicId: 'clinic-1',
      context: { requestId: 'request-1' },
      emailCount: 3,
      phoneCountry: 'MK',
      inputTokens: 120,
      tokenHash: 'hash-1',
      status: 'sent',
    };
    logger.info(kept);

    expect(JSON.parse(output())).toMatchObject({ ...kept, hostname: expect.any(String) });
  });

  it('drops personal fields at any depth and inside arrays', () => {
    const { logger, output } = capture();
    logger.info({
      patient: { id: 'patient-1', contact: { email: MARKER, phone: MARKER } },
      recipients: [{ id: 'recipient-1', phone: MARKER }, [{ firstName: MARKER }]],
    });

    expect(output()).not.toContain(MARKER);
    expect(output()).toContain('patient-1');
    expect(output()).toContain('recipient-1');
  });

  it('matches field names regardless of case, underscores and dashes', () => {
    const { logger, output } = capture();
    logger.info({
      first_name: MARKER,
      FirstName: MARKER,
      'FIRST-NAME': MARKER,
      Email: MARKER,
      PHONE_NUMBER: MARKER,
      date_of_birth: MARKER,
    });

    expect(output()).not.toContain(MARKER);
  });

  it('drops personal fields from child logger bindings', () => {
    const { logger, output } = capture();
    logger.child({ email: MARKER, requestId: 'request-1' }).info('handled');

    expect(output()).not.toContain(MARKER);
    expect(output()).toContain('request-1');
  });

  it('drops personal fields from grandchild loggers and from setBindings', () => {
    const { logger, output } = capture();
    const child = logger.child({ jobId: 'job-1' }, { msgPrefix: '[job] ' });
    const grandchild = child.child({ phone: MARKER, step: 'send' });
    grandchild.info('step done');
    child.setBindings({ name: MARKER, attempt: 2 });
    child.info('retrying');

    expect(output()).not.toContain(MARKER);
    expect(output()).toContain('job-1');
    expect(output()).toContain('"step":"send"');
    expect(output()).toContain('"attempt":2');
    expect(output()).toContain('[job] retrying');
  });

  it('drops the row values a Postgres error carries in its detail', () => {
    const { logger, output } = capture();
    const err = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: `Key (email)=(${MARKER}) already exists.`,
    });
    logger.error({ err }, 'insert failed');

    expect(output()).not.toContain(MARKER);
    expect(JSON.parse(output())).toMatchObject({
      msg: 'insert failed',
      err: {
        type: 'Error',
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      },
    });
  });

  it('cleans errors under any key and in error causes', () => {
    const { logger, output } = capture();
    const inner = Object.assign(new Error('inner'), { phone: MARKER, detail: MARKER });
    logger.error({ error: inner, err: new Error('outer', { cause: inner }) }, 'failed');

    expect(output()).not.toContain(MARKER);
    expect(output()).toContain('outer');
    expect(output()).toContain('inner');
  });

  it('keeps shared values and survives circular references', () => {
    const { logger, output } = capture();
    const shared = { appointmentId: 'appointment-1' };
    const circular: Record<string, unknown> = { id: 'loop-1', email: MARKER };
    circular.self = circular;
    logger.info({ first: shared, second: shared, circular });

    const line = JSON.parse(output());
    expect(line.first).toEqual(shared);
    expect(line.second).toEqual(shared);
    expect(line.circular).toEqual({ id: 'loop-1', self: '[Circular]' });
    expect(output()).not.toContain(MARKER);
  });

  it('survives an error that is its own cause', () => {
    const { logger, output } = capture();
    const err = new Error('loop');
    Object.assign(err, { cause: err });
    logger.error({ err }, 'failed');

    expect(JSON.parse(output()).err).toMatchObject({ message: 'loop', cause: '[Circular]' });
  });

  it('drops recipient, contact, health and URL fields', () => {
    const { logger, output } = capture();
    logger.info({
      to: MARKER,
      from: MARKER,
      recipient: MARKER,
      contact: MARKER,
      msisdn: MARKER,
      wa_id: MARKER,
      birthday: MARKER,
      zip: MARKER,
      postcode: MARKER,
      ip: MARKER,
      reason: MARKER,
      diagnosis: MARKER,
      params: [MARKER],
      url: MARKER,
      href: MARKER,
      link: MARKER,
      path: `/p/${MARKER}`,
      recipientMsisdn: MARKER,
      emergencyContact: MARKER,
      callbackUrl: MARKER,
      confirmLink: MARKER,
      searchParams: MARKER,
    });

    expect(output()).not.toContain(MARKER);
  });

  // E01-T02a (E01-T01a critical review): the patient phone column, under the database's name and
  // the code's, and an appointment's title, the calendar's label, which names a treatment.
  it.each(['phone_e164', 'phoneE164', 'title'])('drops a field named %s', (field) => {
    const { logger, output } = capture();
    logger.info({ [field]: MARKER, appointmentId: 'appointment-1' }, 'appointment booked');

    expect(output()).not.toContain(MARKER);
    expect(JSON.parse(output())).toMatchObject({ appointmentId: 'appointment-1' });
  });

  it('drops them nested, and in child logger bindings', () => {
    const { logger, output } = capture();
    logger.child({ phoneE164: MARKER }).info({
      patient: { id: 'patient-1', phone_e164: MARKER, guardianPhoneE164: MARKER },
      appointments: [{ id: 'appointment-1', title: MARKER }],
    });

    expect(output()).not.toContain(MARKER);
    expect(output()).toContain('patient-1');
    expect(output()).toContain('appointment-1');
  });

  it('keeps names that only contain a short personal word', () => {
    const { logger, output } = capture();
    // `to`, `from`, `ip` and `reason` match only as whole names. A reason code is not free text.
    const kept = {
      photoCount: 1,
      fromCache: true,
      membership: 'membership-1',
      skipReason: 'no_consent',
      recipientId: 'recipient-1',
    };
    logger.info(kept);

    expect(JSON.parse(output())).toMatchObject(kept);
  });
});

describe('logger, errors from failed database queries', () => {
  const SQL = 'update clinics set name = $1 where id = $2';

  /** The shape Drizzle gives a failed query: placeholders in `query`, the values in `params`. */
  function queryError(value: string) {
    const cause = Object.assign(
      new Error('new row for relation "clinics" violates check constraint "clinics_name_check"'),
      { code: '23514', detail: `Failing row contains (${value}).` },
    );
    return Object.assign(new Error(`Failed query: ${SQL}\nparams: ${value},clinic-1`, { cause }), {
      query: SQL,
      params: [value, 'clinic-1'],
    });
  }

  it('drops the values a query was sent from the message, the stack and params', () => {
    const { logger, output } = capture();
    logger.error({ err: queryError(MARKER) }, 'update failed');

    expect(output()).not.toContain(MARKER);
    const { err } = JSON.parse(output());
    expect(err).toMatchObject({
      message: `Failed query: ${SQL}`,
      query: SQL,
      cause: {
        code: '23514',
        message: 'new row for relation "clinics" violates check constraint "clinics_name_check"',
      },
    });
    expect(err.stack.startsWith(`Error: Failed query: ${SQL}\n`)).toBe(true);
    expect(err.stack).toContain('logger.test.ts');
  });

  it('writes the cleaned message as msg when an error is logged without a message', () => {
    const { logger, output } = capture();
    logger.error(queryError(MARKER));
    logger.error({ err: queryError(MARKER) });

    expect(output()).not.toContain(MARKER);
    const lines = output()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({ msg: `Failed query: ${SQL}`, err: { query: SQL } });
    }
  });

  it('cleans errors logged through child and grandchild loggers', () => {
    const { logger, output } = capture();
    const child = logger.child({ jobId: 'job-1' }, { msgPrefix: '[job] ' });
    child.error(queryError(MARKER));
    child.child({ step: 'send' }).error({ err: queryError(MARKER) }, 'failed');

    expect(output()).not.toContain(MARKER);
    expect(output()).toContain('job-1');
    expect(output()).toContain('"step":"send"');
  });

  it('drops the value PostgreSQL quotes in a data error, and the context that can quote data', () => {
    const { logger, output } = capture();
    // A value that contains quotes itself is removed whole.
    const err = Object.assign(new Error(`invalid input syntax for type json: "a"${MARKER}"`), {
      code: '22P02',
      where: `JSON data, line 1: a"${MARKER}`,
    });
    logger.error({ err }, 'insert failed');

    expect(output()).not.toContain(MARKER);
    expect(JSON.parse(output()).err).toMatchObject({
      code: '22P02',
      message: 'invalid input syntax for type json: "…"',
    });
  });

  it('drops the value PostgreSQL quotes in a syntax error, as the full-text search parsers report it', () => {
    const { logger, output } = capture();
    // SQLSTATE 42601. Messages as PostgreSQL 18 writes them; the last one is a syntax error in
    // the SQL itself, whose quoted token goes too.
    const messages = [
      `syntax error in tsquery: "${MARKER} & |"`,
      `there is no escaped character: "${MARKER}\\"`,
      `syntax error at or near "${MARKER}"`,
    ];
    for (const message of messages) {
      logger.error({ err: Object.assign(new Error(message), { code: '42601' }) }, 'search failed');
    }

    expect(output()).not.toContain(MARKER);
    const kept = output()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).err);
    expect(kept).toMatchObject([
      { code: '42601', message: 'syntax error in tsquery: "…"' },
      { code: '42601', message: 'there is no escaped character: "…"' },
      { code: '42601', message: 'syntax error at or near "…"' },
    ]);
  });

  it('keeps the message of other database errors, quoted names included', () => {
    const { logger, output } = capture();
    const message = 'new row for relation "clinics" violates check constraint "clinics_name_check"';
    logger.error({ err: Object.assign(new Error(message), { code: '23514' }) });

    expect(JSON.parse(output()).err.message).toBe(message);
  });

  it('drops a stack that no longer contains the message it was made with', () => {
    const { logger, output } = capture();
    const err = queryError(MARKER);
    void err.stack; // V8 writes the stack on first read: make sure it holds the first message
    err.message = `${err.message} (changed later)`;
    logger.error({ err });

    expect(output()).not.toContain(MARKER);
    expect(JSON.parse(output()).err.stack).toBeUndefined();
  });
});

describe('logger, errors and objects outside the logged object', () => {
  const SQL = 'update clinics set name = $1 where id = $2';

  it('writes a cleaned error through %s as its type and message, with the SQL kept', () => {
    const { logger, output } = capture();
    const err = new DrizzleQueryError(SQL, [MARKER, 'clinic-1'], new Error('check failed'));
    logger.error('update failed: %s', err);

    expect(JSON.parse(output()).msg).toBe(`update failed: Error: Failed query: ${SQL}`);
  });

  it('cleans an object in the place of the message, and objects inside an array argument', () => {
    const { logger, output } = capture();
    const patient = { firstName: MARKER, appointmentId: 'appointment-1' };
    // pino writes a message that is not text as JSON. Its types expect text; plain JavaScript does not.
    logger.info({ requestId: 'request-1' }, patient as unknown as string);
    logger.info('reminders planned for %j', [patient, { phone: MARKER, messageId: 'message-1' }]);

    expect(output()).not.toContain(MARKER);
    expect(output()).toContain('appointment-1');
    expect(output()).toContain('message-1');
  });

  it('keeps the message prefix of a child logger in front of a cleaned error', () => {
    const { logger, output } = capture();
    const child = logger.child({ jobId: 'job-1' }, { msgPrefix: '[job] ' });
    child.error('send failed: %s', new DrizzleQueryError(SQL, [MARKER], new Error('x')));

    expect(output()).not.toContain(MARKER);
    expect(JSON.parse(output()).msg).toBe(`[job] send failed: Error: Failed query: ${SQL}`);
  });
});

// Added by the tester (round 2). pino also writes printf-style arguments (%s, %o, %O, %j) into
// msg. A failed query passed that way must lose its values, and an object passed that way must
// lose its personal fields: the same safety net as for the logged object (finding 1, field list).
describe('logger, printf-style arguments', () => {
  /** A failed query as Drizzle throws it: its message and params hold the values. */
  function failedQuery() {
    const cause = Object.assign(
      new Error(
        'new row for relation "clinics" violates check constraint "clinics_currency_check"',
      ),
      { code: '23514', detail: `Failing row contains (${MARKER}).` },
    );
    return new DrizzleQueryError(
      'update clinics set name = $1 where id = $2',
      [MARKER, 'clinic-1'],
      cause,
    );
  }

  // Literal messages: pino's types check the arguments against the placeholders they contain.
  it.each([
    {
      placeholder: '%s',
      write: (logger: Logger) => logger.error('update failed: %s', failedQuery()),
    },
    {
      placeholder: '%o',
      write: (logger: Logger) => logger.error('update failed: %o', failedQuery()),
    },
    {
      placeholder: '%O',
      write: (logger: Logger) => logger.error('update failed: %O', failedQuery()),
    },
    {
      placeholder: '%j',
      write: (logger: Logger) => logger.error('update failed: %j', failedQuery()),
    },
  ])('drops the values of a failed query passed with $placeholder', ({ write }) => {
    const { logger, output } = capture();
    write(logger);

    expect(output()).toContain('update failed');
    expect(output()).not.toContain(MARKER);
  });

  it('drops them when the error is logged as a field and again as an argument', () => {
    const { logger, output } = capture();
    const err = failedQuery();
    logger.error({ err }, 'update failed: %s', err);

    expect(output()).not.toContain(MARKER);
  });

  const patient = { firstName: MARKER, phone: MARKER, appointmentId: 'appointment-1' };

  it.each([
    {
      placeholder: '%o',
      write: (logger: Logger) => logger.info('reminder planned for %o', patient),
    },
    {
      placeholder: '%O',
      write: (logger: Logger) => logger.info('reminder planned for %O', patient),
    },
    {
      placeholder: '%j',
      write: (logger: Logger) => logger.info('reminder planned for %j', patient),
    },
  ])('drops personal fields of an object passed with $placeholder', ({ write }) => {
    const { logger, output } = capture();
    write(logger);

    expect(output()).toContain('reminder planned for');
    expect(output()).not.toContain(MARKER);
  });

  it('still writes plain values such as ids', () => {
    const { logger, output } = capture();
    logger.info('message %s planned for clinic %s', 'message-1', 'clinic-1');

    expect(JSON.parse(output()).msg).toBe('message message-1 planned for clinic clinic-1');
  });
});

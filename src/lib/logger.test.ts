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
});

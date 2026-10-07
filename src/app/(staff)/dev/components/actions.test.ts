import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { logger } from '@/lib/logger';
import type { Role } from '@/modules/auth';
import { demoAnswer, demoOwnerOnly } from './actions';

// E00-T04c, acceptance 6 (the action's part): in a production build the demo actions refuse before
// anything is written. They are the real wrapper-made actions; only who is asking (currentStaff)
// and the transaction are stand-ins, as no database runs here: the transaction records every use,
// and the audit log every row it is asked to write. Every value is synthetic.

const CLINIC = '01970000-0000-7000-8000-0000000000c1';

const request = vi.hoisted(() => ({ staff: undefined as Staff | undefined }));
vi.mock('@/app/_lib/auth', () => ({
  currentStaff: () => Promise.resolve(request.staff),
  requireUser: () => Promise.reject(new Error('the demo actions are staff actions')),
}));

const db = vi.hoisted(() => ({ opened: 0, used: [] as string[] }));
vi.mock('@/db/tenant', () => ({
  withTenant: async (_clinicId: string, work: (tx: unknown) => Promise<unknown>) => {
    db.opened += 1;
    const tx = new Proxy(
      {},
      {
        get(_target, property) {
          db.used.push(String(property));
          throw new Error('the handler used the transaction');
        },
      },
    );
    return work(tx);
  },
}));

const audit = vi.hoisted(() => ({ record: vi.fn(() => Promise.resolve('row')) }));
vi.mock('@/modules/audit', () => ({ record: audit.record }));

function member(role: Role): Staff {
  return {
    user: {
      id: '01970000-0000-7000-8000-0000000000c2',
      name: 'Demo member',
      email: 'demo-member@example.test',
    },
    clinic: {
      membershipId: '01970000-0000-7000-8000-0000000000c3',
      clinicId: CLINIC,
      clinicName: 'Test clinic (synthetic)',
      role,
      extraPermissions: [],
      providerKind: null,
    },
    clinicCount: 1,
  };
}

/**
 * The demo form's data, asking for `answer`, with valid fields unless told otherwise. The checkbox
 * and the switch are off unless told otherwise: off, the browser sends nothing for them.
 */
function sent(
  answer: string,
  fields: {
    note?: string;
    code?: string;
    details?: string;
    choice?: string;
    checkbox?: string;
    switch?: string;
  } = {},
): FormData {
  const data = new FormData();
  data.append('note', fields.note ?? 'a note');
  data.append('code', fields.code ?? '1234');
  data.append('details', fields.details ?? 'some details');
  data.append('choice', fields.choice ?? 'second');
  if (fields.checkbox !== undefined) data.append('checkbox', fields.checkbox);
  if (fields.switch !== undefined) data.append('switch', fields.switch);
  data.append('answer', answer);
  return data;
}

beforeEach(() => {
  request.staff = member('owner');
  db.opened = 0;
  db.used = [];
  audit.record.mockClear();
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('in a production build, the demo actions refuse before anything is written', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
  });

  it.each(['done', 'refusal', 'internal'])(
    'demoAnswer, asked for %s: not_found',
    async (answer) => {
      expect(await demoAnswer(CLINIC, sent(answer))).toEqual({
        ok: false,
        error: { code: 'not_found' },
      });
      expect(db.used, 'what the handler did with the transaction').toEqual([]);
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('demoOwnerOnly, for an owner: not_found, with nothing written either', async () => {
    expect(await demoOwnerOnly(CLINIC, sent('forbidden'))).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(db.used).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('outside production, each answer as asked', () => {
  it('done: the answer, and the one audit row every staff action writes', async () => {
    expect(await demoAnswer(CLINIC, sent('done'))).toEqual({
      ok: true,
      value: { answer: 'done' },
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'demo.answered',
        entityType: 'clinic',
        entityId: CLINIC,
        metadata: { answer: 'done' },
      }),
    );
  });

  it('a refusal of its own: demo_refused, and no audit row', async () => {
    expect(await demoAnswer(CLINIC, sent('refusal'))).toEqual({
      ok: false,
      error: { code: 'demo_refused' },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('something unexpected: internal', async () => {
    expect(await demoAnswer(CLINIC, sent('internal'))).toEqual({
      ok: false,
      error: { code: 'internal' },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('fields that do not fit: invalid_input at each of them', async () => {
    expect(await demoAnswer(CLINIC, sent('done', { note: 'x', code: '12a' }))).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        issues: [
          { path: ['note'], code: 'too_small' },
          { path: ['code'], code: 'invalid_format' },
        ],
      },
    });
    expect(db.opened).toBe(0);
  });

  it.each([
    { what: 'empty details', fields: { details: '  ' }, path: 'details', code: 'too_small' },
    {
      what: 'details of 201 characters',
      fields: { details: 'x'.repeat(201) },
      path: 'details',
      code: 'too_big',
    },
    { what: 'the empty choice', fields: { choice: '' }, path: 'choice', code: 'invalid_value' },
    {
      what: 'a choice the select does not offer',
      fields: { choice: 'fourth' },
      path: 'choice',
      code: 'invalid_value',
    },
    {
      what: 'a checkbox sent as anything but on',
      fields: { checkbox: 'yes' },
      path: 'checkbox',
      code: 'invalid_value',
    },
    {
      what: 'a switch sent as anything but on',
      fields: { switch: 'off' },
      path: 'switch',
      code: 'invalid_value',
    },
  ])(
    'E00-T04d, $what: invalid_input at that field, before any transaction',
    async ({ fields, path, code }) => {
      expect(await demoAnswer(CLINIC, sent('done', fields))).toEqual({
        ok: false,
        error: { code: 'invalid_input', issues: [{ path: [path], code }] },
      });
      expect(db.opened).toBe(0);
    },
  );

  it('E00-T04d: the checkbox and the switch, on or off, are both fine', async () => {
    for (const fields of [
      {},
      { checkbox: 'on' },
      { switch: 'on' },
      { checkbox: 'on', switch: 'on' },
    ]) {
      expect(await demoAnswer(CLINIC, sent('done', fields))).toEqual({
        ok: true,
        value: { answer: 'done' },
      });
    }
  });

  it('the owner-only action: forbidden to the front desk, before any transaction', async () => {
    request.staff = member('front_desk');
    expect(await demoOwnerOnly(CLINIC, sent('forbidden'))).toEqual({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(db.opened).toBe(0);
  });

  it('the owner-only action: done for an owner', async () => {
    expect(await demoOwnerOnly(CLINIC, sent('forbidden'))).toEqual({
      ok: true,
      value: { answer: 'forbidden' },
    });
  });

  it('sent for another clinic than the request is in: clinic_changed, before any transaction', async () => {
    expect(await demoAnswer('01970000-0000-7000-8000-0000000000d1', sent('done'))).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect(db.opened).toBe(0);
  });
});

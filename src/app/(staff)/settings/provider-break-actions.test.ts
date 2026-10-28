import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { logger } from '@/lib/logger';
import { addBreak, removeBreak } from './provider-actions';

// E01-T09e, acceptance 3, 4 and 5 (the form's side): what the Breaks dialog's two forms hand
// scheduling.addProviderBreak and scheduling.removeProviderBreak, what they answer, and the audit row
// each asks for. The real wrapper-made actions with the real schemas; who is asking (currentStaff),
// the transaction, the audit log, next/cache and the module's database functions are stand-ins, as in
// provider-order-actions.test.ts. The module against real rows, as each role and across clinics, is
// tests/integration/provider-breaks.test.ts. Every id and label is an invented one.

const CLINIC = '01970000-0000-7000-8000-0000000000f1';
const USER = '01970000-0000-7000-8000-0000000000f2';
const PROVIDER = '01970000-0000-7000-8000-0000000000f3';
const BREAK = '01970000-0000-7000-8000-0000000000f5';
const TX = { stand: 'in for the transaction' };

const request = vi.hoisted(() => ({ staff: undefined as Staff | undefined }));
vi.mock('@/app/_lib/auth', () => ({
  currentStaff: () => Promise.resolve(request.staff),
  requireUser: () => Promise.reject(new Error('the settings actions are staff actions')),
}));

const db = vi.hoisted(() => ({ opened: 0 }));
vi.mock('@/db/tenant', () => ({
  withTenant: async (_clinicId: string, work: (tx: unknown) => Promise<unknown>) => {
    db.opened += 1;
    return work(TX);
  },
}));

const audit = vi.hoisted(() => ({ record: vi.fn(() => Promise.resolve('row')) }));
vi.mock('@/modules/audit', () => ({ record: audit.record }));

const scheduling = vi.hoisted(() => ({ addProviderBreak: vi.fn(), removeProviderBreak: vi.fn() }));
vi.mock('@/modules/scheduling', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/scheduling')>()),
  ...scheduling,
}));

const cache = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/cache', () => cache);

function staffAs(role: Staff['clinic']['role']): Staff {
  return {
    user: { id: USER, name: 'Owner', email: 'owner-breaks@example.test' },
    clinic: {
      membershipId: '01970000-0000-7000-8000-0000000000f4',
      clinicId: CLINIC,
      clinicName: 'Test clinic (synthetic)',
      role,
      extraPermissions: [],
      providerKind: null,
    },
    clinicCount: 1,
  };
}

/** The add form's fields, with those given in place of these (undefined leaves one out). */
function addForm(fields: Record<string, string | undefined> = {}): FormData {
  const all: Record<string, string | undefined> = {
    providerId: PROVIDER,
    weekday: '3',
    starts: '12:00',
    ends: '13:15',
    label: 'Lunch',
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) {
    if (value !== undefined) data.append(name, value);
  }
  return data;
}

function removeForm(breakId: string | undefined = BREAK): FormData {
  const data = new FormData();
  data.append('breakId', breakId);
  return data;
}

/** The paths of the issues of an invalid_input answer. */
function issuePaths(result: unknown): unknown[][] {
  return (result as { error: { issues: { path: unknown[] }[] } }).error.issues.map(
    (issue) => issue.path,
  );
}

beforeEach(() => {
  request.staff = staffAs('owner');
  db.opened = 0;
  audit.record.mockClear();
  scheduling.addProviderBreak.mockReset();
  scheduling.addProviderBreak.mockResolvedValue({ ok: true, id: BREAK });
  scheduling.removeProviderBreak.mockReset();
  scheduling.removeProviderBreak.mockResolvedValue({ ok: true, providerId: PROVIDER });
  cache.refresh.mockReset();
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('addBreak: what it hands scheduling.addProviderBreak', () => {
  it("the provider, the weekday as a number, the two times as written and the label trimmed, in a transaction of the clinic, at the action's moment; one provider.break_added row of ids and the weekday; the page refreshed", async () => {
    expect(await addBreak(CLINIC, addForm({ label: '  Lunch  ' }))).toEqual({
      ok: true,
      value: { id: BREAK },
    });
    expect(db.opened).toBe(1);
    expect(scheduling.addProviderBreak).toHaveBeenCalledExactlyOnceWith(
      TX,
      { providerId: PROVIDER, weekday: 3, starts: '12:00', ends: '13:15', label: 'Lunch' },
      expect.any(Date),
    );
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, {
      at: expect.any(Date),
      actorType: 'user',
      actorId: USER,
      action: 'provider.break_added',
      entityType: 'provider_break',
      entityId: BREAK,
      metadata: { providerId: PROVIDER, weekday: 3 },
    });
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it.each(['not_found', 'break_overlaps'] as const)(
    "the module's %s: refused with that code, no audit row, nothing refreshed",
    async (code) => {
      scheduling.addProviderBreak.mockResolvedValue({ ok: false, code });
      expect(await addBreak(CLINIC, addForm())).toEqual({ ok: false, error: { code } });
      expect(audit.record).not.toHaveBeenCalled();
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it.each([
    { what: 'no provider', fields: { providerId: undefined }, path: 'providerId' },
    { what: 'a provider that is no id', fields: { providerId: 'nope' }, path: 'providerId' },
    { what: 'no weekday', fields: { weekday: undefined }, path: 'weekday' },
    { what: 'weekday 0', fields: { weekday: '0' }, path: 'weekday' },
    { what: 'weekday 8', fields: { weekday: '8' }, path: 'weekday' },
    { what: 'a weekday of two digits', fields: { weekday: '10' }, path: 'weekday' },
    { what: 'a weekday in words', fields: { weekday: 'monday' }, path: 'weekday' },
    { what: 'no start', fields: { starts: undefined }, path: 'starts' },
    { what: 'a start that is no time', fields: { starts: '25:00' }, path: 'starts' },
    { what: 'a start written 9:00', fields: { starts: '9:00' }, path: 'starts' },
    { what: 'a start of words', fields: { starts: 'noon' }, path: 'starts' },
    { what: 'no end', fields: { ends: undefined }, path: 'ends' },
    { what: 'an end that is no time', fields: { ends: '12:60' }, path: 'ends' },
    { what: 'no label', fields: { label: undefined }, path: 'label' },
    { what: 'an empty label', fields: { label: '' }, path: 'label' },
    { what: 'a label of blanks', fields: { label: '   ' }, path: 'label' },
    { what: 'a label of 41 characters', fields: { label: 'x'.repeat(41) }, path: 'label' },
    { what: 'an end equal to the start', fields: { starts: '12:00', ends: '12:00' }, path: 'ends' },
    { what: 'an end before the start', fields: { starts: '13:00', ends: '12:45' }, path: 'ends' },
  ])('$what: invalid_input at $path alone, before any transaction', async ({ fields, path }) => {
    const result = await addBreak(CLINIC, addForm(fields));
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(issuePaths(result)).toEqual([[path]]);
    expect(db.opened).toBe(0);
    expect(scheduling.addProviderBreak).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('a label of exactly 40 characters, and an end one minute after the start, pass', async () => {
    const label = 'x'.repeat(40);
    const answer = await addBreak(CLINIC, addForm({ label, starts: '12:00', ends: '12:01' }));
    expect(answer).toMatchObject({ ok: true });
    expect(scheduling.addProviderBreak).toHaveBeenCalledExactlyOnceWith(
      TX,
      { providerId: PROVIDER, weekday: 3, starts: '12:00', ends: '12:01', label },
      expect.any(Date),
    );
  });

  it('every weekday from 1 to 7 passes', async () => {
    for (const weekday of ['1', '2', '3', '4', '5', '6', '7']) {
      expect(await addBreak(CLINIC, addForm({ weekday }))).toMatchObject({ ok: true });
    }
    expect(scheduling.addProviderBreak).toHaveBeenCalledTimes(7);
  });

  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, before any transaction, nothing added',
    async (role) => {
      request.staff = staffAs(role);
      expect(await addBreak(CLINIC, addForm())).toEqual({
        ok: false,
        error: { code: 'forbidden' },
      });
      expect(db.opened).toBe(0);
      expect(scheduling.addProviderBreak).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('a failure inside the module is the general one, with nothing audited or refreshed', async () => {
    scheduling.addProviderBreak.mockRejectedValue(new Error('the database is down'));
    expect(await addBreak(CLINIC, addForm())).toEqual({ ok: false, error: { code: 'internal' } });
    expect(audit.record).not.toHaveBeenCalled();
    expect(cache.refresh).not.toHaveBeenCalled();
  });
});

describe('removeBreak: what it hands scheduling.removeProviderBreak', () => {
  it('the break id alone in a transaction of the clinic; one provider.break_removed row about the break; the page refreshed', async () => {
    expect(await removeBreak(CLINIC, removeForm())).toEqual({ ok: true, value: { id: BREAK } });
    expect(db.opened).toBe(1);
    expect(scheduling.removeProviderBreak).toHaveBeenCalledExactlyOnceWith(TX, BREAK);
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, {
      at: expect.any(Date),
      actorType: 'user',
      actorId: USER,
      action: 'provider.break_removed',
      entityType: 'provider_break',
      entityId: BREAK,
      metadata: undefined,
    });
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('a break already gone: not_found, no audit row, nothing refreshed', async () => {
    scheduling.removeProviderBreak.mockResolvedValue({ ok: false, code: 'not_found' });
    expect(await removeBreak(CLINIC, removeForm())).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it('an id that is no id: invalid_input at breakId, before any transaction', async () => {
    const result = await removeBreak(CLINIC, removeForm('nope'));
    expect(issuePaths(result)).toEqual([['breakId']]);
    expect(db.opened).toBe(0);
    expect(scheduling.removeProviderBreak).not.toHaveBeenCalled();
  });

  it('no id: invalid_input at breakId, before any transaction', async () => {
    const result = await removeBreak(CLINIC, new FormData());
    expect(issuePaths(result)).toEqual([['breakId']]);
    expect(db.opened).toBe(0);
  });

  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, before any transaction, nothing removed',
    async (role) => {
      request.staff = staffAs(role);
      expect(await removeBreak(CLINIC, removeForm())).toEqual({
        ok: false,
        error: { code: 'forbidden' },
      });
      expect(db.opened).toBe(0);
      expect(scheduling.removeProviderBreak).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { logger } from '@/lib/logger';
import { moveProvider } from './provider-actions';

// E01-T09c, acceptance 2 and 6 (the form's side): what the Providers tab's Up and Down take from their
// forms and hand scheduling.moveProvider, what they answer, and the audit row each asks for. The real
// wrapper-made action with the real schema; who is asking (currentStaff), the transaction, the audit
// log, next/cache and the module's database function are stand-ins, as in provider-edit-actions.test.ts.
// The module's work against real rows, as each role and across clinics, is
// tests/integration/provider-order.test.ts. Every id is an invented one.

const CLINIC = '01970000-0000-7000-8000-0000000000e1';
const USER = '01970000-0000-7000-8000-0000000000e2';
const PROVIDER = '01970000-0000-7000-8000-0000000000e3';
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

const scheduling = vi.hoisted(() => ({ moveProvider: vi.fn() }));
vi.mock('@/modules/scheduling', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/scheduling')>()),
  ...scheduling,
}));

const cache = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/cache', () => cache);

function staffAs(role: Staff['clinic']['role']): Staff {
  return {
    user: { id: USER, name: 'Owner', email: 'owner-order@example.test' },
    clinic: {
      membershipId: '01970000-0000-7000-8000-0000000000e4',
      clinicId: CLINIC,
      clinicName: 'Test clinic (synthetic)',
      role,
      extraPermissions: [],
      providerKind: null,
    },
    clinicCount: 1,
  };
}

/** A row's form: the id and the direction, hidden, with those given in place of these. */
function moveForm(fields: Record<string, string | undefined> = {}): FormData {
  const all: Record<string, string | undefined> = {
    providerId: PROVIDER,
    direction: 'up',
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) {
    if (value !== undefined) data.append(name, value);
  }
  return data;
}

beforeEach(() => {
  request.staff = staffAs('owner');
  db.opened = 0;
  audit.record.mockClear();
  scheduling.moveProvider.mockReset();
  scheduling.moveProvider.mockResolvedValue({ ok: true });
  cache.refresh.mockReset();
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('moveProvider: what it hands scheduling.moveProvider', () => {
  it.each(['up', 'down'] as const)(
    "%s: the id and the direction in a transaction of the clinic, at the action's moment; one provider.moved row of ids and the direction; the page refreshed",
    async (direction) => {
      expect(await moveProvider(CLINIC, moveForm({ direction }))).toEqual({
        ok: true,
        value: { id: PROVIDER },
      });
      expect(db.opened).toBe(1);
      expect(scheduling.moveProvider).toHaveBeenCalledExactlyOnceWith(
        TX,
        { providerId: PROVIDER, direction },
        expect.any(Date),
      );
      expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, {
        at: expect.any(Date),
        actorType: 'user',
        actorId: USER,
        action: 'provider.moved',
        entityType: 'provider',
        entityId: PROVIDER,
        metadata: { direction },
      });
      expect(cache.refresh).toHaveBeenCalledOnce();
    },
  );

  it.each(['not_found', 'already_first', 'already_last'] as const)(
    "the module's %s: refused with that code, no audit row, nothing refreshed",
    async (code) => {
      scheduling.moveProvider.mockResolvedValue({ ok: false, code });
      expect(await moveProvider(CLINIC, moveForm())).toEqual({ ok: false, error: { code } });
      expect(audit.record).not.toHaveBeenCalled();
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it.each([
    { what: 'no id', fields: { providerId: undefined }, path: 'providerId' },
    { what: 'an id that is no id', fields: { providerId: 'not-an-id' }, path: 'providerId' },
    { what: 'no direction', fields: { direction: undefined }, path: 'direction' },
    { what: 'a direction that is neither', fields: { direction: 'sideways' }, path: 'direction' },
    { what: 'a direction in capitals', fields: { direction: 'UP' }, path: 'direction' },
  ])('$what: invalid_input at $path, before any transaction', async ({ fields, path }) => {
    const result = await moveProvider(CLINIC, moveForm(fields));
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const issues = (result as { error: { issues: { path: unknown[] }[] } }).error.issues;
    expect(issues.map((issue) => issue.path)).toEqual([[path]]);
    expect(db.opened).toBe(0);
    expect(scheduling.moveProvider).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, before any transaction, nothing moved',
    async (role) => {
      request.staff = staffAs(role);
      expect(await moveProvider(CLINIC, moveForm())).toEqual({
        ok: false,
        error: { code: 'forbidden' },
      });
      expect(db.opened).toBe(0);
      expect(scheduling.moveProvider).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('a failure inside the module is the general one, with nothing audited or refreshed', async () => {
    scheduling.moveProvider.mockRejectedValue(new Error('the database is down'));
    expect(await moveProvider(CLINIC, moveForm())).toEqual({
      ok: false,
      error: { code: 'internal' },
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(cache.refresh).not.toHaveBeenCalled();
  });
});

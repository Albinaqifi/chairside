import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { logger } from '@/lib/logger';
import {
  activateProvider,
  changeProvider,
  deactivateProvider,
  readLinkedProviders,
} from './provider-actions';

// E01-T09d, acceptance 2, 3 and 5 (the form's side): what the Providers tab's Edit, Make inactive and
// Make active take from their forms and hand the modules, what they answer, and the audit row each
// asks for. The real wrapper-made actions with the real schema; who is asking (currentStaff), the
// transaction, the audit log, next/cache and the modules' database functions are stand-ins, as in
// provider-actions.test.ts. The modules' work against real rows, as each role and across clinics, is
// tests/integration/providers-edit.test.ts. Every name is an invented one.

const CLINIC = '01970000-0000-7000-8000-0000000000f1';
const USER = '01970000-0000-7000-8000-0000000000f2';
const PROVIDER = '01970000-0000-7000-8000-0000000000f3';
const OTHER = '01970000-0000-7000-8000-0000000000f5';
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

const scheduling = vi.hoisted(() => ({
  changeProvider: vi.fn(),
  setProviderActive: vi.fn(),
  visitsAhead: vi.fn(),
}));
vi.mock('@/modules/scheduling', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/scheduling')>()),
  ...scheduling,
}));

const auth = vi.hoisted(() => ({ linkedProviderIds: vi.fn() }));
vi.mock('@/modules/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/auth')>()),
  ...auth,
}));

const cache = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/cache', () => cache);

function staffAs(role: Staff['clinic']['role']): Staff {
  return {
    user: { id: USER, name: 'Owner', email: 'owner-providers@example.test' },
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

/** The edit form's data: every field and the id, with those given in place of these. */
function edited(fields: Record<string, string | undefined> = {}): FormData {
  const all: Record<string, string | undefined> = {
    providerId: PROVIDER,
    name: 'Mira Testova',
    shortName: 'Dr. Testova',
    kind: 'dentist',
    chairLabel: 'Chair 4',
    colorHue: '200',
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) {
    if (value !== undefined) data.append(name, value);
  }
  return data;
}

/** A row's form: the id alone. */
function idForm(id: string = PROVIDER): FormData {
  const data = new FormData();
  data.append('providerId', id);
  return data;
}

function auditOf(action: string) {
  return {
    at: expect.any(Date),
    actorType: 'user',
    actorId: USER,
    action,
    entityType: 'provider',
    entityId: PROVIDER,
    metadata: undefined,
  };
}

beforeEach(() => {
  request.staff = staffAs('owner');
  db.opened = 0;
  audit.record.mockClear();
  scheduling.changeProvider.mockReset();
  scheduling.changeProvider.mockResolvedValue({ ok: true });
  scheduling.setProviderActive.mockReset();
  scheduling.setProviderActive.mockResolvedValue({ ok: true });
  scheduling.visitsAhead.mockReset();
  scheduling.visitsAhead.mockResolvedValue(0);
  auth.linkedProviderIds.mockReset();
  auth.linkedProviderIds.mockResolvedValue([]);
  cache.refresh.mockReset();
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('changeProvider: what it hands scheduling.changeProvider', () => {
  it('the texts trimmed, the hue a number, the id apart; the kind not locked when no login is linked; one provider.updated row of ids; the page refreshed', async () => {
    auth.linkedProviderIds.mockResolvedValue([OTHER]);
    const result = await changeProvider(
      CLINIC,
      edited({ name: ' Mira Testova ', kind: 'other', chairLabel: ' Chair 5 ', colorHue: '37' }),
    );
    expect(result).toEqual({ ok: true, value: { id: PROVIDER } });
    expect(auth.linkedProviderIds).toHaveBeenCalledExactlyOnceWith(TX);
    expect(scheduling.changeProvider).toHaveBeenCalledExactlyOnceWith(
      TX,
      PROVIDER,
      {
        name: 'Mira Testova',
        shortName: 'Dr. Testova',
        kind: 'other',
        chairLabel: 'Chair 5',
        colorHue: 37,
      },
      expect.any(Date),
      { kindLocked: false },
    );
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, auditOf('provider.updated'));
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('a provider a login is linked to: the kind locked, read in the same transaction', async () => {
    auth.linkedProviderIds.mockResolvedValue([OTHER, PROVIDER]);
    expect(await changeProvider(CLINIC, edited())).toMatchObject({ ok: true });
    expect(scheduling.changeProvider).toHaveBeenCalledWith(
      TX,
      PROVIDER,
      expect.anything(),
      expect.any(Date),
      { kindLocked: true },
    );
    expect(db.opened).toBe(1);
  });

  it.each(['provider_linked', 'not_found'] as const)(
    "the module's %s: refused with that code, no audit row, nothing refreshed",
    async (code) => {
      scheduling.changeProvider.mockResolvedValue({ ok: false, code });
      expect(await changeProvider(CLINIC, edited())).toEqual({ ok: false, error: { code } });
      expect(audit.record).not.toHaveBeenCalled();
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it.each([
    { what: 'no id', fields: { providerId: undefined }, path: 'providerId' },
    { what: 'an id that is no id', fields: { providerId: 'not-an-id' }, path: 'providerId' },
    { what: 'an empty name', fields: { name: ' ' }, path: 'name' },
    { what: 'a kind the select does not offer', fields: { kind: 'surgeon' }, path: 'kind' },
    { what: 'no kind (a disabled select alone)', fields: { kind: undefined }, path: 'kind' },
    { what: 'a hue of 360', fields: { colorHue: '360' }, path: 'colorHue' },
  ])('$what: invalid_input at $path, before any transaction', async ({ fields, path }) => {
    const result = await changeProvider(CLINIC, edited(fields));
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const issues = (result as { error: { issues: { path: unknown[] }[] } }).error.issues;
    expect(issues.map((issue) => issue.path)).toEqual([[path]]);
    expect(db.opened).toBe(0);
    expect(scheduling.changeProvider).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('deactivateProvider and activateProvider', () => {
  it('Make inactive: the provider set inactive, its visits ahead counted at the same moment; the count in the answer; one provider.deactivated row', async () => {
    scheduling.visitsAhead.mockResolvedValue(3);
    expect(await deactivateProvider(CLINIC, idForm())).toEqual({
      ok: true,
      value: { id: PROVIDER, visitsAhead: 3 },
    });
    expect(scheduling.setProviderActive).toHaveBeenCalledExactlyOnceWith(
      TX,
      PROVIDER,
      false,
      expect.any(Date),
    );
    const [, , , setAt] = scheduling.setProviderActive.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      Date,
    ];
    expect(scheduling.visitsAhead).toHaveBeenCalledExactlyOnceWith(TX, PROVIDER, setAt);
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, auditOf('provider.deactivated'));
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('Make active: set active; one provider.activated row; nothing counted', async () => {
    expect(await activateProvider(CLINIC, idForm())).toEqual({ ok: true, value: { id: PROVIDER } });
    expect(scheduling.setProviderActive).toHaveBeenCalledExactlyOnceWith(
      TX,
      PROVIDER,
      true,
      expect.any(Date),
    );
    expect(scheduling.visitsAhead).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, auditOf('provider.activated'));
  });

  it.each([
    ['deactivate', 'already_inactive'],
    ['deactivate', 'not_found'],
    ['activate', 'already_active'],
    ['activate', 'not_found'],
  ] as const)(
    "%s, the module's %s: refused, no audit row, nothing counted",
    async (which, code) => {
      scheduling.setProviderActive.mockResolvedValue({ ok: false, code });
      const action = which === 'deactivate' ? deactivateProvider : activateProvider;
      expect(await action(CLINIC, idForm())).toEqual({ ok: false, error: { code } });
      expect(scheduling.visitsAhead).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it('an id that is no id: invalid_input at it, before any transaction', async () => {
    for (const action of [deactivateProvider, activateProvider]) {
      const result = await action(CLINIC, idForm('not-an-id'));
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    }
    expect(db.opened).toBe(0);
  });
});

describe('only settings.manage reads the links or changes a provider (acceptance 5)', () => {
  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, before any transaction; nothing handed on',
    async (role) => {
      request.staff = staffAs(role);
      const forbidden = { ok: false, error: { code: 'forbidden' } };
      expect(await readLinkedProviders(CLINIC, {})).toEqual(forbidden);
      expect(await readLinkedProviders.forPage({})).toEqual(forbidden);
      expect(await changeProvider(CLINIC, edited())).toEqual(forbidden);
      expect(await deactivateProvider(CLINIC, idForm())).toEqual(forbidden);
      expect(await activateProvider(CLINIC, idForm())).toEqual(forbidden);
      expect(db.opened).toBe(0);
      expect(auth.linkedProviderIds).not.toHaveBeenCalled();
      expect(scheduling.changeProvider).not.toHaveBeenCalled();
      expect(scheduling.setProviderActive).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it("as the owner: the links' read hands back auth's ids, no audit row", async () => {
    auth.linkedProviderIds.mockResolvedValue([PROVIDER]);
    expect(await readLinkedProviders.forPage({})).toEqual({ ok: true, value: [PROVIDER] });
    expect(auth.linkedProviderIds).toHaveBeenCalledExactlyOnceWith(TX);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { logger } from '@/lib/logger';
import { addProvider, readProviders } from './provider-actions';

// E01-T09b, acceptance 2 and 5 (the form's side): what the Providers tab's add takes from its form
// and hands the scheduling module, what it answers, and the audit row it asks for. The real
// wrapper-made actions with the real schema; who is asking (currentStaff), the transaction, the audit
// log, next/cache and the scheduling module's database functions are stand-ins, as in
// actions.test.ts. The module's work against real rows, as each role and across clinics, is in
// tests/integration/providers-settings.test.ts. Every name is an invented one.

const CLINIC = '01970000-0000-7000-8000-0000000000f1';
const USER = '01970000-0000-7000-8000-0000000000f2';
const ADDED = '01970000-0000-7000-8000-0000000000f3';
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

const scheduling = vi.hoisted(() => ({ addProvider: vi.fn(), clinicProviders: vi.fn() }));
vi.mock('@/modules/scheduling', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/scheduling')>()),
  ...scheduling,
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

/** The add form's data: every field, as the browser sends it, with those given in place of these. */
function sent(fields: Record<string, string | undefined> = {}): FormData {
  const all: Record<string, string | undefined> = {
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

beforeEach(() => {
  request.staff = staffAs('owner');
  db.opened = 0;
  audit.record.mockClear();
  scheduling.addProvider.mockReset();
  scheduling.addProvider.mockResolvedValue({ id: ADDED });
  scheduling.clinicProviders.mockReset();
  cache.refresh.mockReset();
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('addProvider: what it hands scheduling.addProvider', () => {
  it('the texts trimmed, the kind as sent, the hue a number; one provider.created row of ids; the page refreshed', async () => {
    const result = await addProvider(
      CLINIC,
      sent({
        name: '  Mira Testova ',
        shortName: ' Dr. Testova  ',
        kind: 'hygienist',
        chairLabel: ' Chair 4 ',
        colorHue: '37',
      }),
    );
    expect(result).toEqual({ ok: true, value: { id: ADDED } });
    expect(scheduling.addProvider).toHaveBeenCalledExactlyOnceWith(
      TX,
      {
        name: 'Mira Testova',
        shortName: 'Dr. Testova',
        kind: 'hygienist',
        chairLabel: 'Chair 4',
        colorHue: 37,
      },
      expect.any(Date),
    );
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, {
      at: expect.any(Date),
      actorType: 'user',
      actorId: USER,
      action: 'provider.created',
      entityType: 'provider',
      entityId: ADDED,
      // None given: the audit module stores {} (tests/integration/providers-settings.test.ts).
      metadata: undefined,
    });
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it.each(['0', '359', '7', '200'])('the hue "%s": taken', async (colorHue) => {
    expect(await addProvider(CLINIC, sent({ colorHue }))).toMatchObject({ ok: true });
    expect(scheduling.addProvider).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ colorHue: Number(colorHue) }),
      expect.any(Date),
    );
  });

  it('every kind the select offers: taken', async () => {
    for (const kind of ['dentist', 'hygienist', 'other']) {
      expect(await addProvider(CLINIC, sent({ kind })), kind).toMatchObject({ ok: true });
    }
    expect(scheduling.addProvider).toHaveBeenCalledTimes(3);
  });

  it('a short name of 12 characters, a name and a chair of 100: taken', async () => {
    expect(
      await addProvider(
        CLINIC,
        sent({ name: 'n'.repeat(100), shortName: 's'.repeat(12), chairLabel: 'c'.repeat(100) }),
      ),
    ).toMatchObject({ ok: true });
  });
});

describe('addProvider: what the input alone settles is refused at its field, before any transaction (D-098)', () => {
  it.each([
    { what: 'an empty name', fields: { name: '' }, path: 'name', code: 'too_small' },
    { what: 'a name of blanks', fields: { name: '   ' }, path: 'name', code: 'too_small' },
    {
      what: 'a name of 101 characters',
      fields: { name: 'n'.repeat(101) },
      path: 'name',
      code: 'too_big',
    },
    { what: 'no name sent', fields: { name: undefined }, path: 'name', code: 'invalid_type' },
    {
      what: 'an empty short name',
      fields: { shortName: '' },
      path: 'shortName',
      code: 'too_small',
    },
    {
      what: 'a short name of 13 characters',
      fields: { shortName: 's'.repeat(13) },
      path: 'shortName',
      code: 'too_big',
    },
    { what: 'an empty chair', fields: { chairLabel: ' ' }, path: 'chairLabel', code: 'too_small' },
    {
      what: 'a chair of 101 characters',
      fields: { chairLabel: 'c'.repeat(101) },
      path: 'chairLabel',
      code: 'too_big',
    },
    {
      what: 'a kind the select does not offer',
      fields: { kind: 'surgeon' },
      path: 'kind',
      code: 'invalid_value',
    },
    {
      what: 'a kind in capitals',
      fields: { kind: 'Dentist' },
      path: 'kind',
      code: 'invalid_value',
    },
    { what: 'a hue of 360', fields: { colorHue: '360' }, path: 'colorHue', code: 'too_big' },
    { what: 'a hue of 999', fields: { colorHue: '999' }, path: 'colorHue', code: 'too_big' },
    {
      what: 'a negative hue',
      fields: { colorHue: '-1' },
      path: 'colorHue',
      code: 'invalid_format',
    },
    {
      what: 'a hue with decimals',
      fields: { colorHue: '12.5' },
      path: 'colorHue',
      code: 'invalid_format',
    },
    {
      what: 'a hue of letters',
      fields: { colorHue: 'abc' },
      path: 'colorHue',
      code: 'invalid_format',
    },
    { what: 'an empty hue', fields: { colorHue: '' }, path: 'colorHue', code: 'invalid_format' },
    {
      what: 'a hue of four digits',
      fields: { colorHue: '0200' },
      path: 'colorHue',
      code: 'invalid_format',
    },
    {
      what: 'a hue with blanks',
      fields: { colorHue: ' 20' },
      path: 'colorHue',
      code: 'invalid_format',
    },
    {
      what: 'no hue sent',
      fields: { colorHue: undefined },
      path: 'colorHue',
      code: 'invalid_type',
    },
  ])('$what: invalid_input at $path, nothing handed on', async ({ fields, path, code }) => {
    expect(await addProvider(CLINIC, sent(fields))).toEqual({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: [path], code }] },
    });
    expect(db.opened).toBe(0);
    expect(scheduling.addProvider).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('a name typed into the form is never in the answer', async () => {
    const result = await addProvider(CLINIC, sent({ name: 'MARKER-name', colorHue: '400' }));
    expect(JSON.stringify(result)).not.toContain('MARKER');
  });
});

describe('only settings.manage reads or adds (acceptance 5)', () => {
  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, before any transaction; nothing handed on',
    async (role) => {
      request.staff = staffAs(role);
      const forbidden = { ok: false, error: { code: 'forbidden' } };
      expect(await addProvider(CLINIC, sent())).toEqual(forbidden);
      expect(await readProviders(CLINIC, {})).toEqual(forbidden);
      expect(await readProviders.forPage({})).toEqual(forbidden);
      expect(scheduling.addProvider).not.toHaveBeenCalled();
      expect(scheduling.clinicProviders).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it("as the owner: the read hands back the module's providers, no audit row", async () => {
    const listed = [
      {
        id: ADDED,
        name: 'Mira Testova',
        shortName: 'Dr. Testova',
        kind: 'dentist',
        chairLabel: 'Chair 4',
        colorHue: 200,
        active: true,
      },
    ];
    scheduling.clinicProviders.mockResolvedValue(listed);
    expect(await readProviders.forPage({})).toEqual({ ok: true, value: listed });
    expect(scheduling.clinicProviders).toHaveBeenCalledExactlyOnceWith(TX);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

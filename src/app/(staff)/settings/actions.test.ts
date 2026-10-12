import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { logger } from '@/lib/logger';
import { readClinicSettings, saveClinicDetails } from './actions';

// E01-T08a, acceptance 1 and 2 (the form's side): what the Settings actions take from the Clinic
// tab's form and hand the tenancy module, what they answer, and the audit row they ask for. They are
// the real wrapper-made actions with the real checks (tenancy.newClinicProblems(), the phone read);
// only who is asking (currentStaff), the transaction, the audit log, next/cache and the tenancy
// module's database functions are stand-ins, as no database or Next.js runs here. The module's work
// against real rows is in tests/integration/clinic-settings.test.ts. Every value is synthetic: the
// seed's made-up phone block (+389 70 00x xxx), Ofcom's range for drama in London (020 7946 0xxx),
// example.test.

const CLINIC = '01970000-0000-7000-8000-0000000000d1';
const USER = '01970000-0000-7000-8000-0000000000d2';
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

const tenancy = vi.hoisted(() => ({
  saveClinicDetails: vi.fn(),
  clinicDetails: vi.fn(),
  clinicTimeZones: vi.fn(),
}));
vi.mock('@/modules/tenancy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/tenancy')>()),
  ...tenancy,
}));

const cache = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/cache', () => cache);

function owner(): Staff {
  return {
    user: { id: USER, name: 'Owner', email: 'owner-settings@example.test' },
    clinic: {
      membershipId: '01970000-0000-7000-8000-0000000000d3',
      clinicId: CLINIC,
      clinicName: 'Test clinic (synthetic)',
      role: 'owner',
      extraPermissions: [],
      providerKind: null,
    },
    clinicCount: 1,
  };
}

/** The form's data: every field, as the browser sends it, with those given in place of these. */
function sent(fields: Record<string, string | undefined> = {}): FormData {
  const all: Record<string, string | undefined> = {
    name: 'Lakeside Dental',
    phone: '070 001 234',
    address: 'Ulica 1, Skopje',
    email: 'desk@example.test',
    timeZone: 'Europe/Skopje',
    locale: 'en',
    currency: 'MKD',
    country: 'MK',
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) {
    if (value !== undefined) data.append(name, value);
  }
  return data;
}

beforeEach(() => {
  request.staff = owner();
  db.opened = 0;
  audit.record.mockClear();
  tenancy.saveClinicDetails.mockReset();
  tenancy.saveClinicDetails.mockResolvedValue({ ok: true, changed: ['name'] });
  cache.refresh.mockReset();
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveClinicDetails: what it hands tenancy.saveClinicDetails', () => {
  it("the name trimmed, the phone read with the form's country into E.164, the email lower-cased", async () => {
    const result = await saveClinicDetails(
      CLINIC,
      sent({ name: '  Lakeside Dental ', phone: '070 001 234', email: ' Desk@Example.TEST ' }),
    );
    expect(result).toEqual({ ok: true, value: { changes: { fields: ['name'] } } });
    expect(tenancy.saveClinicDetails).toHaveBeenCalledExactlyOnceWith(
      TX,
      {
        name: 'Lakeside Dental',
        phone: '+38970001234',
        address: 'Ulica 1, Skopje',
        email: 'desk@example.test',
        timeZone: 'Europe/Skopje',
        locale: 'en',
        currency: 'MKD',
        country: 'MK',
      },
      expect.any(Date),
    );
  });

  it('the phone in any form of the same number: one E.164', async () => {
    for (const phone of ['+389 70 001 234', '00389 70 001 234', '‪070 001 234‬']) {
      tenancy.saveClinicDetails.mockClear();
      await saveClinicDetails(CLINIC, sent({ phone }));
      expect(tenancy.saveClinicDetails, phone).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({ phone: '+38970001234' }),
        expect.any(Date),
      );
    }
  });

  it("read with the form's own phone country, not the stored one: +44 numbers in Britain", async () => {
    await saveClinicDetails(
      CLINIC,
      sent({ phone: '020 7946 0000', country: 'GB', timeZone: 'Europe/London' }),
    );
    expect(tenancy.saveClinicDetails).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ phone: '+442079460000', country: 'GB' }),
      expect.any(Date),
    );
  });

  it('optional fields left empty, blank or not sent: none (null), and no field problem', async () => {
    for (const data of [
      sent({ phone: '', address: '', email: '' }),
      sent({ phone: '  ', address: '   ', email: ' ' }),
      sent({ phone: undefined, address: undefined, email: undefined }),
    ]) {
      tenancy.saveClinicDetails.mockClear();
      expect(await saveClinicDetails(CLINIC, data)).toMatchObject({ ok: true });
      expect(tenancy.saveClinicDetails).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({ phone: null, address: null, email: null }),
        expect.any(Date),
      );
    }
  });

  it('a zone in another case, UTC and Europe/Kyiv go to the module as sent: it spells them', async () => {
    for (const timeZone of ['europe/skopje', 'UTC', 'Europe/Kyiv', 'Europe/Kiev']) {
      tenancy.saveClinicDetails.mockClear();
      expect(await saveClinicDetails(CLINIC, sent({ timeZone })), timeZone).toMatchObject({
        ok: true,
      });
      expect(tenancy.saveClinicDetails).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({ timeZone }),
        expect.any(Date),
      );
    }
  });
});

describe('saveClinicDetails: what the input alone settles is refused at its field, before any transaction (D-098)', () => {
  it.each([
    { what: 'an empty name', fields: { name: '' }, path: 'name', code: 'custom' },
    { what: 'a name of blanks', fields: { name: '   ' }, path: 'name', code: 'custom' },
    {
      what: 'a name of 201 characters',
      fields: { name: 'L'.repeat(201) },
      path: 'name',
      code: 'too_big',
    },
    {
      what: 'an impossible phone: a digit missing',
      fields: { phone: '070 001 23' },
      path: 'phone',
      code: 'invalid_format',
    },
    {
      what: 'an impossible phone: letters',
      fields: { phone: '070 abc 234' },
      path: 'phone',
      code: 'invalid_format',
    },
    {
      what: 'a phone of 41 characters',
      fields: { phone: '0'.repeat(41) },
      path: 'phone',
      code: 'too_big',
    },
    {
      what: 'an address of 501 characters',
      fields: { address: 'a'.repeat(501) },
      path: 'address',
      code: 'too_big',
    },
    {
      what: 'an email that is no email',
      fields: { email: 'desk.example.test' },
      path: 'email',
      code: 'invalid_format',
    },
    {
      what: 'an offset for a zone',
      fields: { timeZone: '+01:00' },
      path: 'timeZone',
      code: 'custom',
    },
    { what: 'a fixed zone', fields: { timeZone: 'Etc/GMT-1' }, path: 'timeZone', code: 'custom' },
    {
      what: 'a zone nobody knows',
      fields: { timeZone: 'Mars/Olympus' },
      path: 'timeZone',
      code: 'custom',
    },
    { what: 'a language without texts', fields: { locale: 'mk' }, path: 'locale', code: 'custom' },
    { what: 'a language in capitals', fields: { locale: 'EN' }, path: 'locale', code: 'custom' },
    {
      what: 'a currency in lower case',
      fields: { currency: 'mkd' },
      path: 'currency',
      code: 'custom',
    },
    {
      what: 'a currency of two letters',
      fields: { currency: 'MK' },
      path: 'currency',
      code: 'custom',
    },
    {
      what: 'a currency of four letters',
      fields: { currency: 'MKDD' },
      path: 'currency',
      code: 'custom',
    },
    {
      what: 'a phone country the package does not support',
      fields: { country: 'UK' },
      path: 'country',
      code: 'custom',
    },
    {
      what: 'a phone country in lower case',
      fields: { country: 'mk' },
      path: 'country',
      code: 'custom',
    },
  ])('$what: invalid_input at $path, nothing handed on', async ({ fields, path, code }) => {
    expect(await saveClinicDetails(CLINIC, sent(fields))).toEqual({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: [path], code }] },
    });
    expect(db.opened).toBe(0);
    expect(tenancy.saveClinicDetails).not.toHaveBeenCalled();
  });

  it('every problem at once, each at its field', async () => {
    const result = await saveClinicDetails(
      CLINIC,
      sent({
        name: '',
        phone: '070 001 23',
        email: 'desk',
        timeZone: '+01:00',
        locale: 'fr',
        currency: 'denar',
      }),
    );
    if (result.ok || !('issues' in result.error)) throw new Error('expected invalid_input');
    expect(result.error.issues.map((issue) => issue.path[0]).sort()).toEqual([
      'currency',
      'email',
      'locale',
      'name',
      'phone',
      'timeZone',
    ]);
    expect(db.opened).toBe(0);
  });

  it('a phone with a phone country the package does not support: the country alone is named, nothing thrown', async () => {
    expect(await saveClinicDetails(CLINIC, sent({ country: 'XX' }))).toEqual({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: ['country'], code: 'custom' }] },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a field not sent at all: invalid_input at it, never internal', async () => {
    for (const name of ['name', 'timeZone', 'locale', 'currency', 'country']) {
      expect(await saveClinicDetails(CLINIC, sent({ [name]: undefined })), name).toEqual({
        ok: false,
        error: { code: 'invalid_input', issues: [{ path: [name], code: 'invalid_type' }] },
      });
    }
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('saveClinicDetails: its answer, its audit row and the page rendered again', () => {
  it('done: one audit row clinic.updated about the clinic, naming the fields changed; the page refreshed', async () => {
    tenancy.saveClinicDetails.mockResolvedValue({ ok: true, changed: ['name', 'timeZone'] });
    expect(await saveClinicDetails(CLINIC, sent())).toEqual({
      ok: true,
      value: { changes: { fields: ['name', 'timeZone'] } },
    });
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, {
      at: expect.any(Date),
      actorType: 'user',
      actorId: USER,
      action: 'clinic.updated',
      entityType: 'clinic',
      entityId: CLINIC,
      metadata: { fields: ['name', 'timeZone'] },
    });
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('a save that changed nothing: still its one audit row, with no field named', async () => {
    tenancy.saveClinicDetails.mockResolvedValue({ ok: true, changed: [] });
    expect(await saveClinicDetails(CLINIC, sent())).toMatchObject({ ok: true });
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(
      TX,
      expect.objectContaining({ action: 'clinic.updated', metadata: { fields: [] } }),
    );
  });

  it('a zone the database does not know: time_zone_unknown, no audit row, no refresh', async () => {
    tenancy.saveClinicDetails.mockResolvedValue({ ok: false, code: 'time_zone_unknown' });
    expect(await saveClinicDetails(CLINIC, sent({ timeZone: 'Europe/Kiev' }))).toEqual({
      ok: false,
      error: { code: 'time_zone_unknown' },
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it('sent for another clinic than the request is in: clinic_changed, before any transaction', async () => {
    expect(await saveClinicDetails('01970000-0000-7000-8000-0000000000d9', sent())).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect(db.opened).toBe(0);
    expect(tenancy.saveClinicDetails).not.toHaveBeenCalled();
  });

  it('a clinic id among the fields is no input: the module is never given one', async () => {
    const data = sent();
    data.append('clinicId', '01970000-0000-7000-8000-0000000000d9');
    await saveClinicDetails(CLINIC, data);
    expect(tenancy.saveClinicDetails).toHaveBeenCalledWith(
      TX,
      expect.not.objectContaining({ clinicId: expect.anything() }),
      expect.any(Date),
    );
  });
});

describe("readClinicSettings: the page's read", () => {
  it('the details and the zones, as the module gives them, with no audit row', async () => {
    const details = {
      name: 'Lakeside Dental',
      phone: '+38970001234',
      address: null,
      email: null,
      timeZone: 'Europe/Skopje',
      locale: 'en',
      currency: 'MKD',
      country: 'MK',
    };
    tenancy.clinicDetails.mockResolvedValue(details);
    tenancy.clinicTimeZones.mockResolvedValue(['Europe/Skopje', 'UTC']);
    expect(await readClinicSettings.forPage({})).toEqual({
      ok: true,
      value: { details, timeZones: ['Europe/Skopje', 'UTC'] },
    });
    expect(tenancy.clinicDetails).toHaveBeenCalledWith(TX);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

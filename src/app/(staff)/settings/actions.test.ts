import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { logger } from '@/lib/logger';
import {
  addClosedDay,
  readClinicSettings,
  readClosedDays,
  readOpeningHours,
  removeClosedDay,
  saveClinicDetails,
  saveOpeningHours,
} from './actions';

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
  // E01-T08b: the Opening hours tab's read and save.
  openingHours: vi.fn(),
  saveOpeningHours: vi.fn(),
  // E01-T08c: the closed days' read, add and remove.
  closedDaysAhead: vi.fn(),
  addClosedDay: vi.fn(),
  removeClosedDay: vi.fn(),
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
  tenancy.saveOpeningHours.mockReset();
  tenancy.saveOpeningHours.mockResolvedValue({ changed: [1] });
  tenancy.openingHours.mockReset();
  tenancy.closedDaysAhead.mockReset();
  tenancy.addClosedDay.mockReset();
  tenancy.addClosedDay.mockResolvedValue({ ok: true });
  tenancy.removeClosedDay.mockReset();
  tenancy.removeClosedDay.mockResolvedValue({ ok: true });
  cache.refresh.mockReset();
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
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

// E01-T08b, acceptance 5 (the action's side): the Clinic tab shows the phone with its country code
// (D-111), so a phone country changed in the same save reads the same number; a number typed without
// its code is still read with the form's new country.
describe('saveClinicDetails: the phone as the page now shows it, with its country code (E01-T08b)', () => {
  it('left as shown while the phone country changes: the same number goes to the module', async () => {
    await saveClinicDetails(
      CLINIC,
      sent({ phone: '+389 70 001 402', country: 'GB', timeZone: 'Europe/London' }),
    );
    expect(tenancy.saveClinicDetails).toHaveBeenCalledExactlyOnceWith(
      TX,
      expect.objectContaining({ phone: '+38970001402', country: 'GB' }),
      expect.any(Date),
    );
  });

  it('typed without its code: read with the new phone country', async () => {
    await saveClinicDetails(CLINIC, sent({ phone: '020 7946 0001', country: 'GB' }));
    expect(tenancy.saveClinicDetails).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ phone: '+442079460001', country: 'GB' }),
      expect.any(Date),
    );
  });
});

// E01-T08b, acceptance 1 and 2 (the form's side): what saveOpeningHours takes from the Opening hours
// tab and hands tenancy.saveOpeningHours, what it refuses at which field before any transaction, and
// the audit row it asks for. The module's work against real rows is in
// tests/integration/opening-hours.test.ts.

const WORKING_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

/**
 * The tab's data as the browser sends it: Monday to Friday open 08:00–18:00, the weekend closed (its
 * selects disabled, so not sent), with these fields in place of those, or left out when undefined.
 */
function hoursSent(fields: Record<string, string | undefined> = {}): FormData {
  const all: Record<string, string | undefined> = {};
  for (const day of WORKING_WEEK) {
    all[`${day}Open`] = 'on';
    all[`${day}Opens`] = '08:00';
    all[`${day}Closes`] = '18:00';
  }
  Object.assign(all, fields);
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) {
    if (value !== undefined) data.append(name, value);
  }
  return data;
}

const WEEKDAYS_8_TO_18 = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: 480, closes: 1080 }));

describe('saveOpeningHours: what it hands tenancy.saveOpeningHours', () => {
  it('each open weekday, Monday first, its times in minutes from midnight; a closed one not at all', async () => {
    expect(await saveOpeningHours(CLINIC, hoursSent())).toEqual({
      ok: true,
      value: { changes: { weekdays: [1] } },
    });
    expect(tenancy.saveOpeningHours).toHaveBeenCalledExactlyOnceWith(
      TX,
      WEEKDAYS_8_TO_18,
      expect.any(Date),
    );
  });

  it('a weekday switched off: closed, whatever its selects sent', async () => {
    await saveOpeningHours(
      CLINIC,
      hoursSent({ fridayOpen: undefined, fridayOpens: '', fridayCloses: 'not a time' }),
    );
    expect(tenancy.saveOpeningHours).toHaveBeenCalledWith(
      TX,
      WEEKDAYS_8_TO_18.slice(0, 4),
      expect.any(Date),
    );
  });

  it('a time off the 15-minute steps, as a stored one is offered, and the end of the day', async () => {
    await saveOpeningHours(
      CLINIC,
      hoursSent({
        mondayOpens: '08:10',
        tuesdayOpens: '08:10:30',
        wednesdayCloses: '24:00',
        sundayOpen: 'on',
        sundayOpens: '00:00',
        sundayCloses: '23:45',
      }),
    );
    expect(tenancy.saveOpeningHours).toHaveBeenCalledWith(
      TX,
      [
        { weekday: 1, opens: 490, closes: 1080 },
        { weekday: 2, opens: 490.5, closes: 1080 },
        { weekday: 3, opens: 480, closes: 1440 },
        { weekday: 4, opens: 480, closes: 1080 },
        { weekday: 5, opens: 480, closes: 1080 },
        { weekday: 7, opens: 0, closes: 1425 },
      ],
      expect.any(Date),
    );
  });

  it('every weekday closed: an empty week', async () => {
    const closed = Object.fromEntries(WORKING_WEEK.map((day) => [`${day}Open`, undefined]));
    await saveOpeningHours(CLINIC, hoursSent(closed));
    expect(tenancy.saveOpeningHours).toHaveBeenCalledWith(TX, [], expect.any(Date));
  });
});

describe('saveOpeningHours: what the input alone settles is refused at its field, before any transaction (D-098)', () => {
  it.each([
    { what: 'an open weekday with no opening', fields: { mondayOpens: '' }, path: 'mondayOpens' },
    {
      what: 'an open weekday whose opening was not sent',
      fields: { mondayOpens: undefined },
      path: 'mondayOpens',
    },
    {
      what: 'an open weekday with no closing',
      fields: { tuesdayCloses: '' },
      path: 'tuesdayCloses',
    },
    {
      what: 'a weekday switched on with neither time',
      fields: { saturdayOpen: 'on' },
      path: 'saturdayOpens',
    },
    {
      what: 'closing at its opening',
      fields: { wednesdayOpens: '09:00', wednesdayCloses: '09:00' },
      path: 'wednesdayCloses',
    },
    {
      what: 'closing before its opening',
      fields: { thursdayOpens: '18:00', thursdayCloses: '08:00' },
      path: 'thursdayCloses',
    },
    {
      what: 'opening at the end of the day',
      fields: { fridayOpens: '24:00', fridayCloses: '24:00' },
      path: 'fridayCloses',
    },
  ])('$what: invalid_input at $path, nothing handed on', async ({ fields, path }) => {
    const result = await saveOpeningHours(CLINIC, hoursSent(fields));
    if (result.ok || !('issues' in result.error)) throw new Error('expected invalid_input');
    expect(result.error.issues[0]?.path).toEqual([path]);
    expect(db.opened).toBe(0);
    expect(tenancy.saveOpeningHours).not.toHaveBeenCalled();
  });

  it.each(['8:00', '25:00', '08:60', 'noon', '08:00 '])(
    'a time %j that is no time of the day: invalid_format at its field',
    async (time) => {
      expect(await saveOpeningHours(CLINIC, hoursSent({ mondayOpens: time }))).toEqual({
        ok: false,
        error: {
          code: 'invalid_input',
          issues: [{ path: ['mondayOpens'], code: 'invalid_format' }],
        },
      });
      expect(db.opened).toBe(0);
    },
  );

  it('a switch sent with anything but "on": at the switch', async () => {
    const result = await saveOpeningHours(CLINIC, hoursSent({ mondayOpen: 'off' }));
    if (result.ok || !('issues' in result.error)) throw new Error('expected invalid_input');
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['mondayOpen']]);
    expect(tenancy.saveOpeningHours).not.toHaveBeenCalled();
  });

  it('a field sent twice: at that field, never internal', async () => {
    const data = hoursSent();
    data.append('mondayOpen', 'on');
    const result = await saveOpeningHours(CLINIC, data);
    if (result.ok || !('issues' in result.error)) throw new Error('expected invalid_input');
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['mondayOpen']]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('every problem at once, each at its field', async () => {
    const result = await saveOpeningHours(
      CLINIC,
      hoursSent({
        mondayOpens: '',
        tuesdayCloses: '07:00',
        wednesdayOpens: 'noon',
        sundayOpen: 'on',
        sundayOpens: '10:00',
      }),
    );
    if (result.ok || !('issues' in result.error)) throw new Error('expected invalid_input');
    expect(result.error.issues).toEqual([
      { path: ['mondayOpens'], code: 'custom' },
      { path: ['tuesdayCloses'], code: 'custom' },
      { path: ['wednesdayOpens'], code: 'invalid_format' },
      { path: ['sundayCloses'], code: 'custom' },
    ]);
    expect(db.opened).toBe(0);
  });
});

describe('saveOpeningHours: its answer, its audit row and the page rendered again', () => {
  it('done: one audit row clinic.hours_updated about the clinic, naming the weekdays changed; the page refreshed', async () => {
    tenancy.saveOpeningHours.mockResolvedValue({ changed: [1, 3] });
    expect(await saveOpeningHours(CLINIC, hoursSent())).toEqual({
      ok: true,
      value: { changes: { weekdays: [1, 3] } },
    });
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, {
      at: expect.any(Date),
      actorType: 'user',
      actorId: USER,
      action: 'clinic.hours_updated',
      entityType: 'clinic',
      entityId: CLINIC,
      metadata: { weekdays: [1, 3] },
    });
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('a save that changed nothing: still its one audit row, with no weekday named', async () => {
    tenancy.saveOpeningHours.mockResolvedValue({ changed: [] });
    expect(await saveOpeningHours(CLINIC, hoursSent())).toMatchObject({ ok: true });
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(
      TX,
      expect.objectContaining({ action: 'clinic.hours_updated', metadata: { weekdays: [] } }),
    );
  });

  it('a refused input: no audit row, no refresh', async () => {
    await saveOpeningHours(CLINIC, hoursSent({ mondayOpens: '' }));
    expect(audit.record).not.toHaveBeenCalled();
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it('sent for another clinic than the request is in: clinic_changed, before any transaction', async () => {
    expect(await saveOpeningHours('01970000-0000-7000-8000-0000000000d9', hoursSent())).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect(db.opened).toBe(0);
    expect(tenancy.saveOpeningHours).not.toHaveBeenCalled();
  });

  it('a clinic id or a weekday among the fields is no input: the module gets the week alone', async () => {
    const data = hoursSent();
    data.append('clinicId', '01970000-0000-7000-8000-0000000000d9');
    data.append('weekday', '8');
    await saveOpeningHours(CLINIC, data);
    expect(tenancy.saveOpeningHours).toHaveBeenCalledWith(TX, WEEKDAYS_8_TO_18, expect.any(Date));
  });
});

describe("readOpeningHours: the page's read", () => {
  it('the hours as the module gives them, with no audit row', async () => {
    tenancy.openingHours.mockResolvedValue(WEEKDAYS_8_TO_18);
    expect(await readOpeningHours.forPage({})).toEqual({ ok: true, value: WEEKDAYS_8_TO_18 });
    expect(tenancy.openingHours).toHaveBeenCalledWith(TX);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

// E01-T08c, acceptance 1 and 5 (the actions' side): what the closed days' actions take from their
// forms and hand the tenancy module with the moment the wrapper read, what the input alone settles
// at its field before any transaction, the module's refusals as the forms get them, and the audit
// rows they ask for: the date, never the label. The module's work against real rows, in the clinic's
// zone, is in tests/integration/closed-days.test.ts.

/**
 * The add form's data as the browser sends it, with these fields in place of those, or left out when
 * undefined.
 */
function closedDaySent(fields: Record<string, string | undefined> = {}): FormData {
  const all: Record<string, string | undefined> = {
    date: '2026-12-25',
    label: 'Christmas Day',
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) {
    if (value !== undefined) data.append(name, value);
  }
  return data;
}

/** A Remove's data as the browser sends it: the date, hidden; or nothing when null. */
function removeSent(date: string | null = '2026-12-25'): FormData {
  const data = new FormData();
  if (date !== null) data.append('date', date);
  return data;
}

/** 22:00 on 14 October 2026 in New York: already the 15th in UTC. */
const NEW_YORK_EVENING = new Date('2026-10-15T02:00:00Z');

describe('addClosedDay: what it hands tenancy.addClosedDay', () => {
  it('the date as sent, the label trimmed, and the moment the wrapper read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NEW_YORK_EVENING);
    expect(await addClosedDay(CLINIC, closedDaySent({ label: '  Christmas Day ' }))).toEqual({
      ok: true,
      value: { date: '2026-12-25' },
    });
    expect(tenancy.addClosedDay).toHaveBeenCalledExactlyOnceWith(
      TX,
      { date: '2026-12-25', label: 'Christmas Day' },
      NEW_YORK_EVENING,
    );
  });

  it('a label of 100 characters once trimmed is taken', async () => {
    const label = 'L'.repeat(100);
    expect(await addClosedDay(CLINIC, closedDaySent({ label: ` ${label} ` }))).toMatchObject({
      ok: true,
    });
    expect(tenancy.addClosedDay).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ label }),
      expect.any(Date),
    );
  });

  it('0000-01-01, which isCalendarDay takes and PostgreSQL does not: handed on, for the module to refuse as past', async () => {
    tenancy.addClosedDay.mockResolvedValue({ ok: false, code: 'in_the_past' });
    expect(await addClosedDay(CLINIC, closedDaySent({ date: '0000-01-01' }))).toEqual({
      ok: false,
      error: { code: 'in_the_past' },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('addClosedDay: what the input alone settles is refused at its field, before any transaction (D-098)', () => {
  it.each([
    { what: 'an empty date', fields: { date: '' }, path: 'date', code: 'invalid_format' },
    { what: 'a date not sent', fields: { date: undefined }, path: 'date', code: 'invalid_type' },
    {
      what: 'a day the month lacks',
      fields: { date: '2026-02-30' },
      path: 'date',
      code: 'invalid_format',
    },
    {
      what: 'a date written another way',
      fields: { date: '25.12.2026' },
      path: 'date',
      code: 'invalid_format',
    },
    {
      what: 'a year of five digits',
      fields: { date: '20261-12-25' },
      path: 'date',
      code: 'invalid_format',
    },
    {
      what: 'a date with a time',
      fields: { date: '2026-12-25T00:00' },
      path: 'date',
      code: 'invalid_format',
    },
    { what: 'an empty label', fields: { label: '' }, path: 'label', code: 'too_small' },
    { what: 'a label of blanks', fields: { label: '   ' }, path: 'label', code: 'too_small' },
    { what: 'a label not sent', fields: { label: undefined }, path: 'label', code: 'invalid_type' },
    {
      what: 'a label of 101 characters',
      fields: { label: 'L'.repeat(101) },
      path: 'label',
      code: 'too_big',
    },
  ])('$what: invalid_input at $path, nothing handed on', async ({ fields, path, code }) => {
    expect(await addClosedDay(CLINIC, closedDaySent(fields))).toEqual({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: [path], code }] },
    });
    expect(db.opened).toBe(0);
    expect(tenancy.addClosedDay).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('both at once, each at its field', async () => {
    const result = await addClosedDay(CLINIC, closedDaySent({ date: '2026-13-01', label: '' }));
    if (result.ok || !('issues' in result.error)) throw new Error('expected invalid_input');
    expect(result.error.issues.map((issue) => issue.path[0])).toEqual(['date', 'label']);
    expect(db.opened).toBe(0);
  });

  it('a field sent twice: at that field, never internal', async () => {
    const data = closedDaySent();
    data.append('date', '2026-12-26');
    const result = await addClosedDay(CLINIC, data);
    if (result.ok || !('issues' in result.error)) throw new Error('expected invalid_input');
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['date']]);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('addClosedDay: its answer, its audit row and the page rendered again', () => {
  it('done: one audit row clinic.closed_day_added about the clinic, naming the date and never the label; the page refreshed', async () => {
    await addClosedDay(CLINIC, closedDaySent());
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, {
      at: expect.any(Date),
      actorType: 'user',
      actorId: USER,
      action: 'clinic.closed_day_added',
      entityType: 'clinic',
      entityId: CLINIC,
      metadata: { date: '2026-12-25' },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('Christmas');
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it.each(['already_closed', 'in_the_past'])(
    "the module's %s: the form gets that refusal, with no audit row and no refresh",
    async (code) => {
      tenancy.addClosedDay.mockResolvedValue({ ok: false, code });
      expect(await addClosedDay(CLINIC, closedDaySent())).toEqual({ ok: false, error: { code } });
      expect(audit.record).not.toHaveBeenCalled();
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it('sent for another clinic than the request is in: clinic_changed, before any transaction', async () => {
    expect(await addClosedDay('01970000-0000-7000-8000-0000000000d9', closedDaySent())).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect(db.opened).toBe(0);
    expect(tenancy.addClosedDay).not.toHaveBeenCalled();
  });

  it('a clinic id among the fields is no input: the module gets the date and the label alone', async () => {
    const data = closedDaySent();
    data.append('clinicId', '01970000-0000-7000-8000-0000000000d9');
    await addClosedDay(CLINIC, data);
    expect(tenancy.addClosedDay).toHaveBeenCalledWith(
      TX,
      { date: '2026-12-25', label: 'Christmas Day' },
      expect.any(Date),
    );
  });
});

describe('removeClosedDay: what it hands tenancy.removeClosedDay, and what it refuses', () => {
  it('the date as sent and the moment the wrapper read; done: one audit row clinic.closed_day_removed naming the date; the page refreshed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NEW_YORK_EVENING);
    expect(await removeClosedDay(CLINIC, removeSent('2026-10-14'))).toEqual({
      ok: true,
      value: { date: '2026-10-14' },
    });
    expect(tenancy.removeClosedDay).toHaveBeenCalledExactlyOnceWith(
      TX,
      '2026-10-14',
      NEW_YORK_EVENING,
    );
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, {
      at: NEW_YORK_EVENING,
      actorType: 'user',
      actorId: USER,
      action: 'clinic.closed_day_removed',
      entityType: 'clinic',
      entityId: CLINIC,
      metadata: { date: '2026-10-14' },
    });
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it.each(['not_closed', 'in_the_past'])(
    "the module's %s: the form gets that refusal, with no audit row and no refresh",
    async (code) => {
      tenancy.removeClosedDay.mockResolvedValue({ ok: false, code });
      expect(await removeClosedDay(CLINIC, removeSent())).toEqual({ ok: false, error: { code } });
      expect(audit.record).not.toHaveBeenCalled();
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it.each([
    { what: 'no date', date: '', code: 'invalid_format' },
    { what: 'a date not sent', date: null, code: 'invalid_type' },
    { what: 'a day the month lacks', date: '2027-02-29', code: 'invalid_format' },
    { what: 'a date written another way', date: '12/25/2026', code: 'invalid_format' },
  ])('$what: invalid_input at the date, before any transaction', async ({ date, code }) => {
    expect(await removeClosedDay(CLINIC, removeSent(date))).toEqual({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: ['date'], code }] },
    });
    expect(db.opened).toBe(0);
    expect(tenancy.removeClosedDay).not.toHaveBeenCalled();
  });

  it('sent for another clinic than the request is in: clinic_changed, before any transaction', async () => {
    expect(await removeClosedDay('01970000-0000-7000-8000-0000000000d9', removeSent())).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect(db.opened).toBe(0);
    expect(tenancy.removeClosedDay).not.toHaveBeenCalled();
  });
});

describe("readClosedDays: the page's read", () => {
  it('the days the module gives from the moment the wrapper read, with no audit row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NEW_YORK_EVENING);
    const days = [{ date: '2026-10-14', label: 'Closed for training' }];
    tenancy.closedDaysAhead.mockResolvedValue(days);
    expect(await readClosedDays.forPage({})).toEqual({ ok: true, value: days });
    expect(tenancy.closedDaysAhead).toHaveBeenCalledExactlyOnceWith(TX, NEW_YORK_EVENING);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

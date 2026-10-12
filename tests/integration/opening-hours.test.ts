import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentBlock, CalendarDayView } from '@/app/(staff)/calendar/day';
import { readDay } from '@/app/(staff)/calendar/read-day';
import {
  readClinicSettings,
  readOpeningHours,
  saveClinicDetails,
  saveOpeningHours,
} from '@/app/(staff)/settings/actions';
import { hoursFieldNames, weekValues } from '@/app/(staff)/settings/opening-hours';
import { closeDb } from '@/db/client';
import { withTenant, type TenantTransaction } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import { phoneWithCountryCode } from '@/modules/patients';
import * as tenancy from '@/modules/tenancy';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertClinicRefs, insertRow, type ClinicRefs } from './scheduling-fixtures';

// E01-T08b, acceptance 1 to 5: the Opening hours tab's save, as the app runs it: the real actions
// with a real session, the tenancy module in a tenant transaction, as the app role, under Row-Level
// Security; then the calendar's read of the day after it (no browser), and the Clinic tab's phone.
// Only next/headers, next/cache and next-intl's request functions are replaced, as there is no
// running Next.js. Rows are set up and inspected as the migration role. Every value is synthetic:
// role words, the seed's made-up phone block (+389 70 00x xxx), Ofcom's range for drama in London
// (020 7946 0xxx), example.test.

const PASSWORD = 'MARKER-pw-4d1b-correct';

// What the request carries: the session cookie, and the clinic picked earlier (D-062).
const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));

// Outside a server action refresh() throws; the saves call it when they are done.
const cache = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/cache', () => cache);

vi.mock('next-intl/server', () => ({
  getRequestConfig: (create: unknown) => create,
  getTranslations: () => Promise.resolve((key: string) => key),
}));

const admin = migratorPool();
let clinicA: string;
let clinicB: string;
/** Cookies: an owner of both clinics, and a dentist, a hygienist and a front desk of clinic A. */
const cookies = {} as Record<'owner' | 'dentist' | 'hygienist' | 'front_desk', string>;
let ownerId: string;

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.47.0.${nextAddress++}`;

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
type Day = (typeof DAYS)[number];
/** A weekday's hours as the form sends them, or null for closed. */
type Week = Partial<Record<Day, [string, string] | null>>;

/** Monday to Friday 08:00–18:00, the weekend closed: the seed's week. */
const WORKING_WEEK: Week = {
  monday: ['08:00', '18:00'],
  tuesday: ['08:00', '18:00'],
  wednesday: ['08:00', '18:00'],
  thursday: ['08:00', '18:00'],
  friday: ['08:00', '18:00'],
};

/**
 * The tab's data as the browser sends it: each open weekday's switch ("on") and its two times; a
 * closed weekday sends nothing (its selects are disabled). The week is WORKING_WEEK with these.
 */
function hoursForm(changes: Week = {}): FormData {
  const week = { ...WORKING_WEEK, ...changes };
  const data = new FormData();
  for (const day of DAYS) {
    const hours = week[day];
    if (!hours) continue;
    const names = hoursFieldNames(day);
    data.append(names.open, 'on');
    data.append(names.opens, hours[0]);
    data.append(names.closes, hours[1]);
  }
  return data;
}

/** The action as `role` of clinic A (the owner: of the clinic `clinicId`, picked). */
function as(role: keyof typeof cookies, clinicId = clinicA): void {
  request.cookie = cookies[role];
  request.clinic = clinicId;
}

/** Saves the week as the owner of clinic A; fails the test when the save was not done. */
async function savedHours(changes: Week = {}): Promise<number[]> {
  as('owner');
  const result = await saveOpeningHours(clinicA, hoursForm(changes));
  if (!result.ok) throw new Error(`not saved: ${result.error.code}`);
  return result.value.changes.weekdays;
}

interface HoursRow {
  weekday: number;
  opens: string;
  closes: string;
  updated_at: Date;
}

/** The clinic's clinic_hours rows, by weekday, as the migration role reads them. */
async function hoursOf(clinicId: string): Promise<HoursRow[]> {
  const { rows } = await admin.query<HoursRow>(
    'select weekday, opens, closes, updated_at from clinic_hours where clinic_id = $1 order by weekday',
    [clinicId],
  );
  return rows;
}

/** The rows as weekday → `opens–closes`, to compare at a glance. */
async function weekOf(clinicId: string): Promise<Record<number, string>> {
  return Object.fromEntries(
    (await hoursOf(clinicId)).map((row) => [row.weekday, `${row.opens}–${row.closes}`]),
  );
}

/** Sets the clinic's hours as the migration role: these weekdays, these times, no other row. */
async function setHours(clinicId: string, week: Record<number, [string, string]>): Promise<void> {
  await admin.query('delete from clinic_hours where clinic_id = $1', [clinicId]);
  for (const [weekday, [opens, closes]] of Object.entries(week)) {
    await insertRow(admin, 'clinic_hours', {
      id: newId(),
      clinic_id: clinicId,
      weekday: Number(weekday),
      opens,
      closes,
      updated_at: new Date('2026-01-05T08:00:00Z'),
    });
  }
}

const SEED_WEEK: Record<number, [string, string]> = {
  1: ['08:00', '18:00'],
  2: ['08:00', '18:00'],
  3: ['08:00', '18:00'],
  4: ['08:00', '18:00'],
  5: ['08:00', '18:00'],
};

/** The clinic's clinic.hours_updated rows, oldest first. */
async function hoursUpdatedRows(clinicId: string) {
  const { rows } = await admin.query(
    `select clinic_id, actor_type, actor_id, action, entity_type, entity_id, metadata
       from audit_log where clinic_id = $1 and action = 'clinic.hours_updated' order by at, id`,
    [clinicId],
  );
  return rows;
}

async function member(role: string, clinics: string[]): Promise<{ id: string; cookie: string }> {
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Owner', password: PASSWORD });
  for (const clinicId of clinics) await insertMembership(admin, { clinicId, userId: id, role });
  return { id, cookie: await signInCookie(email, PASSWORD, freshAddress()) };
}

beforeAll(async () => {
  [clinicA, clinicB] = [await insertClinic(admin), await insertClinic(admin)];
  const owner = await member('owner', [clinicA, clinicB]);
  ownerId = owner.id;
  cookies.owner = owner.cookie;
  for (const role of ['dentist', 'hygienist', 'front_desk'] as const) {
    cookies[role] = (await member(role, [clinicA])).cookie;
  }
  await setHours(clinicB, { 1: ['07:00', '15:00'], 6: ['09:00', '13:00'] });
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(async () => {
  cache.refresh.mockClear();
  await setHours(clinicA, SEED_WEEK);
});

describe("the owner's week is saved per weekday and audited, one row per save (acceptance 1)", () => {
  it('a row per open weekday, none for a closed one; only the weekdays changed are written, at the save’s moment', async () => {
    const before = new Date();
    const changed = await savedHours({
      wednesday: null,
      friday: ['09:00', '17:00'],
      saturday: ['09:00', '13:00'],
    });
    const after = new Date();
    expect(changed).toEqual([3, 5, 6]);
    expect(await weekOf(clinicA)).toEqual({
      1: '08:00:00–18:00:00',
      2: '08:00:00–18:00:00',
      4: '08:00:00–18:00:00',
      5: '09:00:00–17:00:00',
      6: '09:00:00–13:00:00',
    });
    for (const row of await hoursOf(clinicA)) {
      const at = row.updated_at.getTime();
      if (row.weekday === 5 || row.weekday === 6) {
        expect(at, `weekday ${row.weekday}`).toBeGreaterThanOrEqual(before.getTime());
        expect(at, `weekday ${row.weekday}`).toBeLessThanOrEqual(after.getTime());
      } else {
        expect(row.updated_at, `weekday ${row.weekday}`).toEqual(new Date('2026-01-05T08:00:00Z'));
      }
    }
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('each save writes one clinic.hours_updated row, by the owner, about the clinic, naming the weekdays changed and no time', async () => {
    const earlier = (await hoursUpdatedRows(clinicA)).length;
    await savedHours({ monday: ['07:30', '18:00'], sunday: ['10:00', '12:00'] });
    await savedHours({ monday: ['07:30', '18:00'], sunday: ['10:00', '12:00'] });
    const rows = await hoursUpdatedRows(clinicA);
    expect(rows.slice(earlier)).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'clinic.hours_updated',
        entity_type: 'clinic',
        entity_id: clinicA,
        metadata: { weekdays: [1, 7] },
      },
      expect.objectContaining({ action: 'clinic.hours_updated', metadata: { weekdays: [] } }),
    ]);
    const written = JSON.stringify(rows);
    for (const time of ['07:30', '10:00', '12:00', '18:00']) expect(written).not.toContain(time);
  });

  it('a weekday stored as 08:10 (and one as 08:10:30) is kept by a save that does not touch it', async () => {
    await setHours(clinicA, { ...SEED_WEEK, 1: ['08:10', '18:00'], 3: ['08:10:30', '17:50'] });
    const rows = await hoursOf(clinicA);
    // The page's values, sent back as the browser shows them, with Tuesday changed alone.
    as('owner');
    const read = await readOpeningHours.forPage({});
    if (!read.ok) throw new Error(`not read: ${read.error.code}`);
    const shown = weekValues(read.value);
    expect(shown.filter((day) => day.open).map((day) => [day.key, day.opens, day.closes])).toEqual([
      ['monday', '08:10', '18:00'],
      ['tuesday', '08:00', '18:00'],
      ['wednesday', '08:10:30', '17:50'],
      ['thursday', '08:00', '18:00'],
      ['friday', '08:00', '18:00'],
    ]);
    const week: Week = Object.fromEntries(
      shown.map((day) => [day.key, day.open ? [day.opens, day.closes] : null]),
    );
    expect(await savedHours({ ...week })).toEqual([]);
    expect(await hoursOf(clinicA)).toEqual(rows);
    expect(await savedHours({ ...week, tuesday: ['09:00', '18:00'] })).toEqual([2]);
    const after = await hoursOf(clinicA);
    expect(after.filter((row) => row.weekday !== 2)).toEqual(
      rows.filter((row) => row.weekday !== 2),
    );
    expect(after.find((row) => row.weekday === 1)?.opens).toBe('08:10:00');
    expect(after.find((row) => row.weekday === 3)?.opens).toBe('08:10:30');
  });

  it.each<{ what: string; changes: Week; field: string }>([
    {
      what: 'an open weekday without its opening',
      changes: { monday: ['', '18:00'] },
      field: 'mondayOpens',
    },
    {
      what: 'an open weekday without its closing',
      changes: { tuesday: ['08:00', ''] },
      field: 'tuesdayCloses',
    },
    {
      what: 'closing at its opening',
      changes: { wednesday: ['12:00', '12:00'] },
      field: 'wednesdayCloses',
    },
    {
      what: 'closing before its opening',
      changes: { saturday: ['13:00', '09:00'] },
      field: 'saturdayCloses',
    },
  ])(
    '$what: refused at $field, with nothing saved and no audit row',
    async ({ changes, field }) => {
      const [rows, audited] = [await hoursOf(clinicA), (await hoursUpdatedRows(clinicA)).length];
      as('owner');
      // Another weekday changed in the same save: nothing of it is saved either.
      const result = await saveOpeningHours(clinicA, hoursForm({ friday: null, ...changes }));
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      if (result.ok || !('issues' in result.error)) throw new Error('expected invalid_input');
      expect(result.error.issues.map((issue) => issue.path)).toEqual([[field]]);
      expect(await hoursOf(clinicA)).toEqual(rows);
      expect(await hoursUpdatedRows(clinicA)).toHaveLength(audited);
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it('hours the schema should have refused are an Error from the module, with nothing written', async () => {
    const rows = await hoursOf(clinicA);
    for (const week of [
      [{ weekday: 8, opens: 480, closes: 1080 }],
      [{ weekday: 1, opens: 600, closes: 600 }],
      [{ weekday: 1, opens: -15, closes: 600 }],
      [{ weekday: 1, opens: 480, closes: 1445 }],
      [
        { weekday: 2, opens: 480, closes: 1080 },
        { weekday: 2, opens: 540, closes: 1080 },
      ],
    ]) {
      await expect(
        withTenant(clinicA, (tx) => tenancy.saveOpeningHours(tx, week, new Date())),
        JSON.stringify(week),
      ).rejects.toThrow(Error);
    }
    expect(await hoursOf(clinicA)).toEqual(rows);
  });
});

describe('a dentist, a hygienist and the front desk cannot change the hours (acceptance 2)', () => {
  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, for the read and the save; the rows and the audit log as they were',
    async (role) => {
      const [rows, audited] = [await hoursOf(clinicA), (await hoursUpdatedRows(clinicA)).length];
      as(role);
      const forbidden = { ok: false, error: { code: 'forbidden' } };
      expect(await saveOpeningHours(clinicA, hoursForm({ monday: null }))).toEqual(forbidden);
      expect(await readOpeningHours(clinicA, {})).toEqual(forbidden);
      expect(await readOpeningHours.forPage({})).toEqual(forbidden);
      expect(await hoursOf(clinicA)).toEqual(rows);
      expect(await hoursUpdatedRows(clinicA)).toHaveLength(audited);
    },
  );
});

describe("a save changes its own clinic's hours only; two at once both succeed (acceptance 3)", () => {
  it('the other clinic of the same owner keeps its hours, and gets no audit row', async () => {
    const b = await hoursOf(clinicB);
    await savedHours({ monday: null, tuesday: ['06:00', '21:00'], saturday: ['09:00', '13:00'] });
    expect(await weekOf(clinicA)).toMatchObject({ 2: '06:00:00–21:00:00', 6: '09:00:00–13:00:00' });
    expect(await hoursOf(clinicB)).toEqual(b);
    expect(await hoursUpdatedRows(clinicB)).toEqual([]);
  });

  it("a clinic id among the form's fields is no input; sent with clinic B's id from clinic A: clinic_changed", async () => {
    const b = await hoursOf(clinicB);
    as('owner');
    const data = hoursForm({ monday: ['10:00', '14:00'] });
    for (const name of ['clinicId', 'clinic_id', 'id']) data.append(name, clinicB);
    expect(await saveOpeningHours(clinicA, data)).toMatchObject({ ok: true });
    expect((await weekOf(clinicA))[1]).toBe('10:00:00–14:00:00');
    expect(await hoursOf(clinicB)).toEqual(b);

    const a = await hoursOf(clinicA);
    as('owner', clinicA);
    expect(await saveOpeningHours(clinicB, hoursForm({ monday: null }))).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect([await hoursOf(clinicA), await hoursOf(clinicB)]).toEqual([a, b]);
  });

  // The clinic's row is locked while a save reads the hours, so of two saves at once the second waits
  // for the first, reads its rows, and names only what it changed itself. Without the lock it reads
  // the week as it was before the first commits: it inserts the Saturday the first has just inserted
  // (a unique violation, answered internal). The first is held open until the second is seen
  // waiting behind it, as in clinic-settings.test.ts.
  it('two saves at once: the second waits for the first, then names only its own change', async () => {
    const saturday = { weekday: 6, opens: 540, closes: 780 };
    const sunday = { weekday: 7, opens: 600, closes: 720 };
    const seedWeek = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: 480, closes: 1080 }));
    // The first opens on Saturday; the second, from a page that shows that, opens on Sunday too.
    const first = [...seedWeek, saturday];
    const second = [...seedWeek, saturday, sunday];

    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let firstPid = 0;
    let firstWritten = () => {};
    const written = new Promise<void>((resolve) => (firstWritten = resolve));
    const one = withTenant(clinicA, async (tx) => {
      firstPid = await backendPid(tx);
      const result = await tenancy.saveOpeningHours(tx, first, new Date('2026-10-12T09:00:00Z'));
      firstWritten();
      await held; // its transaction, and so the row's lock, stay open
      return result;
    });
    await Promise.race([written, one]);
    const two = withTenant(clinicA, (tx) =>
      tenancy.saveOpeningHours(tx, second, new Date('2026-10-12T09:00:01Z')),
    );
    try {
      for (let waited = 0; ; waited += 20) {
        const { rows } = await admin.query<{ n: number }>(
          'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
          [firstPid],
        );
        if (rows[0]!.n > 0) break;
        expect(waited, 'the second save never waited for the first').toBeLessThan(4000);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      release();
    }
    expect(await one).toEqual({ changed: [6] });
    expect(await two).toEqual({ changed: [7] });
    expect(await weekOf(clinicA)).toMatchObject({ 6: '09:00:00–13:00:00', 7: '10:00:00–12:00:00' });
  });
});

/** The id of the PostgreSQL server process behind the transaction's connection. */
async function backendPid(tx: TenantTransaction): Promise<number> {
  const { rows } = await tx.execute(sql`select pg_backend_pid() as pid`);
  return Number(rows[0]?.pid);
}

describe('Settings and the calendar together: the next read of the day shows what was saved (acceptance 4)', () => {
  const H = 60;
  const NOW = new Date('2026-10-30T10:00:00Z');
  let refs: ClinicRefs;
  /** Monday 2 November 2026, and the Wednesday after: Skopje is on winter time (UTC+1). */
  const MONDAY = '2026-11-02';
  const WEDNESDAY = '2026-11-04';
  const visits: Record<'monday' | 'wednesday', string> = { monday: '', wednesday: '' };

  async function visit(startsAt: string, minutes: number): Promise<string> {
    const id = newId();
    await admin.query(
      `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                                 source, created_by)
       values ($1, $2, $3, $4, 'Check-up', $5::timestamptz,
               $5::timestamptz + make_interval(mins => $6), 'staff', $7)`,
      [id, clinicA, refs.patientId, refs.providerId, startsAt, minutes, ownerId],
    );
    return id;
  }

  beforeAll(async () => {
    refs = await insertClinicRefs(admin, clinicA, ownerId);
    visits.monday = await visit('2026-11-02T09:00:00Z', 60); // 10:00–11:00 in Skopje
    visits.wednesday = await visit('2026-11-04T09:00:00Z', 60);
  });

  function day(asked: string): Promise<CalendarDayView> {
    return withTenant(clinicA, (tx) => readDay(tx, asked, NOW));
  }

  function shownVisit(view: CalendarDayView, id: string): AppointmentBlock {
    const found = view.columns
      .flatMap((column) => column.blocks)
      .find((block): block is AppointmentBlock => block.kind === 'appointment' && block.id === id);
    if (!found) throw new Error('the visit is not on the day');
    return found;
  }

  it('before: both days open 08:00–18:00, the visit 60 of 600 minutes', async () => {
    const monday = await day(MONDAY);
    expect(monday).toMatchObject({ closed: null, open: { from: 8 * H, to: 18 * H }, shaded: [] });
    expect(monday.columns.map((c) => c.percentBooked)).toEqual([10]);
  });

  it('a weekday closed and hours changed in Settings: closed, the shaded parts and % booked on the calendar', async () => {
    await savedHours({ monday: ['10:00', '16:00'], wednesday: null });
    const monday = await day(MONDAY);
    expect(monday).toMatchObject({
      closed: null,
      open: { from: 10 * H, to: 16 * H },
      grid: { from: 8 * H, to: 18 * H },
      shaded: [
        { from: 8 * H, to: 10 * H },
        { from: 16 * H, to: 18 * H },
      ],
    });
    // 60 minutes of 360.
    expect(monday.columns.map((c) => c.percentBooked)).toEqual([17]);
    const wednesday = await day(WEDNESDAY);
    expect(wednesday.closed).toEqual({ why: 'no_hours' });
    expect(wednesday.open).toBeNull();
    expect(wednesday.shaded).toEqual([wednesday.grid]);
    expect(wednesday.columns.map((c) => c.percentBooked)).toEqual([null]);
    expect(shownVisit(wednesday, visits.wednesday).from).toBe(10 * H); // still shown
  });

  it("a zone saved in the Clinic tab moves the day's appointments to the new zone's times, each keeping its moment", async () => {
    const before = shownVisit(await day(MONDAY), visits.monday);
    expect(before).toMatchObject({
      from: 10 * H,
      to: 11 * H,
      startsAt: '2026-11-02T09:00:00.000Z',
    });
    as('owner');
    const details = await readClinicSettings.forPage({});
    if (!details.ok) throw new Error(`not read: ${details.error.code}`);
    const form = new FormData();
    for (const [name, value] of Object.entries({
      ...details.value.details,
      timeZone: 'Europe/London',
    })) {
      form.append(name, value ?? '');
    }
    expect(await saveClinicDetails(clinicA, form)).toMatchObject({ ok: true });
    const after = shownVisit(await day(MONDAY), visits.monday);
    expect(after).toMatchObject({ from: 9 * H, to: 10 * H, startsAt: before.startsAt });
    expect(after.endsAt).toBe(before.endsAt);
    // Back to Skopje: the same visit at 10:00 again.
    form.set('timeZone', 'Europe/Skopje');
    expect(await saveClinicDetails(clinicA, form)).toMatchObject({ ok: true });
    expect(shownVisit(await day(MONDAY), visits.monday).from).toBe(10 * H);
  });
});

describe("the clinic's phone, shown with its country code (acceptance 5)", () => {
  /** The Clinic tab's data as the page fills it, with these fields in place of those. */
  async function clinicForm(fields: Record<string, string>): Promise<FormData> {
    as('owner');
    const read = await readClinicSettings.forPage({});
    if (!read.ok) throw new Error(`not read: ${read.error.code}`);
    const { details } = read.value;
    const shown: Record<string, string> = {
      name: details.name,
      // As the page gives the form its phone (page.tsx).
      phone: details.phone === null ? '' : phoneWithCountryCode(details.phone),
      address: details.address ?? '',
      email: details.email ?? '',
      timeZone: details.timeZone,
      locale: details.locale,
      currency: details.currency,
      country: details.country,
      ...fields,
    };
    const data = new FormData();
    for (const [name, value] of Object.entries(shown)) data.append(name, value);
    return data;
  }

  async function storedPhone(): Promise<{ phone: string | null; country: string }> {
    const { rows } = await admin.query<{ phone: string | null; country: string }>(
      'select phone, default_country as country from clinics where id = $1',
      [clinicA],
    );
    return rows[0]!;
  }

  it('with the phone country changed and the phone left as shown, the stored number stays', async () => {
    await admin.query(
      `update clinics set phone = '+38970001402', default_country = 'MK' where id = $1`,
      [clinicA],
    );
    const form = await clinicForm({ country: 'GB' });
    expect(form.get('phone')).toBe('+389 70 001 402');
    as('owner');
    expect(await saveClinicDetails(clinicA, form)).toMatchObject({ ok: true });
    expect(await storedPhone()).toEqual({ phone: '+38970001402', country: 'GB' });
  });

  it('a number typed without its code is read with the new country', async () => {
    await admin.query(
      `update clinics set phone = '+38970001402', default_country = 'MK' where id = $1`,
      [clinicA],
    );
    const form = await clinicForm({ country: 'GB', phone: '020 7946 0001' });
    as('owner');
    expect(await saveClinicDetails(clinicA, form)).toMatchObject({ ok: true });
    expect(await storedPhone()).toEqual({ phone: '+442079460001', country: 'GB' });
  });
});

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookAppointment, readCalendarDay } from '@/app/(staff)/calendar/actions';
import { bookingWarnings } from '@/app/(staff)/calendar/booking-warnings';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import type { CalendarDay } from '@/lib/calendar-day';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import * as patients from '@/modules/patients';
import * as scheduling from '@/modules/scheduling';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertRow, insertUser } from './scheduling-fixtures';

// E01-T05a, acceptance 4 to 7: booking an existing patient, as the app runs it: the scheduling and
// patients modules in a tenant transaction, as the app role, under Row-Level Security, and the real
// booking action with a real session (only next/headers and next/cache are replaced, as there is no
// running Next.js). Rows are set up and inspected as the migration role. Moments are written and read
// in UTC, and each case names its clinic's zone, so neither the computer's zone nor the database
// session's plays a part (D-099). Names are from the seed's invented lists; the assertions name ids.

const PASSWORD = 'MARKER-pw-05a1-correct';
const NOW = new Date('2026-10-13T08:00:00Z');
const H = 60;

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

// Outside a server action refresh() and revalidatePath() throw; the booking calls both when done.
const cache = vi.hoisted(() => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);

const admin = migratorPool();

/** One clinic's rows: its providers, treatment types and patients. */
interface Place {
  clinic: string;
  dentist: string;
  hygienist: string;
  inactiveProvider: string;
  checkup: string;
  filling: string;
  inactiveTreatment: string;
  ana: string;
  /** Another active patient: the one whose visit the clinic already had (existing()). */
  marko: string;
  archived: string;
  deceased: string;
}

let skopje: Place;
let newYork: Place;
let other: Place;
/** A clinic far ahead of UTC (the tester's, test-strategy.md "Hidden local time"). */
let auckland: Place;
/** Who books in the module's tests (a user without a login), and the signed-in front desk. */
let bookerId: string;
let frontDeskId: string;

async function clinicIn(timeZone: string): Promise<Place> {
  const clinic = await insertClinic(admin);
  await admin.query('update clinics set timezone = $2 where id = $1', [clinic, timeZone]);
  const provider = async (name: string, sort: number, active = true) => {
    const id = newId();
    await insertRow(admin, 'providers', {
      id,
      clinic_id: clinic,
      name,
      short_name: name.split(' ')[1] ?? name,
      kind: 'dentist',
      chair_label: `Chair ${sort}`,
      color_hue: 195,
      sort_order: sort,
      active,
    });
    return id;
  };
  const treatment = async (name: string, minutes: number, active = true) => {
    const id = newId();
    await insertRow(admin, 'treatment_types', {
      id,
      clinic_id: clinic,
      name,
      default_duration_min: minutes,
      active,
    });
    return id;
  };
  const patient = async (first: string, last: string, status = 'active') => {
    const id = newId();
    await insertRow(admin, 'patients', {
      id,
      clinic_id: clinic,
      first_name: first,
      last_name: last,
      language: 'en',
      status,
    });
    return id;
  };
  return {
    clinic,
    dentist: await provider('Elena Planinska', 1),
    hygienist: await provider('Mimoza Lumi', 2),
    inactiveProvider: await provider('Bojan Kamenov', 3, false),
    checkup: await treatment('Checkup', 30),
    filling: await treatment('Filling', 45),
    inactiveTreatment: await treatment('Whitening', 60, false),
    ana: await patient('Ana', 'Brezovska'),
    marko: await patient('Marko', 'Dardha'),
    archived: await patient('Ana', 'Planinska', 'archived'),
    deceased: await patient('Shpëtim', 'Lumi', 'deceased'),
  };
}

beforeAll(async () => {
  bookerId = await insertUser(admin);
  skopje = await clinicIn('Europe/Skopje');
  newYork = await clinicIn('America/New_York');
  other = await clinicIn('Europe/Skopje');
  auckland = await clinicIn('Pacific/Auckland');

  // The front desk of the four clinics, signed in once; each test picks its clinic.
  const email = testEmail();
  ({ id: frontDeskId } = await createStaffUser({ email, name: 'Front desk', password: PASSWORD }));
  for (const clinicId of [skopje.clinic, newYork.clinic, other.clinic, auckland.clinic]) {
    await insertMembership(admin, { clinicId, userId: frontDeskId, role: 'front_desk' });
  }
  request.cookie = await signInCookie(email, PASSWORD, '10.51.0.1');
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => {
  cache.refresh.mockClear();
  cache.revalidatePath.mockClear();
});

/** A booking in the clinic of `place`, of its dentist, its checkup and its active patient. */
function booking(place: Place, change: Partial<scheduling.NewBooking> = {}): scheduling.NewBooking {
  return {
    patientId: place.ana,
    providerId: place.dentist,
    treatmentTypeId: place.checkup,
    day: '2030-01-07',
    startMinute: 9 * H,
    lengthMinutes: 30,
    timeZone: place === newYork ? 'America/New_York' : 'Europe/Skopje',
    createdBy: bookerId,
    anyway: false,
    ...change,
  };
}

/** Books through the module, in the clinic's own transaction. */
function book(place: Place, change: Partial<scheduling.NewBooking> = {}) {
  return withTenant(place.clinic, (tx) =>
    scheduling.createAppointment(tx, booking(place, change), NOW),
  );
}

/** Books and gives the new id; fails the test when the booking is refused. */
async function booked(place: Place, change: Partial<scheduling.NewBooking> = {}): Promise<string> {
  const result = await book(place, change);
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result.id;
}

/** The stored row, as the migration role reads it. */
async function row(id: string): Promise<Record<string, unknown>> {
  const { rows } = await admin.query('select * from appointments where id = $1', [id]);
  if (!rows[0]) throw new Error('no such appointment');
  return rows[0] as Record<string, unknown>;
}

/** Its start and end, as ISO moments. */
async function moments(id: string): Promise<[string, string]> {
  const stored = await row(id);
  return [(stored.starts_at as Date).toISOString(), (stored.ends_at as Date).toISOString()];
}

async function count(query: string, ...values: unknown[]): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(query, values);
  return Number(rows[0]?.n);
}

/** The clinic's appointments and its appointment.created audit rows, to see that nothing is written. */
async function written(clinicId: string): Promise<[number, number]> {
  return [
    await count('select count(*) as n from appointments where clinic_id = $1', clinicId),
    await count(
      `select count(*) as n from audit_log where clinic_id = $1 and action = 'appointment.created'`,
      clinicId,
    ),
  ];
}

/**
 * An appointment written as the migration role: one the clinic already had, of another patient than
 * the one booked (Marko's), so a booking over it is an overlap, never the same booking again
 * (E01-T05b, `already_booked`); the same patient's is `patientId`.
 */
async function existing(
  place: Place,
  startsAt: string,
  minutes: number,
  fields: { status?: string; overlapOk?: boolean; providerId?: string; patientId?: string } = {},
): Promise<string> {
  const id = newId();
  await admin.query(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, overlap_ok, source, created_by)
     values ($1, $2, $3, $4, 'Checkup', $5::timestamptz, $5::timestamptz + make_interval(mins => $6),
             $7, $8, 'staff', $9)`,
    [
      id,
      place.clinic,
      fields.patientId ?? place.marko,
      fields.providerId ?? place.dentist,
      startsAt,
      minutes,
      fields.status ?? 'booked',
      fields.overlapOk ?? false,
      bookerId,
    ],
  );
  return id;
}

describe('the row as stored (acceptance 4)', () => {
  it('the patient, provider and treatment chosen, its name as title, booked by staff, no overlap_ok, created_by, both moments now', async () => {
    const id = await booked(skopje, {
      day: '2030-01-08',
      startMinute: 10 * H + 30,
      lengthMinutes: 45,
      treatmentTypeId: skopje.filling,
      providerId: skopje.hygienist,
    });
    expect(await row(id)).toMatchObject({
      clinic_id: skopje.clinic,
      patient_id: skopje.ana,
      provider_id: skopje.hygienist,
      treatment_type_id: skopje.filling,
      title: 'Filling',
      status: 'booked',
      source: 'staff',
      overlap_ok: false,
      note: '',
      confirmed_at: null,
      cancelled_at: null,
      completed_at: null,
      created_by: bookerId,
      created_at: NOW,
      updated_at: NOW,
    });
    // 10:30 on 8 January in Skopje, winter time (UTC+1), for 45 minutes.
    expect(await moments(id)).toEqual(['2030-01-08T09:30:00.000Z', '2030-01-08T10:15:00.000Z']);
  });

  it.each([
    {
      zone: 'Europe/Skopje',
      day: '2026-03-29',
      what: 'the day the clocks go forward',
      at: '07:00',
    },
    { zone: 'Europe/Skopje', day: '2026-03-30', what: 'the day after', at: '07:00' },
    { zone: 'Europe/Skopje', day: '2026-10-25', what: 'the day the clocks go back', at: '08:00' },
    { zone: 'Europe/Skopje', day: '2026-10-26', what: 'the day after', at: '08:00' },
    {
      zone: 'America/New_York',
      day: '2026-03-08',
      what: 'the day the clocks go forward',
      at: '13:00',
    },
    { zone: 'America/New_York', day: '2026-03-09', what: 'the day after', at: '13:00' },
    {
      zone: 'America/New_York',
      day: '2026-11-01',
      what: 'the day the clocks go back',
      at: '14:00',
    },
    { zone: 'America/New_York', day: '2026-11-02', what: 'the day after', at: '14:00' },
  ])(
    '$zone, $day, $what: 09:00 local is $at UTC, and 30 minutes long',
    async ({ zone, day, at }) => {
      const place = zone === 'America/New_York' ? newYork : skopje;
      const id = await booked(place, { day, startMinute: 9 * H });
      expect(await moments(id)).toEqual([
        new Date(`${day}T${at}:00Z`).toISOString(),
        new Date(new Date(`${day}T${at}:00Z`).getTime() + 30 * 60_000).toISOString(),
      ]);
    },
  );

  it('the calendar then shows it at the local time chosen, on those days too', async () => {
    const id = await booked(newYork, { day: '2026-11-01', startMinute: 11 * H });
    const view = await withTenant(newYork.clinic, (tx) =>
      scheduling.appointmentsOnDay(tx, '2026-11-01', 'America/New_York'),
    );
    expect(view.filter((found) => found.id === id).map((found) => found.startMinute)).toEqual([
      11 * H,
    ]);
  });

  it('a start the clocks skip is refused, start_skipped, with nothing written', async () => {
    const before = await written(skopje.clinic);
    // 02:30 on 29 March in Skopje and on 8 March in New York: the clocks go from 02:00 to 03:00.
    expect(await book(skopje, { day: '2026-03-29', startMinute: 2 * H + 30 })).toEqual({
      ok: false,
      code: 'start_skipped',
    });
    expect(await book(newYork, { day: '2026-03-08', startMinute: 2 * H + 30 })).toEqual({
      ok: false,
      code: 'start_skipped',
    });
    expect(await written(skopje.clinic)).toEqual(before);
  });

  it('a start that comes twice is the second, in standard time', async () => {
    // 02:30 on 25 October in Skopje comes at 00:30 UTC (summer time), then at 01:30 UTC.
    const inSkopje = await booked(skopje, { day: '2026-10-25', startMinute: 2 * H + 30 });
    expect((await moments(inSkopje))[0]).toBe('2026-10-25T01:30:00.000Z');
    // 01:30 on 1 November in New York comes at 05:30 UTC, then at 06:30 UTC.
    const inNewYork = await booked(newYork, { day: '2026-11-01', startMinute: 1 * H + 30 });
    expect((await moments(inNewYork))[0]).toBe('2026-11-01T06:30:00.000Z');
  });

  it('a visit that runs past midnight ends its length later, on the next day', async () => {
    const id = await booked(skopje, {
      day: '2030-01-09',
      startMinute: 23 * H + 30,
      lengthMinutes: 60,
    });
    expect(await moments(id)).toEqual(['2030-01-09T22:30:00.000Z', '2030-01-09T23:30:00.000Z']);
  });

  it('a value the schema should have refused is an Error, with nothing written', async () => {
    const before = await written(skopje.clinic);
    for (const change of [
      { day: '2030-02-30' },
      { startMinute: -15 },
      { startMinute: 24 * H },
      { startMinute: 9.5 },
      { lengthMinutes: 0 },
      { lengthMinutes: 12.5 },
    ]) {
      await expect(book(skopje, change)).rejects.toThrow(/cannot be stored/);
    }
    expect(await written(skopje.clinic)).toEqual(before);
  });
});

// The tester's (E01-T05a, test-strategy.md "Hidden local time"): a clinic far ahead of UTC, where a
// morning's moment falls on the UTC day before, through the module and through the action.
describe('a clinic in Pacific/Auckland, far ahead of UTC (tester)', () => {
  const inAuckland = { timeZone: 'Pacific/Auckland' } as const;

  it.each([
    { day: '2026-09-26', what: 'the day before the clocks go forward', at: '2026-09-25T21:00' },
    { day: '2026-09-27', what: 'the day the clocks go forward', at: '2026-09-26T20:00' },
    { day: '2026-09-28', what: 'the day after', at: '2026-09-27T20:00' },
    { day: '2026-04-05', what: 'the day the clocks go back', at: '2026-04-04T21:00' },
    { day: '2026-04-06', what: 'the day after', at: '2026-04-05T21:00' },
  ])('$day, $what: 09:00 local is $at UTC, on the UTC day before', async ({ day, at }) => {
    const id = await booked(auckland, { ...inAuckland, day, startMinute: 9 * H });
    const start = new Date(`${at}:00Z`);
    expect(await moments(id)).toEqual([
      start.toISOString(),
      new Date(start.getTime() + 30 * 60_000).toISOString(),
    ]);
  });

  it('the calendar shows it on its own day at the local time chosen, not on the UTC day', async () => {
    const id = await booked(auckland, { ...inAuckland, day: '2026-09-27', startMinute: 11 * H });
    const [onItsDay, onTheUtcDay] = await withTenant(auckland.clinic, async (tx) => [
      await scheduling.appointmentsOnDay(tx, '2026-09-27', 'Pacific/Auckland'),
      await scheduling.appointmentsOnDay(tx, '2026-09-26', 'Pacific/Auckland'),
    ]);
    expect(onItsDay.filter((found) => found.id === id).map((found) => found.startMinute)).toEqual([
      11 * H,
    ]);
    expect(onTheUtcDay.map((found) => found.id)).not.toContain(id);
  });

  it('a start the clocks skip is refused, with nothing written; one that comes twice is the second', async () => {
    const before = await written(auckland.clinic);
    // 02:30 on 27 September: the clocks go from 02:00 to 03:00.
    expect(
      await book(auckland, { ...inAuckland, day: '2026-09-27', startMinute: 2 * H + 30 }),
    ).toEqual({ ok: false, code: 'start_skipped' });
    expect(await written(auckland.clinic)).toEqual(before);
    // 02:30 on 5 April comes at 13:30 UTC (summer time), then at 14:30 UTC (standard time).
    const id = await booked(auckland, {
      ...inAuckland,
      day: '2026-04-05',
      startMinute: 2 * H + 30,
    });
    expect((await moments(id))[0]).toBe('2026-04-04T14:30:00.000Z');
  });

  it("the booking action books in the clinic's own zone", async () => {
    request.clinic = auckland.clinic;
    const result = await bookAppointment(
      auckland.clinic,
      form(auckland, { day: '2026-09-28', start: '08:15' }),
    );
    if (!result.ok) throw new Error(`refused: ${result.error.code}`);
    // 08:15 on 28 September in Auckland, summer time (UTC+13): 19:15 UTC the day before.
    expect(await moments(result.value.id)).toEqual([
      '2026-09-27T19:15:00.000Z',
      '2026-09-27T19:45:00.000Z',
    ]);
  });
});

// The tester's (E01-T05a): on a day of 23 hours a visit holds the chair for its real minutes.
describe('on the day the clocks go forward, a visit across the hour they skip (tester)', () => {
  it('01:30 for 60 minutes ends at 03:30: a booking at 03:00 or 03:15 overlaps it, one at 03:30 does not', async () => {
    // Skopje, 29 March 2026: 01:30 local is 00:30 UTC; 60 minutes on is 01:30 UTC, 03:30 local.
    await existing(skopje, '2026-03-29T00:30:00Z', 60, { providerId: skopje.hygienist });
    const hygienist = { providerId: skopje.hygienist, day: '2026-03-29' };
    expect(await book(skopje, { ...hygienist, startMinute: 3 * H })).toEqual({
      ok: false,
      code: 'overlap',
    });
    expect(await book(skopje, { ...hygienist, startMinute: 3 * H + 15 })).toEqual({
      ok: false,
      code: 'overlap',
    });
    const id = await booked(skopje, { ...hygienist, startMinute: 3 * H + 30 });
    expect((await moments(id))[0]).toBe('2026-03-29T01:30:00.000Z');
  });
});

describe('a time that overlaps another visit of the provider is refused (acceptance 5)', () => {
  // Each case on a day of its own in January 2031, Skopje winter time (UTC+1): 09:00 is 08:00 UTC.
  let nextDay = 1;
  const freshDay = (): CalendarDay => `2031-01-${String(nextDay++).padStart(2, '0')}`;

  it.each(['booked', 'confirmed', 'arrived', 'completed'])(
    'over a %s visit: overlap, with nothing written',
    async (status) => {
      const day = freshDay();
      await existing(skopje, `${day}T08:00:00Z`, 30, { status });
      const before = await written(skopje.clinic);
      // Over its end, over its start, inside it, around it, at the same time.
      for (const [start, length] of [
        [9 * H + 15, 30],
        [8 * H + 45, 30],
        [9 * H + 5, 10],
        [8 * H + 50, 60],
        [9 * H, 30],
      ] as const) {
        expect(await book(skopje, { day, startMinute: start, lengthMinutes: length })).toEqual({
          ok: false,
          code: 'overlap',
        });
      }
      expect(await written(skopje.clinic)).toEqual(before);
    },
  );

  it('over a visit booked anyway (overlap_ok), which the database itself lets through', async () => {
    const day = freshDay();
    await existing(skopje, `${day}T08:00:00Z`, 30, { overlapOk: true });
    expect(await book(skopje, { day, startMinute: 9 * H })).toEqual({ ok: false, code: 'overlap' });
  });

  it('back to back is no overlap: one ends at the minute the other starts', async () => {
    const day = freshDay();
    await existing(skopje, `${day}T08:00:00Z`, 30);
    await booked(skopje, { day, startMinute: 9 * H + 30 });
    await booked(skopje, { day, startMinute: 8 * H + 30 });
  });

  it.each(['cancelled', 'no_show'])('a %s visit frees its time', async (status) => {
    const day = freshDay();
    await existing(skopje, `${day}T08:00:00Z`, 30, { status });
    await booked(skopje, { day, startMinute: 9 * H });
  });

  it("another provider's visit at the same time is no overlap", async () => {
    const day = freshDay();
    await existing(skopje, `${day}T08:00:00Z`, 30, { providerId: skopje.hygienist });
    await booked(skopje, { day, startMinute: 9 * H });
  });

  it('of two bookings of the same time at once, one is booked and the other refused as an overlap', async () => {
    const day = freshDay();
    let firstBooked!: () => void;
    const firstIsIn = new Promise<void>((resolve) => {
      firstBooked = resolve;
    });
    // The first receptionist's transaction stays open after its booking while the second books.
    const first = withTenant(skopje.clinic, async (tx) => {
      const result = await scheduling.createAppointment(tx, booking(skopje, { day }), NOW);
      firstBooked();
      await tx.execute(sql`select pg_sleep(0.5)`);
      return result;
    });
    await firstIsIn;
    const startedAt = Date.now();
    const second = book(skopje, { day, startMinute: 9 * H + 15 });
    const [one, two] = await Promise.all([first, second]);
    expect(one.ok).toBe(true);
    // It waited for the first to be committed, then saw its visit: refused, never an error.
    expect(two).toEqual({ ok: false, code: 'overlap' });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
    expect(
      await count(
        `select count(*) as n from appointments
          where provider_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = $2::date`,
        skopje.dentist,
        day,
      ),
    ).toBe(1);
  });
});

describe('a provider or treatment that is not active or not the clinic’s is refused (acceptance 6)', () => {
  it.each([
    { what: 'an inactive provider', change: (p: Place) => ({ providerId: p.inactiveProvider }) },
    { what: "another clinic's provider", change: () => ({ providerId: other.dentist }) },
    { what: 'no provider by that id', change: () => ({ providerId: newId() }) },
  ])('$what: provider_not_bookable, nothing written', async ({ change }) => {
    const before = await written(skopje.clinic);
    expect(await book(skopje, { day: '2031-02-02', ...change(skopje) })).toEqual({
      ok: false,
      code: 'provider_not_bookable',
    });
    expect(await written(skopje.clinic)).toEqual(before);
  });

  it.each([
    {
      what: 'an inactive treatment type',
      change: (p: Place) => ({ treatmentTypeId: p.inactiveTreatment }),
    },
    { what: "another clinic's treatment type", change: () => ({ treatmentTypeId: other.checkup }) },
  ])('$what: treatment_not_bookable, nothing written', async ({ change }) => {
    const before = await written(skopje.clinic);
    expect(await book(skopje, { day: '2031-02-03', ...change(skopje) })).toEqual({
      ok: false,
      code: 'treatment_not_bookable',
    });
    expect(await written(skopje.clinic)).toEqual(before);
  });
});

describe('patients.patientStatus: what the booking action asks', () => {
  it("each of the clinic's patients by status; none of another clinic", async () => {
    const statuses = await withTenant(skopje.clinic, async (tx) => [
      await patients.patientStatus(tx, skopje.ana),
      await patients.patientStatus(tx, skopje.archived),
      await patients.patientStatus(tx, skopje.deceased),
      await patients.patientStatus(tx, other.ana),
      await patients.patientStatus(tx, newId()),
    ]);
    expect(statuses).toEqual(['active', 'archived', 'deceased', null, null]);
  });
});

describe("the clinic's active treatment types, as the calendar's read gives them", () => {
  it('active ones only, by name, none of another clinic', async () => {
    const types = await withTenant(skopje.clinic, (tx) => scheduling.activeTreatmentTypes(tx));
    expect(types).toEqual([
      { id: skopje.checkup, name: 'Checkup', minutes: 30 },
      { id: skopje.filling, name: 'Filling', minutes: 45 },
    ]);
  });

  it("the calendar's read carries them", async () => {
    request.clinic = skopje.clinic;
    const read = await readCalendarDay(skopje.clinic, { day: '2031-02-04' });
    if (!read.ok) throw new Error(`not read: ${read.error.code}`);
    expect(read.value.treatmentTypes.map((type) => type.id)).toEqual([
      skopje.checkup,
      skopje.filling,
    ]);
    // Each column says whether its provider takes bookings: the inactive one has no column that day.
    expect(read.value.view.columns.map((column) => [column.providerId, column.active])).toEqual([
      [skopje.dentist, true],
      [skopje.hygienist, true],
    ]);
  });
});

/** The booking form's data, as the browser sends it: every field, these in place of the defaults. */
function form(place: Place, fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  const all: Record<string, string> = {
    day: '2031-03-03',
    patientId: place.ana,
    treatmentTypeId: place.checkup,
    start: '09:00',
    length: '30',
    providerId: place.dentist,
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) data.append(name, value);
  return data;
}

describe('the booking action (acceptance 4, 5, 6)', () => {
  it('books, with one audit row appointment.created of ids only, and brings the day again', async () => {
    request.clinic = skopje.clinic;
    const before = await written(skopje.clinic);
    const result = await bookAppointment(
      skopje.clinic,
      form(skopje, {
        day: '2031-03-03',
        start: '10:15',
        length: '45',
        treatmentTypeId: skopje.filling,
      }),
    );
    if (!result.ok) throw new Error(`refused: ${result.error.code}`);
    const { id } = result.value;
    expect(result.value).toEqual({ id, providerId: skopje.dentist });
    expect(await written(skopje.clinic)).toEqual([before[0] + 1, before[1] + 1]);
    expect(await row(id)).toMatchObject({
      patient_id: skopje.ana,
      provider_id: skopje.dentist,
      treatment_type_id: skopje.filling,
      title: 'Filling',
      status: 'booked',
      source: 'staff',
      overlap_ok: false,
      created_by: frontDeskId,
    });
    // 10:15 on Monday 3 March 2031 in Skopje, winter time (UTC+1).
    expect(await moments(id)).toEqual(['2031-03-03T09:15:00.000Z', '2031-03-03T10:00:00.000Z']);
    const { rows } = await admin.query(
      `select actor_type, actor_id, action, entity_type, entity_id, metadata
         from audit_log where clinic_id = $1 and entity_id = $2`,
      [skopje.clinic, id],
    );
    expect(rows).toEqual([
      {
        actor_type: 'user',
        actor_id: frontDeskId,
        action: 'appointment.created',
        entity_type: 'appointment',
        entity_id: id,
        metadata: {},
      },
    ]);
    expect(cache.refresh).toHaveBeenCalledOnce();
    expect(cache.revalidatePath).toHaveBeenCalledExactlyOnceWith('/patients');
  });

  it('an overlap: overlap, with nothing written, and the day brought again (E01-T05b)', async () => {
    request.clinic = skopje.clinic;
    await existing(skopje, '2031-03-04T08:00:00Z', 30);
    const before = await written(skopje.clinic);
    expect(
      await bookAppointment(skopje.clinic, form(skopje, { day: '2031-03-04', start: '09:15' })),
    ).toEqual({ ok: false, error: { code: 'overlap' } });
    expect(await written(skopje.clinic)).toEqual(before);
    // E01-T05b: a visit the drawer did not show; the refused answer brings the day, so its warning
    // names it. E01-T05a brought it only after a booking.
    expect(cache.refresh).toHaveBeenCalledOnce();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    { what: 'an archived patient', patient: (p: Place) => p.archived },
    { what: 'a deceased patient', patient: (p: Place) => p.deceased },
    { what: "another clinic's patient", patient: () => other.ana },
    { what: 'no patient by that id', patient: () => newId() },
  ])('$what: patient_not_bookable, nothing written', async ({ patient }) => {
    request.clinic = skopje.clinic;
    const before = await written(skopje.clinic);
    expect(
      await bookAppointment(
        skopje.clinic,
        form(skopje, { day: '2031-03-05', patientId: patient(skopje) }),
      ),
    ).toEqual({ ok: false, error: { code: 'patient_not_bookable' } });
    expect(await written(skopje.clinic)).toEqual(before);
  });

  it.each([
    { field: 'providerId', value: (p: Place) => p.inactiveProvider, code: 'provider_not_bookable' },
    { field: 'providerId', value: () => other.dentist, code: 'provider_not_bookable' },
    {
      field: 'treatmentTypeId',
      value: (p: Place) => p.inactiveTreatment,
      code: 'treatment_not_bookable',
    },
    { field: 'treatmentTypeId', value: () => other.checkup, code: 'treatment_not_bookable' },
  ])('$field of $code: refused, nothing written', async ({ field, value, code }) => {
    request.clinic = skopje.clinic;
    const before = await written(skopje.clinic);
    expect(
      await bookAppointment(
        skopje.clinic,
        form(skopje, { day: '2031-03-06', [field]: value(skopje) }),
      ),
    ).toEqual({ ok: false, error: { code } });
    expect(await written(skopje.clinic)).toEqual(before);
  });

  it('a field not picked or sent wrong is the schema’s problem, at its field, before any transaction', async () => {
    request.clinic = skopje.clinic;
    const before = await written(skopje.clinic);
    const result = await bookAppointment(
      skopje.clinic,
      form(skopje, {
        patientId: '',
        treatmentTypeId: '',
        start: '24:00',
        length: '0',
        day: '2031-02-30',
      }),
    );
    if (result.ok || result.error.code !== 'invalid_input' || !('issues' in result.error)) {
      throw new Error('expected invalid_input');
    }
    expect(result.error.issues.map((issue) => issue.path[0]).sort()).toEqual(
      ['day', 'length', 'patientId', 'start', 'treatmentTypeId'].sort(),
    );
    expect(await written(skopje.clinic)).toEqual(before);
  });

  it("sent with clinic A's id while the request is in clinic B: clinic_changed, nothing written in either", async () => {
    request.clinic = other.clinic;
    const counts = async () => [
      ...(await written(skopje.clinic)),
      ...(await written(other.clinic)),
    ];
    const before = await counts();
    expect(await bookAppointment(skopje.clinic, form(skopje, { day: '2031-03-07' }))).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect(await counts()).toEqual(before);
  });

  it("a clinic's ids sent to another clinic book nothing in either", async () => {
    // In clinic B's request, clinic A's patient, provider and treatment: none of them is B's.
    request.clinic = other.clinic;
    const counts = async () => [
      ...(await written(skopje.clinic)),
      ...(await written(other.clinic)),
    ];
    const before = await counts();
    const result = await bookAppointment(other.clinic, form(skopje, { day: '2031-03-10' }));
    expect(result).toEqual({ ok: false, error: { code: 'patient_not_bookable' } });
    expect(await counts()).toEqual(before);
  });
});

// E01-T05b: Book anyway (D-020) and one booking per click, through the module and through the action.
// Each case on a day of its own, June 2031 for the module and July 2031 for the action, in Skopje's
// summer time (UTC+2): 09:00 local is 07:00 UTC.

/** The dentist's visits on the day, as stored: whose, the local start in Skopje, overlap_ok, by start. */
async function dentistsDay(
  place: Place,
  day: CalendarDay,
): Promise<{ patient: string; starts: string; overlap_ok: boolean }[]> {
  const { rows } = await admin.query<{ patient: string; starts: string; overlap_ok: boolean }>(
    `select patient_id as patient, overlap_ok,
            to_char(starts_at at time zone 'Europe/Skopje', 'HH24:MI') as starts
       from appointments
      where provider_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = $2::date
      order by starts_at, id`,
    [place.dentist, day],
  );
  return rows;
}

/**
 * Books in a transaction that stays open half a second after its booking, as a first receptionist's
 * would while a second books: `booked` resolves once its booking is in, the result once it commits.
 */
function bookAndHold(
  place: Place,
  change: Partial<scheduling.NewBooking>,
): { booked: Promise<void>; result: Promise<scheduling.BookingResult> } {
  let signal!: () => void;
  const booked = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const result = withTenant(place.clinic, async (tx) => {
    const answer = await scheduling.createAppointment(tx, booking(place, change), NOW);
    signal();
    await tx.execute(sql`select pg_sleep(0.5)`);
    return answer;
  });
  return { booked, result };
}

describe('Book anyway: overlap_ok true only over a real overlap (E01-T05b, acceptance 1)', () => {
  let nextDay = 1;
  const freshDay = (): CalendarDay => `2031-06-${String(nextDay++).padStart(2, '0')}`;

  it('with "anyway", a time over another visit is booked with overlap_ok true, and both are kept', async () => {
    const day = freshDay();
    await existing(skopje, `${day}T07:00:00Z`, 30);
    const id = await booked(skopje, { day, startMinute: 9 * H + 15, anyway: true });
    expect(await row(id)).toMatchObject({
      overlap_ok: true,
      status: 'booked',
      patient_id: skopje.ana,
    });
    expect(await dentistsDay(skopje, day)).toEqual([
      { patient: skopje.marko, starts: '09:00', overlap_ok: false },
      { patient: skopje.ana, starts: '09:15', overlap_ok: true },
    ]);
  });

  it.each(['booked', 'confirmed', 'arrived', 'completed'])(
    'over a %s visit, and over one booked anyway itself: overlap_ok true',
    async (status) => {
      const day = freshDay();
      await existing(skopje, `${day}T07:00:00Z`, 60, { status });
      await existing(skopje, `${day}T07:30:00Z`, 30, { overlapOk: true });
      const id = await booked(skopje, { day, startMinute: 9 * H + 45, anyway: true });
      expect((await row(id)).overlap_ok).toBe(true);
    },
  );

  it.each(['cancelled', 'no_show'])(
    'with "anyway", the other visit %s by the time it reaches the server: an ordinary booking, overlap_ok false',
    async (status) => {
      const day = freshDay();
      // The drawer showed the overlap; the other visit was then cancelled (or marked a no-show).
      const other = await existing(skopje, `${day}T07:00:00Z`, 30);
      await admin.query('update appointments set status = $2 where id = $1', [other, status]);
      const id = await booked(skopje, { day, startMinute: 9 * H, anyway: true });
      expect((await row(id)).overlap_ok).toBe(false);
      // An ordinary booking, which the database's constraint guards: a visit over it that skips the
      // module's check fails the constraint.
      await expect(existing(skopje, `${day}T07:15:00Z`, 30)).rejects.toThrow(
        /appointments_no_double_booking/,
      );
    },
  );

  it('with "anyway" and nothing to overlap: an ordinary booking, overlap_ok false', async () => {
    const day = freshDay();
    await existing(skopje, `${day}T07:00:00Z`, 30);
    // Back to back: 09:30, as the other visit ends.
    const id = await booked(skopje, { day, startMinute: 9 * H + 30, anyway: true });
    expect((await row(id)).overlap_ok).toBe(false);
  });

  it('without "anyway", the same time is refused as an overlap, with nothing written', async () => {
    const day = freshDay();
    await existing(skopje, `${day}T07:00:00Z`, 30);
    const before = await written(skopje.clinic);
    expect(await book(skopje, { day, startMinute: 9 * H + 15, anyway: false })).toEqual({
      ok: false,
      code: 'overlap',
    });
    expect(await written(skopje.clinic)).toEqual(before);
  });
});

describe('one booking per click: the same booking again is already_booked (E01-T05b, acceptance 3)', () => {
  let nextDay = 15;
  const freshDay = (): CalendarDay => `2031-06-${String(nextDay++).padStart(2, '0')}`;

  it.each([false, true])(
    'sent twice (anyway: %s): the second is already_booked, with nothing written',
    async (anyway) => {
      const day = freshDay();
      await booked(skopje, { day, startMinute: 9 * H, anyway });
      const before = await written(skopje.clinic);
      expect(await book(skopje, { day, startMinute: 9 * H, anyway })).toEqual({
        ok: false,
        code: 'already_booked',
      });
      expect(await written(skopje.clinic)).toEqual(before);
      expect(await dentistsDay(skopje, day)).toEqual([
        { patient: skopje.ana, starts: '09:00', overlap_ok: false },
      ]);
    },
  );

  it('booked anyway over another visit, then sent again, with or without "anyway": already_booked, not an overlap', async () => {
    const day = freshDay();
    await existing(skopje, `${day}T07:00:00Z`, 30);
    await booked(skopje, { day, startMinute: 9 * H, anyway: true });
    const before = await written(skopje.clinic);
    for (const anyway of [true, false]) {
      expect(await book(skopje, { day, startMinute: 9 * H, anyway })).toEqual({
        ok: false,
        code: 'already_booked',
      });
    }
    expect(await written(skopje.clinic)).toEqual(before);
    expect(await dentistsDay(skopje, day)).toEqual([
      { patient: skopje.marko, starts: '09:00', overlap_ok: false },
      { patient: skopje.ana, starts: '09:00', overlap_ok: true },
    ]);
  });

  it('the same patient, provider and start with another treatment or length is the same booking', async () => {
    const day = freshDay();
    await booked(skopje, { day, startMinute: 10 * H });
    expect(
      await book(skopje, {
        day,
        startMinute: 10 * H,
        lengthMinutes: 45,
        treatmentTypeId: skopje.filling,
      }),
    ).toEqual({ ok: false, code: 'already_booked' });
  });

  it('is no copy: another start, another provider, another patient, or a visit that frees its time', async () => {
    const day = freshDay();
    await booked(skopje, { day, startMinute: 9 * H });
    // Ana again at 09:15 with the dentist: her own visit overlaps it.
    expect(await book(skopje, { day, startMinute: 9 * H + 15 })).toEqual({
      ok: false,
      code: 'overlap',
    });
    // Ana at 09:00 with the hygienist, who is free then.
    await booked(skopje, { day, startMinute: 9 * H, providerId: skopje.hygienist });
    // Marko at 09:00 with the dentist: another patient's booking over Ana's visit.
    expect(await book(skopje, { day, startMinute: 9 * H, patientId: skopje.marko })).toEqual({
      ok: false,
      code: 'overlap',
    });
    // Ana's visit at 11:00, cancelled or a no-show: the same booking again books.
    for (const status of ['cancelled', 'no_show']) {
      await existing(skopje, `${day}T09:00:00Z`, 30, { patientId: skopje.ana, status });
    }
    await booked(skopje, { day, startMinute: 11 * H });
  });

  it.each([false, true])(
    'twice at once (anyway: %s): the second waits for the provider’s lock, then is already_booked; one row',
    async (anyway) => {
      const day = freshDay();
      // With "anyway" over another visit: the database's constraint does not hold a row booked anyway,
      // so the lock alone keeps the second copy out.
      if (anyway) await existing(skopje, `${day}T07:00:00Z`, 30);
      const first = bookAndHold(skopje, { day, startMinute: 9 * H, anyway });
      await first.booked;
      const startedAt = Date.now();
      const second = book(skopje, { day, startMinute: 9 * H, anyway });
      const [one, two] = await Promise.all([first.result, second]);
      expect(one.ok).toBe(true);
      expect(two).toEqual({ ok: false, code: 'already_booked' });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
      expect(
        (await dentistsDay(skopje, day)).filter((visit) => visit.patient === skopje.ana),
      ).toEqual([{ patient: skopje.ana, starts: '09:00', overlap_ok: anyway }]);
    },
  );
});

describe('the booking action: "anyway", the same booking again, and a visit booked meanwhile (E01-T05b)', () => {
  let nextDay = 1;
  const freshDay = (): CalendarDay => `2031-07-${String(nextDay++).padStart(2, '0')}`;

  it('Book anyway sends "anyway": booked with overlap_ok true, one audit row, the day brought again', async () => {
    request.clinic = skopje.clinic;
    const day = freshDay();
    await existing(skopje, `${day}T07:00:00Z`, 30);
    const before = await written(skopje.clinic);
    const result = await bookAppointment(
      skopje.clinic,
      form(skopje, { day, start: '09:15', anyway: 'true' }),
    );
    if (!result.ok) throw new Error(`refused: ${result.error.code}`);
    expect(await written(skopje.clinic)).toEqual([before[0] + 1, before[1] + 1]);
    expect(await row(result.value.id)).toMatchObject({ overlap_ok: true, created_by: frontDeskId });
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('"anyway" sent after the other visit was cancelled: an ordinary booking, overlap_ok false', async () => {
    request.clinic = skopje.clinic;
    const day = freshDay();
    const other = await existing(skopje, `${day}T07:00:00Z`, 30);
    await admin.query(`update appointments set status = 'cancelled' where id = $1`, [other]);
    const result = await bookAppointment(
      skopje.clinic,
      form(skopje, { day, start: '09:00', anyway: 'true' }),
    );
    if (!result.ok) throw new Error(`refused: ${result.error.code}`);
    expect((await row(result.value.id)).overlap_ok).toBe(false);
  });

  it('"anyway" is a field the drawer sends as "true" alone: another value is the schema’s problem, at it', async () => {
    request.clinic = skopje.clinic;
    const before = await written(skopje.clinic);
    const result = await bookAppointment(
      skopje.clinic,
      form(skopje, { day: freshDay(), anyway: 'yes' }),
    );
    if (result.ok || result.error.code !== 'invalid_input' || !('issues' in result.error)) {
      throw new Error('expected invalid_input');
    }
    expect(result.error.issues.map((issue) => issue.path[0])).toEqual(['anyway']);
    expect(await written(skopje.clinic)).toEqual(before);
  });

  it.each([undefined, 'true'])(
    'the same booking sent twice (anyway: %s): already_booked, nothing written, the day brought again',
    async (anyway) => {
      request.clinic = skopje.clinic;
      const day = freshDay();
      // With "anyway": over Marko's visit at 10:00.
      if (anyway) await existing(skopje, `${day}T08:00:00Z`, 30);
      const fields = { day, start: '10:00', ...(anyway ? { anyway } : {}) };
      const first = await bookAppointment(skopje.clinic, form(skopje, fields));
      if (!first.ok) throw new Error(`refused: ${first.error.code}`);
      cache.refresh.mockClear();
      const before = await written(skopje.clinic);
      expect(await bookAppointment(skopje.clinic, form(skopje, fields))).toEqual({
        ok: false,
        error: { code: 'already_booked' },
      });
      expect(await written(skopje.clinic)).toEqual(before);
      expect(cache.refresh).toHaveBeenCalledOnce();
    },
  );

  it.each([undefined, 'true'])(
    'the same booking sent twice at once (anyway: %s): one row, the other already_booked',
    async (anyway) => {
      request.clinic = skopje.clinic;
      const day = freshDay();
      if (anyway) await existing(skopje, `${day}T08:00:00Z`, 30);
      const fields = { day, start: '10:00', ...(anyway ? { anyway } : {}) };
      const before = await written(skopje.clinic);
      const answers = await Promise.all([
        bookAppointment(skopje.clinic, form(skopje, fields)),
        bookAppointment(skopje.clinic, form(skopje, fields)),
      ]);
      expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
      expect(answers.filter((answer) => !answer.ok)).toEqual([
        { ok: false, error: { code: 'already_booked' } },
      ]);
      expect(await written(skopje.clinic)).toEqual([before[0] + 1, before[1] + 1]);
    },
  );

  it('a visit booked by someone else after the day was read: Book refused, the day brought again names it, Book anyway books it (acceptance 2)', async () => {
    request.clinic = skopje.clinic;
    const day = freshDay();
    const blocksOfDentist = async () => {
      const read = await readCalendarDay(skopje.clinic, { day });
      if (!read.ok) throw new Error(`not read: ${read.error.code}`);
      const column = read.value.view.columns.find((found) => found.providerId === skopje.dentist);
      return (column?.blocks ?? []).filter((block) => block.kind === 'appointment');
    };
    // The drawer opened on the day as read: nothing booked at 09:00.
    expect(await blocksOfDentist()).toEqual([]);
    // Someone else books Marko at 09:00 meanwhile.
    const other = await existing(skopje, `${day}T07:00:00Z`, 30);
    // Book, without "anyway": refused, and the answer brings the day again.
    expect(await bookAppointment(skopje.clinic, form(skopje, { day, start: '09:00' }))).toEqual({
      ok: false,
      error: { code: 'overlap' },
    });
    expect(cache.refresh).toHaveBeenCalledOnce();
    // The day it brings holds that visit, which the drawer's warning then names.
    expect((await blocksOfDentist()).map((block) => block.id)).toEqual([other]);
    // Book anyway.
    const result = await bookAppointment(
      skopje.clinic,
      form(skopje, { day, start: '09:00', anyway: 'true' }),
    );
    if (!result.ok) throw new Error(`refused: ${result.error.code}`);
    expect(await dentistsDay(skopje, day)).toEqual([
      { patient: skopje.marko, starts: '09:00', overlap_ok: false },
      { patient: skopje.ana, starts: '09:00', overlap_ok: true },
    ]);
  });
});

describe('a break, the hours or a closed day are warned of, never refused (E01-T05b, acceptance 4)', () => {
  it('the day read as the drawer warns of it, and Book books each: in a break, partly outside the hours, on a closed day, on a weekday without hours', async () => {
    // A clinic of its own, so no other case's day changes: open Monday to Friday 08:00–18:00, the
    // dentist's lunch on Tuesdays, Wednesday 23 July 2031 closed. Skopje in July is UTC+2.
    const place = await clinicIn('Europe/Skopje');
    await insertMembership(admin, {
      clinicId: place.clinic,
      userId: frontDeskId,
      role: 'front_desk',
    });
    for (const weekday of [1, 2, 3, 4, 5]) {
      await insertRow(admin, 'clinic_hours', {
        id: newId(),
        clinic_id: place.clinic,
        weekday,
        opens: '08:00',
        closes: '18:00',
      });
    }
    await insertRow(admin, 'provider_breaks', {
      id: newId(),
      clinic_id: place.clinic,
      provider_id: place.dentist,
      weekday: 2,
      starts: '12:00',
      ends: '13:00',
      label: 'Lunch',
    });
    await insertRow(admin, 'closed_days', {
      id: newId(),
      clinic_id: place.clinic,
      date: '2031-07-23',
      label: 'Staff training day',
    });
    request.clinic = place.clinic;
    const viewOf = async (day: CalendarDay) => {
      const read = await readCalendarDay(place.clinic, { day });
      if (!read.ok) throw new Error(`not read: ${read.error.code}`);
      return read.value.view;
    };
    const tuesday = await viewOf('2031-07-22');
    const lunch = tuesday.columns
      .find((column) => column.providerId === place.dentist)
      ?.blocks.filter((block) => block.kind === 'break');
    expect(lunch?.map((block) => [block.from, block.to])).toEqual([[12 * H, 13 * H]]);
    expect((await viewOf('2031-07-24')).open).toEqual({ from: 8 * H, to: 18 * H });
    expect((await viewOf('2031-07-23')).closed).toEqual({
      why: 'closed_day',
      label: 'Staff training day',
    });
    expect((await viewOf('2031-07-26')).closed).toEqual({ why: 'no_hours' });

    for (const [day, start] of [
      ['2031-07-22', '12:15'], // in the dentist's lunch
      ['2031-07-24', '17:45'], // to 18:15, past the closing
      ['2031-07-23', '09:00'], // a closed day
      ['2031-07-26', '09:00'], // a Saturday, no hours
    ] as const) {
      const result = await bookAppointment(place.clinic, form(place, { day, start }));
      if (!result.ok) throw new Error(`${day} ${start} refused: ${result.error.code}`);
      expect((await row(result.value.id)).overlap_ok, `${day} ${start}`).toBe(false);
    }
  });
});

// The tester's (E01-T05b): the drawer's warning, read from the day as the calendar reads it, and the
// server's check agree on the four days the clocks change in Skopje and New York (a block's minutes
// are the clock's, as the drawer's start is: in real minutes a 23- or 25-hour day would put the visit
// an hour off); the same booking again over the patient's own visit of every status that holds the
// chair; and the same booking from two tabs at once, one with "anyway" and one without, where only
// the provider's lock and `already_booked` keep the second copy out (a row booked anyway is not held
// by the database's constraint). Days of August 2031 in Skopje (UTC+2: 09:00 is 07:00 UTC).

describe('on the days the clocks change, the warning and the server agree (tester)', () => {
  it.each([
    // Skopje: summer time from 02:00 (UTC+2), so 09:00 is 07:00 UTC; winter time from 03:00 (UTC+1).
    { zone: 'Europe/Skopje', day: '2031-03-30', nine: '2031-03-30T07:00:00Z' },
    { zone: 'Europe/Skopje', day: '2031-10-26', nine: '2031-10-26T08:00:00Z' },
    // New York: daylight time from 02:00 (UTC-4), 09:00 is 13:00 UTC; standard time from 02:00 (UTC-5).
    { zone: 'America/New_York', day: '2031-03-09', nine: '2031-03-09T13:00:00Z' },
    { zone: 'America/New_York', day: '2031-11-02', nine: '2031-11-02T14:00:00Z' },
  ] as const)(
    '$zone on $day: a visit at 09:00 is warned of from 08:45 to 09:15, not at 08:30 or 09:30, and the server refuses and books alike',
    async ({ zone, day, nine }) => {
      const place = zone === 'America/New_York' ? newYork : skopje;
      request.clinic = place.clinic;
      const other = await existing(place, nine, 30);
      const read = await readCalendarDay(place.clinic, { day });
      if (!read.ok) throw new Error(`not read: ${read.error.code}`);
      const warned = (start: number) =>
        bookingWarnings(read.value.view, {
          providerId: place.dentist,
          start,
          length: 30,
        }).overlaps.map((block) => block.id);
      for (const start of [8 * H + 45, 9 * H, 9 * H + 15]) {
        expect(warned(start), `${start}`).toEqual([other]);
      }
      expect(warned(8 * H + 30)).toEqual([]);
      expect(warned(9 * H + 30)).toEqual([]);

      // The server, alike: 09:30 is an ordinary booking; 09:15 is refused, then booked anyway.
      const after = await bookAppointment(place.clinic, form(place, { day, start: '09:30' }));
      if (!after.ok) throw new Error(`09:30 refused: ${after.error.code}`);
      expect((await row(after.value.id)).overlap_ok).toBe(false);
      expect(await bookAppointment(place.clinic, form(place, { day, start: '09:15' }))).toEqual({
        ok: false,
        error: { code: 'overlap' },
      });
      const anyway = await bookAppointment(
        place.clinic,
        form(place, { day, start: '09:15', anyway: 'true' }),
      );
      if (!anyway.ok) throw new Error(`09:15 anyway refused: ${anyway.error.code}`);
      expect((await row(anyway.value.id)).overlap_ok).toBe(true);
    },
  );
});

describe('one booking per click, the edges (tester)', () => {
  let nextDay = 1;
  const freshDay = (): CalendarDay => `2031-08-${String(nextDay++).padStart(2, '0')}`;

  it.each(['booked', 'confirmed', 'arrived', 'completed'])(
    'the same booking again over the patient\'s own %s visit: already_booked, with or without "anyway", nothing written',
    async (status) => {
      const day = freshDay();
      await existing(skopje, `${day}T07:00:00Z`, 30, { patientId: skopje.ana, status });
      const before = await written(skopje.clinic);
      for (const anyway of [false, true]) {
        expect(
          await book(skopje, { day, startMinute: 9 * H, anyway }),
          `anyway: ${anyway}`,
        ).toEqual({ ok: false, code: 'already_booked' });
      }
      expect(await written(skopje.clinic)).toEqual(before);
    },
  );

  it.each([
    { first: false, second: true },
    { first: true, second: false },
  ])(
    'from two tabs at once, the first with "anyway": $first, the second: $second: one row, the other already_booked',
    async ({ first, second }) => {
      const day = freshDay();
      // The tab that sends "anyway" showed Marko's visit at 09:00, cancelled since: nothing holds the
      // chair, so the first is an ordinary booking whichever it is.
      await existing(skopje, `${day}T07:00:00Z`, 30, { status: 'cancelled' });
      const one = bookAndHold(skopje, { day, startMinute: 9 * H, anyway: first });
      await one.booked;
      const startedAt = Date.now();
      const two = book(skopje, { day, startMinute: 9 * H, anyway: second });
      const [answerOne, answerTwo] = await Promise.all([one.result, two]);
      expect(answerOne.ok).toBe(true);
      expect(answerTwo).toEqual({ ok: false, code: 'already_booked' });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
      expect(
        (await dentistsDay(skopje, day)).filter((visit) => visit.patient === skopje.ana),
      ).toEqual([{ patient: skopje.ana, starts: '09:00', overlap_ok: false }]);
    },
  );
});

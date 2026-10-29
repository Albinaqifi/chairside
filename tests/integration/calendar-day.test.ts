import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppointmentBlock, Block, CalendarDayView, Column } from '@/app/(staff)/calendar/day';
import { readDay } from '@/app/(staff)/calendar/read-day';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import type { CalendarDay } from '@/lib/calendar-day';
import { newId } from '@/lib/ids';
import { patientNames } from '@/modules/patients';
import { appointmentsOnDay, breaksOnWeekday, listProviders } from '@/modules/scheduling';
import { closedDaysBetween, openingHours } from '@/modules/tenancy';
import { insertClinic, migratorPool } from './fixtures';
import { insertRow, insertUser } from './scheduling-fixtures';

// E01-T04a: the calendar's day as the app reads it: the four modules in one tenant transaction, as
// the app role, under Row-Level Security, then laid out. The rows are written as the migration role.
// Moments are written in UTC and each case names its clinic's zone, so neither the computer's zone
// nor the database session's plays a part (D-099). Names are from the seed's invented lists.

const admin = migratorPool();
const H = 60;
/** 23:30 UTC on 25 October 2026: already 26 October in Skopje, still the 25th in New York. */
const NOW = new Date('2026-10-25T23:30:00Z');

let userId: string;

async function clinicIn(timeZone: string): Promise<string> {
  const id = await insertClinic(admin);
  await admin.query(`update clinics set timezone = $2 where id = $1`, [id, timeZone]);
  return id;
}

async function provider(
  clinicId: string,
  fields: { name: string; sort: number; hue?: number; active?: boolean },
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'providers', {
    id,
    clinic_id: clinicId,
    name: fields.name,
    short_name: fields.name.split(' ')[1] ?? fields.name,
    kind: 'dentist',
    chair_label: `Chair ${fields.sort}`,
    color_hue: fields.hue ?? 195,
    active: fields.active ?? true,
    sort_order: fields.sort,
  });
  return id;
}

async function patient(clinicId: string, first: string, last: string): Promise<string> {
  const id = newId();
  await insertRow(admin, 'patients', {
    id,
    clinic_id: clinicId,
    first_name: first,
    last_name: last,
    language: 'en',
  });
  return id;
}

/** An appointment from a moment, written in UTC, for `minutes`. */
async function appointment(
  clinicId: string,
  providerId: string,
  patientId: string,
  startsAt: string,
  minutes: number,
  fields: { status?: string; overlapOk?: boolean; note?: string; title?: string } = {},
): Promise<string> {
  const id = newId();
  await admin.query(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, overlap_ok, source, note, created_by)
     values ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz + make_interval(mins => $7),
             $8, $9, 'staff', $10, $11)`,
    [
      id,
      clinicId,
      patientId,
      providerId,
      fields.title ?? 'Checkup',
      startsAt,
      minutes,
      fields.status ?? 'booked',
      fields.overlapOk ?? false,
      fields.note ?? '',
      userId,
    ],
  );
  return id;
}

async function weekdayHours(clinicId: string, opens: string, closes: string): Promise<void> {
  for (const weekday of [1, 2, 3, 4, 5]) {
    await insertRow(admin, 'clinic_hours', {
      id: newId(),
      clinic_id: clinicId,
      weekday,
      opens,
      closes,
    });
  }
}

async function providerBreak(
  clinicId: string,
  providerId: string,
  weekday: number,
  starts: string,
  ends: string,
): Promise<void> {
  await insertRow(admin, 'provider_breaks', {
    id: newId(),
    clinic_id: clinicId,
    provider_id: providerId,
    weekday,
    starts,
    ends,
    label: 'Lunch',
  });
}

function read(clinicId: string, day: CalendarDay | null, now = NOW): Promise<CalendarDayView> {
  return withTenant(clinicId, (tx) => readDay(tx, day, now));
}

function column(view: CalendarDayView, providerId: string): Column {
  const found = view.columns.find((c) => c.providerId === providerId);
  if (!found) throw new Error('no column for that provider');
  return found;
}

function visits(blocks: readonly Block[]): AppointmentBlock[] {
  return blocks.filter((block): block is AppointmentBlock => block.kind === 'appointment');
}

/** Harbour Street on Monday 26 October 2026, in Skopje, and a second clinic beside it. */
const a = {} as Record<
  'clinic' | 'planinska' | 'kodra' | 'lumi' | 'kamenov' | 'ana' | 'bojan',
  string
>;
const av = {} as Record<
  | 'confirmed'
  | 'rootCanal'
  | 'emergency'
  | 'cancelled'
  | 'rebooked'
  | 'arrived'
  | 'noShow'
  | 'lumi',
  string
>;
const b = {} as Record<'clinic' | 'provider' | 'patient' | 'visit', string>;

beforeAll(async () => {
  userId = await insertUser(admin);

  a.clinic = await clinicIn('Europe/Skopje');
  // Written out of order: the calendar orders them by sort_order.
  a.kodra = await provider(a.clinic, { name: 'Arben Kodra', sort: 2, hue: 290 });
  a.planinska = await provider(a.clinic, { name: 'Elena Planinska', sort: 1, hue: 195 });
  a.lumi = await provider(a.clinic, { name: 'Mimoza Lumi', sort: 3, active: false });
  a.kamenov = await provider(a.clinic, { name: 'Bojan Kamenov', sort: 4, active: false });
  a.ana = await patient(a.clinic, 'Ana', 'Brezovska');
  a.bojan = await patient(a.clinic, 'Bojan', 'Ezerovski');
  await weekdayHours(a.clinic, '08:00', '18:00');
  await providerBreak(a.clinic, a.planinska, 1, '12:00', '13:00');
  await providerBreak(a.clinic, a.planinska, 2, '12:30', '13:30');
  await providerBreak(a.clinic, a.kodra, 1, '13:00', '14:00');
  await providerBreak(a.clinic, a.kamenov, 1, '12:00', '12:30');
  await insertRow(admin, 'closed_days', {
    id: newId(),
    clinic_id: a.clinic,
    date: '2026-11-02',
    label: 'Staff training day',
  });
  // Monday 26 October, winter time (UTC+1) since the night before: 09:00 there is 08:00 UTC.
  av.confirmed = await appointment(a.clinic, a.planinska, a.ana, '2026-10-26T08:00:00Z', 30, {
    status: 'confirmed',
  });
  av.rootCanal = await appointment(a.clinic, a.planinska, a.bojan, '2026-10-26T09:00:00Z', 90, {
    title: 'Root canal',
  });
  // Squeezed in during the root canal: booked anyway (D-020).
  av.emergency = await appointment(a.clinic, a.planinska, a.ana, '2026-10-26T09:30:00Z', 30, {
    overlapOk: true,
    title: 'Emergency',
  });
  // A cancelled visit, and another booked in its place.
  av.cancelled = await appointment(a.clinic, a.kodra, a.ana, '2026-10-26T10:00:00Z', 30, {
    status: 'cancelled',
  });
  av.rebooked = await appointment(a.clinic, a.kodra, a.bojan, '2026-10-26T10:00:00Z', 30);
  av.arrived = await appointment(a.clinic, a.kodra, a.ana, '2026-10-26T13:00:00Z', 60, {
    status: 'arrived',
  });
  av.noShow = await appointment(a.clinic, a.kodra, a.bojan, '2026-10-26T14:00:00Z', 30, {
    status: 'no_show',
  });
  // The inactive provider's last visit.
  av.lumi = await appointment(a.clinic, a.lumi, a.ana, '2026-10-26T15:00:00Z', 30, {
    note: 'Last visit before the move',
  });
  // On the closed day, and on the Saturday the clinic has no hours.
  await appointment(a.clinic, a.planinska, a.ana, '2026-11-02T08:00:00Z', 30);
  await appointment(a.clinic, a.planinska, a.bojan, '2026-10-31T09:00:00Z', 30);

  // A second clinic, same zone, with rows on the same day at the same times, other hours and a
  // closed day that day: none of it may reach the first clinic's calendar.
  b.clinic = await clinicIn('Europe/Skopje');
  b.provider = await provider(b.clinic, { name: 'Ljubica Koshkova', sort: 1 });
  b.patient = await patient(b.clinic, 'Jovana', 'Lozanova');
  for (const weekday of [1, 2, 3, 4, 5]) {
    await insertRow(admin, 'clinic_hours', {
      id: newId(),
      clinic_id: b.clinic,
      weekday,
      opens: '06:00',
      closes: '21:00',
    });
  }
  await providerBreak(b.clinic, b.provider, 1, '11:00', '11:30');
  await insertRow(admin, 'closed_days', {
    id: newId(),
    clinic_id: b.clinic,
    date: '2026-10-26',
    label: 'Second clinic holiday',
  });
  b.visit = await appointment(b.clinic, b.provider, b.patient, '2026-10-26T08:00:00Z', 30);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

describe("the seeded kind of day: every appointment in its provider's column (acceptance 1)", () => {
  it('a column per active provider, by sort_order, and the inactive one with a visit that day', async () => {
    const view = await read(a.clinic, '2026-10-26');
    expect(view.columns.map((c) => c.providerId)).toEqual([a.planinska, a.kodra, a.lumi]);
    expect(view.columns.map((c) => [c.name, c.initials, c.chairLabel, c.hue])).toEqual([
      ['Elena Planinska', 'EP', 'Chair 1', 195],
      ['Arben Kodra', 'AK', 'Chair 2', 290],
      ['Mimoza Lumi', 'ML', 'Chair 3', 195],
    ]);
  });

  it("each at its local start, as long as it lasts, with its status, title, note and patient's name", async () => {
    const view = await read(a.clinic, '2026-10-26');
    const shown = (providerId: string) =>
      visits(column(view, providerId).blocks).map((v) => ({
        id: v.id,
        from: v.from,
        to: v.to,
        status: v.status,
        startsAt: v.startsAt,
      }));
    expect(shown(a.planinska)).toEqual([
      {
        id: av.confirmed,
        from: 9 * H,
        to: 9 * H + 30,
        status: 'confirmed',
        startsAt: '2026-10-26T08:00:00.000Z',
      },
      {
        id: av.rootCanal,
        from: 10 * H,
        to: 11 * H + 30,
        status: 'booked',
        startsAt: '2026-10-26T09:00:00.000Z',
      },
      {
        id: av.emergency,
        from: 10 * H + 30,
        to: 11 * H,
        status: 'booked',
        startsAt: '2026-10-26T09:30:00.000Z',
      },
    ]);
    expect(shown(a.kodra).map((v) => [v.id, v.from, v.status])).toEqual([
      [av.rebooked, 11 * H, 'booked'],
      [av.cancelled, 11 * H, 'cancelled'],
      [av.arrived, 14 * H, 'arrived'],
      [av.noShow, 15 * H, 'no_show'],
    ]);
    const lumi = visits(column(view, a.lumi).blocks)[0];
    expect(lumi).toMatchObject({
      id: av.lumi,
      from: 16 * H,
      to: 16 * H + 30,
      title: 'Checkup',
      note: 'Last visit before the move',
      patient: { firstName: 'Ana', lastName: 'Brezovska' },
    });
    expect(visits(column(view, a.planinska).blocks)[1]?.patient).toEqual({
      firstName: 'Bojan',
      lastName: 'Ezerovski',
    });
    expect(view.appointmentCount).toBe(8);
  });

  it("the provider's breaks of that weekday, at their local times; none of another weekday", async () => {
    const monday = await read(a.clinic, '2026-10-26');
    const breaks = (view: CalendarDayView, providerId: string) =>
      column(view, providerId)
        .blocks.filter((block) => block.kind === 'break')
        .map((block) => [block.from, block.to]);
    expect(breaks(monday, a.planinska)).toEqual([[12 * H, 13 * H]]);
    expect(breaks(monday, a.kodra)).toEqual([[13 * H, 14 * H]]);
    const tuesday = await read(a.clinic, '2026-10-27');
    expect(breaks(tuesday, a.planinska)).toEqual([[12 * H + 30, 13 * H + 30]]);
    expect(breaks(tuesday, a.kodra)).toEqual([]);
  });

  it("the day's hours, its grid and each column's % booked", async () => {
    const view = await read(a.clinic, '2026-10-26');
    expect(view).toMatchObject({
      day: '2026-10-26',
      previous: '2026-10-25',
      next: '2026-10-27',
      closed: null,
      open: { from: 8 * H, to: 18 * H },
      grid: { from: 8 * H, to: 18 * H },
      shaded: [],
    });
    // Planinska: 30 + 90 + 30 minutes of 600 less lunch (540). Kodra: the rebooked visit and the
    // arrived one, 90 of 540; the cancelled visit and the no-show count nothing. Lumi: 30 of 600.
    expect(view.columns.map((c) => c.percentBooked)).toEqual([28, 17, 5]);
  });
});

describe('two appointments of one column that overlap both show, side by side (acceptance 3)', () => {
  it('a visit booked anyway over another, and a cancelled one with the visit rebooked in its place', async () => {
    const view = await read(a.clinic, '2026-10-26');
    const lanes = (providerId: string) =>
      visits(column(view, providerId).blocks).map((v) => [v.id, v.lane, v.lanes]);
    expect(lanes(a.planinska)).toEqual([
      [av.confirmed, 0, 1],
      [av.rootCanal, 0, 2],
      [av.emergency, 1, 2],
    ]);
    expect(lanes(a.kodra)).toEqual([
      [av.rebooked, 0, 2],
      [av.cancelled, 1, 2],
      [av.arrived, 0, 1],
      [av.noShow, 0, 1],
    ]);
  });
});

describe('a closed day (acceptance 4)', () => {
  it('a closed_days date: closed with its label, no % booked; its appointment still shows', async () => {
    const view = await read(a.clinic, '2026-11-02');
    expect(view.closed).toEqual({ why: 'closed_day', label: 'Staff training day' });
    expect(view.open).toBeNull();
    expect(view.shaded).toEqual([view.grid]);
    expect(view.columns.map((c) => c.percentBooked)).toEqual([null, null]);
    expect(visits(column(view, a.planinska).blocks).map((v) => v.from)).toEqual([9 * H]);
  });

  it('a weekday without hours: closed; its appointment still shows', async () => {
    const view = await read(a.clinic, '2026-10-31');
    expect(view.closed).toEqual({ why: 'no_hours' });
    expect(visits(column(view, a.planinska).blocks).map((v) => v.from)).toEqual([10 * H]);
  });

  // E01-T04b (owner, 2026-10-12): no lunch on a day the clinic is closed.
  it("a closed_days Monday shows none of the providers' Monday breaks", async () => {
    const open = await read(a.clinic, '2026-10-26');
    const closed = await read(a.clinic, '2026-11-02');
    const breakCount = (view: CalendarDayView) =>
      view.columns.flatMap((c) => c.blocks).filter((block) => block.kind === 'break').length;
    expect(breakCount(open)).toBeGreaterThan(0);
    expect(breakCount(closed)).toBe(0);
  });
});

describe('an inactive provider (acceptance 7)', () => {
  it('with an appointment that day has a column; without one, none', async () => {
    const monday = await read(a.clinic, '2026-10-26');
    expect(monday.columns.map((c) => c.providerId)).toContain(a.lumi);
    expect(monday.columns.map((c) => c.providerId)).not.toContain(a.kamenov);
    const tuesday = await read(a.clinic, '2026-10-27');
    expect(tuesday.columns.map((c) => c.providerId)).toEqual([a.planinska, a.kodra]);
  });
});

describe('nothing of the other clinic (acceptance 1)', () => {
  it("the first clinic's day holds none of the second clinic's rows", async () => {
    const view = await read(a.clinic, '2026-10-26');
    const ids = view.columns.flatMap((c) => [c.providerId, ...c.blocks.map((block) => block.id)]);
    expect(ids).not.toContain(b.provider);
    expect(ids).not.toContain(b.visit);
    // The second clinic's holiday and its longer hours do not reach it either.
    expect(view.closed).toBeNull();
    expect(view.grid).toEqual({ from: 8 * H, to: 18 * H });
    expect(JSON.stringify(view)).not.toContain('Lozanova');
  });

  it("and the second clinic's day holds only its own", async () => {
    const view = await read(b.clinic, '2026-10-26');
    expect(view.columns.map((c) => c.providerId)).toEqual([b.provider]);
    expect(visits(view.columns[0]?.blocks ?? []).map((v) => v.id)).toEqual([b.visit]);
    expect(view.closed).toEqual({ why: 'closed_day', label: 'Second clinic holiday' });
    expect(view.grid).toEqual({ from: 6 * H, to: 21 * H });
  });

  it("each module's read, in the second clinic's transaction, finds none of the first clinic's rows", async () => {
    // test-strategy.md, "Tenant isolation": through each public function; patientNames takes its
    // ids from its caller. In the first clinic the same calls find the rows, so an empty answer in
    // the second is the isolation, not a wrong id.
    const inClinic = (clinicId: string) =>
      withTenant(clinicId, async (tx) => ({
        names: [...(await patientNames(tx, [a.ana, a.bojan])).keys()].sort(),
        providers: (await listProviders(tx)).map((p) => p.id),
        breaks: (await breaksOnWeekday(tx, 1)).map((found) => found.providerId),
        appointments: (
          await appointmentsOnDay(
            tx,
            '2026-10-26',
            'Europe/Skopje',
            new Date('2026-10-26T08:00:00Z'),
          )
        ).map((v) => v.id),
        hours: (await openingHours(tx)).map((h) => [h.weekday, h.opens, h.closes]),
        closed: await closedDaysBetween(tx, '2026-10-01', '2026-11-30'),
      }));
    const first = await inClinic(a.clinic);
    expect(first.names).toEqual([a.ana, a.bojan].sort());
    expect(first.providers).toEqual([a.planinska, a.kodra, a.lumi, a.kamenov]);
    expect(first.appointments).toHaveLength(8);
    expect(first.closed).toEqual([{ date: '2026-11-02', label: 'Staff training day' }]);
    const second = await inClinic(b.clinic);
    expect(second).toEqual({
      names: [],
      providers: [b.provider],
      breaks: [b.provider],
      appointments: [b.visit],
      hours: [1, 2, 3, 4, 5].map((weekday) => [weekday, 6 * H, 21 * H]),
      closed: [{ date: '2026-10-26', label: 'Second clinic holiday' }],
    });
  });
});

describe("the clinic's today", () => {
  it('when no day is asked for: the day it is in the clinic’s zone', async () => {
    // 23:30 UTC on 25 October: 00:30 on the 26th in Skopje, 19:30 on the 25th in New York.
    expect((await read(a.clinic, null)).day).toBe('2026-10-26');
    const inNewYork = await clinicIn('America/New_York');
    expect((await read(inNewYork, null)).day).toBe('2026-10-25');
    expect((await read(inNewYork, null)).today).toBe('2026-10-25');
    expect((await read(inNewYork, '2026-12-01')).today).toBe('2026-10-25');
  });
});

describe("the clinic's zone, also on the days the clocks change and the day after each (acceptance 2)", () => {
  /** One clinic per zone, with one provider and one patient. */
  const place = {} as Record<
    'skopje' | 'newYork',
    { clinic: string; provider: string; patient: string }
  >;

  beforeAll(async () => {
    for (const [key, zone] of [
      ['skopje', 'Europe/Skopje'],
      ['newYork', 'America/New_York'],
    ] as const) {
      const clinic = await clinicIn(zone);
      place[key] = {
        clinic,
        provider: await provider(clinic, { name: 'Elena Planinska', sort: 1 }),
        patient: await patient(clinic, 'Ana', 'Brezovska'),
      };
    }
    const { skopje, newYork } = place;
    const visit = (where: typeof skopje, at: string, minutes = 30) =>
      appointment(where.clinic, where.provider, where.patient, at, minutes);
    // Skopje: summer time from 01:00 UTC on 29 March, winter time from 01:00 UTC on 25 October.
    await visit(skopje, '2026-03-29T03:00:00Z'); // 05:00 local, summer time
    await visit(skopje, '2026-03-29T07:00:00Z'); // 09:00
    await visit(skopje, '2026-03-30T07:00:00Z'); // 09:00 the day after
    await visit(skopje, '2026-10-25T04:00:00Z'); // 05:00 local, winter time
    await visit(skopje, '2026-10-25T08:00:00Z'); // 09:00
    await visit(skopje, '2026-10-26T08:00:00Z'); // 09:00 the day after
    // Across the night the clocks go forward: 01:30 winter time to 03:30 summer time, an hour long.
    await visit(skopje, '2026-03-29T00:30:00Z', 60);
    // New York, behind UTC: daylight time from 07:00 UTC on 8 March, standard from 06:00 UTC on 1 November.
    await visit(newYork, '2026-03-08T09:00:00Z'); // 05:00 local, daylight time
    await visit(newYork, '2026-03-08T13:00:00Z'); // 09:00
    await visit(newYork, '2026-03-09T03:30:00Z'); // 23:30 on 8 March, not 9 March
    await visit(newYork, '2026-03-09T13:00:00Z'); // 09:00 the day after
    await visit(newYork, '2026-11-01T10:00:00Z'); // 05:00 local, standard time
    await visit(newYork, '2026-11-01T14:00:00Z'); // 09:00
    await visit(newYork, '2026-11-02T04:30:00Z'); // 23:30 on 1 November, not 2 November
    await visit(newYork, '2026-11-02T14:00:00Z'); // 09:00 the day after
  });

  /** Each visit of the day: its place in minutes, and its start as stored. */
  async function placed(where: 'skopje' | 'newYork', day: CalendarDay) {
    const view = await read(place[where].clinic, day);
    return visits(view.columns[0]?.blocks ?? []).map((v) => [v.from, v.to, v.startsAt]);
  }

  it.each([
    {
      day: '2026-03-29',
      what: 'the day the clocks go forward (23 hours)',
      shown: [
        // Shown from its local start to its local end, on the clinic's clock.
        [1 * H + 30, 3 * H + 30, '2026-03-29T00:30:00.000Z'],
        [5 * H, 5 * H + 30, '2026-03-29T03:00:00.000Z'],
        [9 * H, 9 * H + 30, '2026-03-29T07:00:00.000Z'],
      ],
    },
    {
      day: '2026-03-30',
      what: 'the day after',
      shown: [[9 * H, 9 * H + 30, '2026-03-30T07:00:00.000Z']],
    },
    {
      day: '2026-10-25',
      what: 'the day the clocks go back (25 hours)',
      shown: [
        [5 * H, 5 * H + 30, '2026-10-25T04:00:00.000Z'],
        [9 * H, 9 * H + 30, '2026-10-25T08:00:00.000Z'],
      ],
    },
    {
      day: '2026-10-26',
      what: 'the day after',
      shown: [[9 * H, 9 * H + 30, '2026-10-26T08:00:00.000Z']],
    },
  ])('Europe/Skopje, $day, $what: each at its local time', async ({ day, shown }) => {
    expect(await placed('skopje', day)).toEqual(shown);
  });

  it.each([
    {
      day: '2026-03-08',
      what: 'the day the clocks go forward (23 hours)',
      shown: [
        [5 * H, 5 * H + 30, '2026-03-08T09:00:00.000Z'],
        [9 * H, 9 * H + 30, '2026-03-08T13:00:00.000Z'],
        [23 * H + 30, 24 * H, '2026-03-09T03:30:00.000Z'],
      ],
    },
    {
      day: '2026-03-09',
      what: 'the day after: the 23:30 of the day before is not on it',
      shown: [[9 * H, 9 * H + 30, '2026-03-09T13:00:00.000Z']],
    },
    {
      day: '2026-11-01',
      what: 'the day the clocks go back (25 hours)',
      shown: [
        [5 * H, 5 * H + 30, '2026-11-01T10:00:00.000Z'],
        [9 * H, 9 * H + 30, '2026-11-01T14:00:00.000Z'],
        [23 * H + 30, 24 * H, '2026-11-02T04:30:00.000Z'],
      ],
    },
    {
      day: '2026-11-02',
      what: 'the day after: the 23:30 of the day before is not on it',
      shown: [[9 * H, 9 * H + 30, '2026-11-02T14:00:00.000Z']],
    },
  ])('America/New_York, $day, $what: each at its local time', async ({ day, shown }) => {
    expect(await placed('newYork', day)).toEqual(shown);
  });

  it("whatever the database session's zone", async () => {
    const view = await withTenant(place.newYork.clinic, async (tx) => {
      await tx.execute(sql`set local time zone 'Pacific/Auckland'`);
      return readDay(tx, '2026-11-01', NOW);
    });
    expect(visits(view.columns[0]?.blocks ?? []).map((v) => [v.from, v.to])).toEqual([
      [5 * H, 5 * H + 30],
      [9 * H, 9 * H + 30],
      [23 * H + 30, 24 * H],
    ]);
  });

  it('a visit at 23:30 widens the grid to midnight, cut there', async () => {
    const view = await read(place.newYork.clinic, '2026-03-08');
    expect(view.grid).toEqual({ from: 5 * H, to: 24 * H });
  });
});

describe("the day's two midnights: a visit that overlaps the day from the evening before, or starts at a midnight (tester)", () => {
  // America/New_York, behind UTC: daylight time (UTC−4) on 20 to 22 October, so a day runs from
  // 04:00 UTC to 04:00 UTC; 1 November, the day the clocks go back, runs 25 hours, from 04:00 UTC
  // to 05:00 UTC on the 2nd. The visits are written in UTC.
  const ny = {} as { clinic: string; provider: string; patient: string };
  const v = {} as Record<'toMidnight' | 'atMidnight' | 'acrossMidnight' | 'nov1' | 'nov2', string>;

  beforeAll(async () => {
    ny.clinic = await clinicIn('America/New_York');
    ny.provider = await provider(ny.clinic, { name: 'Elena Planinska', sort: 1 });
    ny.patient = await patient(ny.clinic, 'Ana', 'Brezovska');
    await weekdayHours(ny.clinic, '08:00', '18:00');
    const visit = (at: string, minutes: number) =>
      appointment(ny.clinic, ny.provider, ny.patient, at, minutes);
    v.toMidnight = await visit('2026-10-21T03:30:00Z', 30); // 23:30 to 00:00, Tuesday 20 October
    v.atMidnight = await visit('2026-10-21T04:00:00Z', 30); // 00:00 to 00:30, Wednesday 21 October
    v.acrossMidnight = await visit('2026-10-22T03:30:00Z', 60); // 23:30 on the 21st to 00:30 on the 22nd
    v.nov1 = await visit('2026-11-01T04:00:00Z', 30); // 00:00 on 1 November, daylight time
    v.nov2 = await visit('2026-11-02T05:00:00Z', 30); // 00:00 on 2 November, standard time
  });

  it.each([
    {
      day: '2026-10-20',
      what: 'a visit that ends at midnight is on its day',
      shown: ['toMidnight', 23 * H + 30, 24 * H],
    },
    {
      day: '2026-10-22',
      what: 'a visit from the evening before, cut at 00:00',
      shown: ['acrossMidnight', 0, 30],
    },
    { day: '2026-10-31', what: 'the visit at the next midnight is not on it', shown: null },
    {
      day: '2026-11-01',
      what: 'the 25-hour day: its own midnight, not the next one 25 hours on',
      shown: ['nov1', 0, 30],
    },
    { day: '2026-11-02', what: 'the day after: from its own midnight', shown: ['nov2', 0, 30] },
  ] as const)('$day: $what', async ({ day, shown }) => {
    const view = await read(ny.clinic, day);
    const blocks = visits(view.columns[0]?.blocks ?? []).map((b) => [b.id, b.from, b.to]);
    expect(blocks).toEqual(shown === null ? [] : [[v[shown[0]], shown[1], shown[2]]]);
    expect(view.appointmentCount).toBe(blocks.length);
  });

  it('2026-10-21: a visit from its first minute, and one past its last, cut at 24:00', async () => {
    const view = await read(ny.clinic, '2026-10-21');
    expect(visits(view.columns[0]?.blocks ?? []).map((b) => [b.id, b.from, b.to])).toEqual([
      [v.atMidnight, 0, 30],
      [v.acrossMidnight, 23 * H + 30, 24 * H],
    ]);
    expect(view.grid).toEqual({ from: 0, to: 24 * H });
  });

  it('the visit from the evening before widens the next day’s grid to 00:00, not into the day before', async () => {
    expect((await read(ny.clinic, '2026-10-22')).grid).toEqual({ from: 0, to: 18 * H });
  });

  it('a clinic far ahead of UTC: Pacific/Auckland, where 11:30 UTC on 12 October is already the 13th', async () => {
    const auckland = await clinicIn('Pacific/Auckland');
    const elena = await provider(auckland, { name: 'Elena Planinska', sort: 1 });
    const ana = await patient(auckland, 'Ana', 'Brezovska');
    // 09:00 on Tuesday 13 October in Auckland (daylight time, UTC+13) is 20:00 UTC on the 12th.
    const id = await appointment(auckland, elena, ana, '2026-10-12T20:00:00Z', 30);
    const view = await read(auckland, null, new Date('2026-10-12T11:30:00Z'));
    expect(view).toMatchObject({ day: '2026-10-13', today: '2026-10-13' });
    expect(visits(view.columns[0]?.blocks ?? []).map((b) => [b.id, b.from, b.to])).toEqual([
      [id, 9 * H, 9 * H + 30],
    ]);
    expect(visits((await read(auckland, '2026-10-12')).columns[0]?.blocks ?? [])).toEqual([]);
  });
});

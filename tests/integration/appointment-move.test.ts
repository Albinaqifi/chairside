import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveAppointment as moveAction } from '@/app/(staff)/calendar/appointment-actions';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import * as patients from '@/modules/patients';
import * as scheduling from '@/modules/scheduling';
import {
  captureOutput,
  insertClinic,
  insertMembership,
  migratorPool,
  signInCookie,
  testEmail,
} from './fixtures';
import { insertRow, insertUser } from './scheduling-fixtures';

// E01-T06c: moving a visit, as the app runs it: the scheduling and patients modules in a tenant
// transaction, as the app role, under Row-Level Security, and the real action with a real session for
// every role (only next/headers and next/cache are replaced, as there is no running Next.js). Rows are
// set up and inspected as the migration role. Moments are written and read in UTC and each clinic names
// its zone, so neither the computer's zone nor the database session's plays a part (D-099). Where a case
// needs two transactions at once, a gate in the middle of one fixes the order, and "waits" is seen in the
// database (pg_locks), never from a sleep. Every value is synthetic; the assertions name ids and statuses.

const PASSWORD = 'MARKER-pw-06c1-correct';
/** Monday 3 March 2031, 10:00 UTC: 11:00 in Skopje (winter time, UTC+1). */
const NOW = new Date('2031-03-03T10:00:00Z');
/** Where the visits are: 12:00 in Skopje, an hour after NOW. */
const NOON = '2031-03-03T11:00:00Z';
const DAY = '2031-03-03';
const H = 60;
const SKOPJE = 'Europe/Skopje';
const NEW_YORK = 'America/New_York';

const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));

// Outside a server action refresh() and revalidatePath() throw; the action calls both when done.
const cache = vi.hoisted(() => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);

const admin = migratorPool();

interface Place {
  clinic: string;
  zone: string;
  ana: string;
  marko: string;
  archived: string;
  deceased: string;
  treatment: string;
}

let skopje: Place;
let newYork: Place;
let other: Place;
let creatorId: string;
const roleUsers: Record<string, { id: string; cookie: string }> = {};

async function clinicIn(zone: string): Promise<Place> {
  const clinic = await insertClinic(admin);
  await admin.query('update clinics set timezone = $2 where id = $1', [clinic, zone]);
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
  const treatment = newId();
  await insertRow(admin, 'treatment_types', {
    id: treatment,
    clinic_id: clinic,
    name: 'Checkup',
    default_duration_min: 30,
  });
  return {
    clinic,
    zone,
    ana: await patient('Ana', 'Brezovska'),
    marko: await patient('Marko', 'Dardha'),
    archived: await patient('Ana', 'Planinska', 'archived'),
    deceased: await patient('Shpëtim', 'Lumi', 'deceased'),
    treatment,
  };
}

beforeAll(async () => {
  creatorId = await insertUser(admin);
  skopje = await clinicIn(SKOPJE);
  newYork = await clinicIn(NEW_YORK);
  other = await clinicIn(SKOPJE);

  let address = 0;
  for (const role of ['owner', 'dentist', 'hygienist', 'front_desk']) {
    const email = testEmail();
    const { id } = await createStaffUser({ email, name: `Staff ${role}`, password: PASSWORD });
    await insertMembership(admin, { clinicId: skopje.clinic, userId: id, role });
    address += 1;
    roleUsers[role] = { id, cookie: await signInCookie(email, PASSWORD, `10.57.0.${address}`) };
  }
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => {
  cache.refresh.mockClear();
  cache.revalidatePath.mockClear();
  request.cookie = roleUsers['front_desk']!.cookie;
  request.clinic = skopje.clinic;
});

/** A provider of its own: a test's visits never meet another test's in the chair. */
async function provider(place: Place, active = true): Promise<string> {
  const id = newId();
  await insertRow(admin, 'providers', {
    id,
    clinic_id: place.clinic,
    name: 'Elena Planinska',
    short_name: 'Planinska',
    kind: 'dentist',
    chair_label: 'Chair 1',
    color_hue: 195,
    sort_order: 1,
    active,
  });
  return id;
}

interface VisitFields {
  patientId?: string;
  startsAt?: string;
  minutes?: number;
  status?: string;
  overlapOk?: boolean;
  confirmedAt?: string | null;
  confirmedVia?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  completedAt?: string | null;
}

/** An appointment written as the migration role. */
async function visit(place: Place, providerId: string, fields: VisitFields = {}): Promise<string> {
  const id = newId();
  await admin.query(
    `insert into appointments (id, clinic_id, patient_id, provider_id, treatment_type_id, title,
                               starts_at, ends_at, status, overlap_ok, source, created_by,
                               confirmed_at, confirmed_via, cancelled_at, cancelled_by, completed_at)
     values ($1, $2, $3, $4, $5, 'Checkup', $6::timestamptz,
             $6::timestamptz + make_interval(mins => $7),
             $8, $9, 'staff', $10, $11, $12, $13, $14, $15)`,
    [
      id,
      place.clinic,
      fields.patientId ?? place.ana,
      providerId,
      place.treatment,
      fields.startsAt ?? NOON,
      fields.minutes ?? 30,
      fields.status ?? 'booked',
      fields.overlapOk ?? false,
      creatorId,
      fields.confirmedAt ?? null,
      fields.confirmedVia ?? null,
      fields.cancelledAt ?? null,
      fields.cancelledBy ?? null,
      fields.completedAt ?? null,
    ],
  );
  return id;
}

async function row(id: string): Promise<Record<string, unknown>> {
  const { rows } = await admin.query('select * from appointments where id = $1', [id]);
  if (!rows[0]) throw new Error('no such appointment');
  return rows[0] as Record<string, unknown>;
}

const iso = (moment: unknown) => (moment instanceof Date ? moment.toISOString() : moment);

async function count(query: string, ...values: unknown[]): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(query, values);
  return Number(rows[0]?.n);
}

const movedRows = (id: string) =>
  count(
    `select count(*) as n from audit_log where entity_id = $1 and action = 'appointment.moved'`,
    id,
  );

/** The hook as a spy that does nothing, so a test sees how often and with what it fired. */
const hook = () => vi.fn<scheduling.AppointmentChangedHook>(() => Promise.resolve());

interface Target {
  providerId: string;
  day?: string;
  /** Minutes from the day's local midnight. */
  start: number;
  anyway?: boolean;
}

/** One move through the module in the clinic's own transaction. */
function move(
  place: Place,
  appointmentId: string,
  to: Target,
  emit: scheduling.AppointmentChangedHook = hook(),
) {
  return withTenant(place.clinic, (tx) =>
    scheduling.moveAppointment(
      tx,
      {
        appointmentId,
        providerId: to.providerId,
        day: to.day ?? DAY,
        startMinute: to.start,
        timeZone: place.zone,
        anyway: to.anyway ?? false,
        patientIsActive: async (patientId) =>
          (await patients.patientStatus(tx, patientId)) === 'active',
      },
      NOW,
      emit,
    ),
  );
}

/** The columns a refused move must leave as they were. */
async function expectUntouched(id: string, before: Record<string, unknown>) {
  expect(await row(id)).toEqual(before);
}

describe('a booked and a confirmed visit move (acceptance 1)', () => {
  it('to another start, also one that overlaps its own old place (12:00 to 12:15, same provider)', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    const emit = hook();
    expect(await move(skopje, id, { providerId: p, start: 12 * H + 15 }, emit)).toEqual({
      ok: true,
      from: 'booked',
      fields: ['start'],
    });
    expect(await row(id)).toMatchObject({
      provider_id: p,
      status: 'booked',
      overlap_ok: false,
    });
    const stored = await row(id);
    expect(iso(stored.starts_at)).toBe('2031-03-03T11:15:00.000Z');
    expect(iso(stored.ends_at)).toBe('2031-03-03T11:45:00.000Z');
  });

  it('a confirmed visit moves to another provider; the start is kept and the length too', async () => {
    const p = await provider(skopje);
    const q = await provider(skopje);
    const id = await visit(skopje, p, {
      status: 'confirmed',
      confirmedAt: '2031-03-02T10:00:00Z',
      confirmedVia: 'link',
      minutes: 45,
    });
    expect(await move(skopje, id, { providerId: q, start: 12 * H })).toEqual({
      ok: true,
      from: 'confirmed',
      fields: ['provider'],
    });
    const stored = await row(id);
    expect(stored.provider_id).toBe(q);
    expect(iso(stored.starts_at)).toBe(NOON.replace('Z', '.000Z'));
    expect(iso(stored.ends_at)).toBe('2031-03-03T11:45:00.000Z');
  });

  it('to another day, with the provider and the start changed too', async () => {
    const p = await provider(skopje);
    const q = await provider(skopje);
    const id = await visit(skopje, p);
    expect(await move(skopje, id, { providerId: q, day: '2031-03-05', start: 9 * H })).toEqual({
      ok: true,
      from: 'booked',
      fields: ['provider', 'day', 'start'],
    });
    const stored = await row(id);
    expect(iso(stored.starts_at)).toBe('2031-03-05T08:00:00.000Z');
    expect(iso(stored.ends_at)).toBe('2031-03-05T08:30:00.000Z');
  });

  it('to the same start on another day is a move of the day only', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    expect(await move(skopje, id, { providerId: p, day: '2031-03-04', start: 12 * H })).toEqual({
      ok: true,
      from: 'booked',
      fields: ['day'],
    });
  });

  it('to the same start with another provider and the same patient (the old place is not its own clash)', async () => {
    const p = await provider(skopje);
    const q = await provider(skopje);
    const id = await visit(skopje, p);
    expect((await move(skopje, id, { providerId: q, start: 12 * H })).ok).toBe(true);
  });

  // The length is real time: the new end is the new start plus the old length, whatever the clocks do.
  it.each([
    {
      name: 'Skopje, over the night the clocks go forward (30 March 2031, 02:00 to 03:00)',
      place: () => skopje,
      from: '2031-03-29T22:30:00Z', // 23:30 on the 29th, UTC+1
      minutes: 120,
      to: { day: '2031-03-30', start: 1 * H }, // 01:00, still UTC+1: 00:00Z
      starts: '2031-03-30T00:00:00.000Z',
      ends: '2031-03-30T02:00:00.000Z', // 04:00 on the wall, not 03:00
    },
    {
      name: 'Skopje, onto an ordinary day from the 23-hour day',
      place: () => skopje,
      from: '2031-03-30T08:00:00Z', // 10:00, UTC+2
      minutes: 90,
      to: { day: '2031-03-31', start: 10 * H },
      starts: '2031-03-31T08:00:00.000Z',
      ends: '2031-03-31T09:30:00.000Z',
    },
    {
      name: 'New York, onto the day the clocks go forward (9 March 2031)',
      place: () => newYork,
      from: '2031-03-08T14:00:00Z', // 09:00, UTC-5
      minutes: 60,
      to: { day: '2031-03-09', start: 9 * H },
      starts: '2031-03-09T13:00:00.000Z', // 09:00, UTC-4
      ends: '2031-03-09T14:00:00.000Z',
    },
    {
      name: 'New York, from the night the clocks go back (2 November 2031, 01:00 comes twice)',
      place: () => newYork,
      from: '2031-11-02T04:30:00Z', // 00:30 EDT
      minutes: 180,
      to: { day: '2031-11-03', start: 30 },
      starts: '2031-11-03T05:30:00.000Z', // 00:30 EST
      ends: '2031-11-03T08:30:00.000Z',
    },
  ])('$name: the length is kept', async ({ place, from, minutes, to, starts, ends }) => {
    const here = place();
    const p = await provider(here);
    const id = await visit(here, p, { startsAt: from, minutes });
    expect((await move(here, id, { providerId: p, ...to })).ok).toBe(true);
    const stored = await row(id);
    expect(iso(stored.starts_at)).toBe(starts);
    expect(iso(stored.ends_at)).toBe(ends);
  });
});

describe('what a move writes and keeps (acceptance 2)', () => {
  it('a confirmed visit is booked again with no confirmation; the rest of the row stays', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p, {
      status: 'confirmed',
      confirmedAt: '2031-03-02T10:00:00Z',
      confirmedVia: 'staff',
    });
    const before = await row(id);
    await move(skopje, id, { providerId: p, start: 14 * H });
    const after = await row(id);
    expect(after).toMatchObject({
      status: 'booked',
      confirmed_at: null,
      confirmed_via: null,
      title: 'Checkup',
      patient_id: before.patient_id,
      treatment_type_id: before.treatment_type_id,
      created_by: creatorId,
      source: 'staff',
    });
    expect(iso(after.created_at)).toBe(iso(before.created_at));
    expect(iso(after.updated_at)).toBe(NOW.toISOString());
  });

  it('a booked visit is booked still', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    await move(skopje, id, { providerId: p, start: 14 * H });
    expect((await row(id)).status).toBe('booked');
  });
});

describe('the chair is re-checked as a booking does (acceptance 3)', () => {
  it('a move onto another visit of the provider is an overlap, nothing written, no hook', async () => {
    const p = await provider(skopje);
    await visit(skopje, p);
    const id = await visit(skopje, p, {
      patientId: skopje.marko,
      startsAt: '2031-03-03T13:00:00Z',
    });
    const before = await row(id);
    const emit = hook();
    expect(await move(skopje, id, { providerId: p, start: 12 * H + 15 }, emit)).toEqual({
      ok: false,
      code: 'overlap',
    });
    await expectUntouched(id, before);
    expect(emit).not.toHaveBeenCalled();
  });

  it('with anyway it moves, with overlap_ok true', async () => {
    const p = await provider(skopje);
    await visit(skopje, p);
    const id = await visit(skopje, p, {
      patientId: skopje.marko,
      startsAt: '2031-03-03T13:00:00Z',
    });
    expect((await move(skopje, id, { providerId: p, start: 12 * H + 15, anyway: true })).ok).toBe(
      true,
    );
    expect((await row(id)).overlap_ok).toBe(true);
  });

  it('with anyway over no clash, overlap_ok is false', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    expect((await move(skopje, id, { providerId: p, start: 15 * H, anyway: true })).ok).toBe(true);
    expect((await row(id)).overlap_ok).toBe(false);
  });

  it('a visit that was booked anyway, moved to a free place, loses overlap_ok', async () => {
    const p = await provider(skopje);
    await visit(skopje, p);
    const id = await visit(skopje, p, {
      patientId: skopje.marko,
      startsAt: '2031-03-03T11:15:00Z',
      overlapOk: true,
    });
    expect((await move(skopje, id, { providerId: p, start: 16 * H })).ok).toBe(true);
    expect((await row(id)).overlap_ok).toBe(false);
  });

  it('a visit booked anyway, moved over a clash without anyway, is an overlap (the flag is no permission)', async () => {
    const p = await provider(skopje);
    await visit(skopje, p);
    const id = await visit(skopje, p, {
      patientId: skopje.marko,
      startsAt: '2031-03-03T11:15:00Z',
      overlapOk: true,
    });
    expect(await move(skopje, id, { providerId: p, start: 12 * H + 20 })).toEqual({
      ok: false,
      code: 'overlap',
    });
  });

  it('back to back is no overlap, on either side', async () => {
    const p = await provider(skopje);
    await visit(skopje, p); // 12:00 to 12:30
    const after = await visit(skopje, p, {
      patientId: skopje.marko,
      startsAt: '2031-03-03T15:00:00Z',
    });
    const before = await visit(skopje, p, {
      patientId: skopje.marko,
      startsAt: '2031-03-03T16:00:00Z',
    });
    expect((await move(skopje, after, { providerId: p, start: 12 * H + 30 })).ok).toBe(true);
    expect((await move(skopje, before, { providerId: p, start: 11 * H + 30 })).ok).toBe(true);
    expect((await row(after)).overlap_ok).toBe(false);
    expect((await row(before)).overlap_ok).toBe(false);
  });

  it('a cancelled visit and a no-show do not hold the chair', async () => {
    const p = await provider(skopje);
    await visit(skopje, p, { status: 'cancelled', cancelledAt: NOON, cancelledBy: 'staff' });
    await visit(skopje, p, { status: 'no_show', patientId: skopje.marko });
    const id = await visit(skopje, p, { startsAt: '2031-03-03T15:00:00Z' });
    expect((await move(skopje, id, { providerId: p, start: 12 * H })).ok).toBe(true);
  });
});

describe('what a move refuses writes nothing and calls no hook (acceptance 4)', () => {
  async function refused(
    id: string,
    to: Target,
    code: string,
    place: Place = skopje,
  ): Promise<void> {
    const before = await row(id);
    const emit = hook();
    expect(await move(place, id, to, emit)).toEqual({ ok: false, code });
    await expectUntouched(id, before);
    expect(emit).not.toHaveBeenCalled();
  }

  it('not_found: another clinic’s visit and a visit that is not there', async () => {
    const theirs = await provider(other);
    const id = await visit(other, theirs);
    const p = await provider(skopje);
    await refused(id, { providerId: p, start: 14 * H }, 'not_found');
    const emit = hook();
    expect(await move(skopje, newId(), { providerId: p, start: 14 * H }, emit)).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    ['arrived', {}],
    ['completed', { completedAt: NOON }],
    ['cancelled', { cancelledAt: NOON, cancelledBy: 'staff' }],
    ['no_show', {}],
  ])('not_movable: a visit that is %s', async (status, extra) => {
    const p = await provider(skopje);
    const id = await visit(skopje, p, { status, ...extra });
    await refused(id, { providerId: p, start: 14 * H }, 'not_movable');
  });

  it('provider_not_bookable: an inactive provider, and another clinic’s', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    await refused(
      id,
      { providerId: await provider(skopje, false), start: 14 * H },
      'provider_not_bookable',
    );
    await refused(
      id,
      { providerId: await provider(other), start: 14 * H },
      'provider_not_bookable',
    );
    await refused(id, { providerId: newId(), start: 14 * H }, 'provider_not_bookable');
  });

  it.each(['archived', 'deceased'] as const)('patient_not_bookable: a %s patient', async (kind) => {
    const p = await provider(skopje);
    const id = await visit(skopje, p, { patientId: skopje[kind] });
    await refused(id, { providerId: p, start: 14 * H }, 'patient_not_bookable');
  });

  it('start_skipped: 02:30 on 30 March 2031 does not exist in Skopje', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    await refused(id, { providerId: p, day: '2031-03-30', start: 2 * H + 30 }, 'start_skipped');
  });

  it('nothing_changed: the same provider at the same start', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    await refused(id, { providerId: p, start: 12 * H }, 'nothing_changed');
  });

  it('already_booked: the patient has another visit with that provider at that start, with or without anyway', async () => {
    const p = await provider(skopje);
    const q = await provider(skopje);
    await visit(skopje, q, { startsAt: '2031-03-03T13:00:00Z' }); // ana, with q, at 14:00
    const id = await visit(skopje, p);
    await refused(id, { providerId: q, start: 14 * H }, 'already_booked');
    await refused(id, { providerId: q, start: 14 * H, anyway: true }, 'already_booked');
  });

  it('a visit of the patient that is cancelled does not make it already_booked', async () => {
    const p = await provider(skopje);
    const q = await provider(skopje);
    await visit(skopje, q, {
      startsAt: '2031-03-03T13:00:00Z',
      status: 'cancelled',
      cancelledAt: NOON,
      cancelledBy: 'staff',
    });
    const id = await visit(skopje, p);
    expect((await move(skopje, id, { providerId: q, start: 14 * H })).ok).toBe(true);
  });
});

describe('the hook and the audit row (acceptance 5)', () => {
  it('the hook fires once per move with moved true and the statuses', async () => {
    const p = await provider(skopje);
    const booked = await visit(skopje, p);
    const confirmed = await visit(skopje, p, {
      status: 'confirmed',
      patientId: skopje.marko,
      startsAt: '2031-03-03T13:00:00Z',
      confirmedAt: NOON,
      confirmedVia: 'staff',
    });
    const emit = hook();
    await move(skopje, booked, { providerId: p, start: 15 * H }, emit);
    await move(skopje, confirmed, { providerId: p, start: 16 * H }, emit);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map(([, event]) => event)).toEqual([
      { appointmentId: booked, from: 'booked', to: 'booked', at: NOW, moved: true },
      { appointmentId: confirmed, from: 'confirmed', to: 'booked', at: NOW, moved: true },
    ]);
  });

  it('a hook that throws rolls the move back', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    const before = await row(id);
    await expect(
      move(skopje, id, { providerId: p, start: 15 * H }, () => Promise.reject(new Error('hook'))),
    ).rejects.toThrow();
    await expectUntouched(id, before);
  });

  it('an unstorable move is an Error', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    await expect(move(skopje, id, { providerId: p, start: 24 * H })).rejects.toThrow();
    await expect(move(skopje, id, { providerId: p, start: 90.5 })).rejects.toThrow();
    await expect(
      move(skopje, id, { providerId: p, day: '2031-02-30', start: 540 }),
    ).rejects.toThrow();
  });
});

/** What the browser sends to the action, with the clinic its frame names. */
const call = (clinic: string, input: unknown) =>
  moveAction(clinic, input as never) as Promise<
    | { ok: true; value: { day: string; providerId: string } }
    | { ok: false; error: { code: string } }
  >;

describe('the action, as every role (acceptance 5, 7)', () => {
  it.each(['owner', 'dentist', 'hygienist', 'front_desk'])(
    'as %s: moves a visit, with one audit row of names and statuses, no value and no other id',
    async (role) => {
      request.cookie = roleUsers[role]!.cookie;
      const p = await provider(skopje);
      const q = await provider(skopje);
      const id = await visit(skopje, p, {
        status: 'confirmed',
        confirmedAt: NOON,
        confirmedVia: 'staff',
      });
      // The id as typed in capitals: the audit row keeps it in one case (E01-T03a).
      const result = await call(skopje.clinic, {
        appointmentId: id.toUpperCase(),
        providerId: q,
        day: '2031-03-04',
        start: '09:30',
      });

      expect(result).toMatchObject({ ok: true, value: { day: '2031-03-04', providerId: q } });
      expect(await row(id)).toMatchObject({ provider_id: q, status: 'booked' });
      const { rows } = await admin.query(
        `select actor_type, actor_id, action, entity_type, entity_id, metadata
           from audit_log where clinic_id = $1 and entity_id = $2`,
        [skopje.clinic, id],
      );
      expect(rows).toEqual([
        {
          actor_type: 'user',
          actor_id: roleUsers[role]!.id,
          action: 'appointment.moved',
          entity_type: 'appointment',
          entity_id: id,
          metadata: {
            fromStatus: 'confirmed',
            toStatus: 'booked',
            fields: ['provider', 'day', 'start'],
          },
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain(q);
      expect(JSON.stringify(rows)).not.toContain(skopje.ana);
      expect(cache.refresh).toHaveBeenCalledOnce();
      expect(cache.revalidatePath).toHaveBeenCalledExactlyOnceWith('/patients');
    },
  );

  it('a refusal writes no audit row; overlap and already_booked bring the day, the others do not', async () => {
    const p = await provider(skopje);
    const q = await provider(skopje);
    await visit(skopje, q, { startsAt: '2031-03-03T13:00:00Z' }); // ana, with q, at 14:00
    await visit(skopje, q, { patientId: skopje.marko, startsAt: '2031-03-03T15:00:00Z' });
    const id = await visit(skopje, p);
    const base = { appointmentId: id, day: DAY };

    expect(await call(skopje.clinic, { ...base, providerId: q, start: '16:15' })).toEqual({
      ok: false,
      error: { code: 'overlap' },
    });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
    expect(await call(skopje.clinic, { ...base, providerId: q, start: '14:00' })).toEqual({
      ok: false,
      error: { code: 'already_booked' },
    });
    expect(cache.refresh).toHaveBeenCalledTimes(2);
    expect(await call(skopje.clinic, { ...base, providerId: p, start: '12:00' })).toEqual({
      ok: false,
      error: { code: 'nothing_changed' },
    });
    expect(await call(skopje.clinic, { ...base, providerId: q, start: '16:15' })).toMatchObject({
      ok: false,
    });
    expect(cache.refresh).toHaveBeenCalledTimes(3);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
    expect(await movedRows(id)).toBe(0);
  });

  it('"anyway" sent as true moves over the overlap; the hidden field is the only form of it', async () => {
    const p = await provider(skopje);
    const q = await provider(skopje);
    await visit(skopje, q, { patientId: skopje.marko, startsAt: '2031-03-03T15:00:00Z' });
    const id = await visit(skopje, p);
    const input = { appointmentId: id, providerId: q, day: DAY, start: '16:15' };
    expect((await call(skopje.clinic, { ...input, anyway: 'false' })).ok).toBe(false);
    expect((await call(skopje.clinic, { ...input, anyway: 'true' })).ok).toBe(true);
    expect((await row(id)).overlap_ok).toBe(true);
  });

  it('input the schema refuses: a bad start, a day that does not exist, a provider that is no id', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    const good = { appointmentId: id, providerId: p, day: DAY, start: '13:00' };
    for (const bad of [
      { start: '9:5' },
      { start: '24:00' },
      { start: '13:00 ' },
      { day: '2031-02-30' },
      { day: '0000-12-31' },
      { providerId: 'not-an-id' },
      { appointmentId: 'not-an-id' },
    ]) {
      expect(await call(skopje.clinic, { ...good, ...bad }), JSON.stringify(bad)).toMatchObject({
        ok: false,
        error: { code: 'invalid_input' },
      });
    }
    expect((await row(id)).provider_id).toBe(p);
    expect(await movedRows(id)).toBe(0);
  });

  it('another clinic’s visit is not found, and naming another clinic is refused before any work', async () => {
    const theirs = await visit(other, await provider(other));
    const p = await provider(skopje);
    const input = { appointmentId: theirs, providerId: p, day: DAY, start: '14:00' };
    expect(await call(skopje.clinic, input)).toEqual({ ok: false, error: { code: 'not_found' } });
    expect((await call(other.clinic, input)).ok).toBe(false);
    expect(await movedRows(theirs)).toBe(0);
  });

  it('a move writes no value to the log', async () => {
    const p = await provider(skopje);
    const q = await provider(skopje);
    const id = await visit(skopje, p);
    const { output, result } = await captureOutput(() =>
      call(skopje.clinic, { appointmentId: id, providerId: q, day: DAY, start: '17:00' }),
    );
    expect(result?.ok).toBe(true);
    expect(output).not.toContain(skopje.ana);
    expect(output).not.toContain('Brezovska');
  });
});

// The races: the waits are seen in pg_locks, the order is fixed by a gate in the middle of one move.

/** True when some backend waits for a row lock, within three seconds (pg_locks, not a sleep). */
async function someoneWaits(): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { rows } = await admin.query(
      `select 1 from pg_locks where not granted and locktype in ('transactionid', 'tuple')`,
    );
    if (rows.length > 0) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return false;
}

function gate() {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    open = done;
  });
  return { promise, open };
}

describe('two writers at once take turns (acceptance 6)', () => {
  it('two moves of one visit: the second waits for the first, then is judged against its place', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    const written = gate();
    const hold = gate();
    const first = hook();
    first.mockImplementationOnce(async () => {
      written.open();
      await hold.promise;
    });
    const one = move(skopje, id, { providerId: p, start: 15 * H }, first);
    await written.promise; // the first is written and holds the appointment's row
    const two = move(skopje, id, { providerId: p, start: 15 * H });
    const waited = await someoneWaits();
    hold.open();
    const [a, b] = await Promise.all([one, two]);

    expect(waited, 'the second waits for the first').toBe(true);
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, code: 'nothing_changed' });
    expect(iso((await row(id)).starts_at)).toBe('2031-03-03T14:00:00.000Z');
  });

  it('two moves of one visit through the action: one moves, the other is judged against it, one audit row', async () => {
    for (let race = 0; race < 4; race += 1) {
      const p = await provider(skopje);
      const id = await visit(skopje, p);
      const input = { appointmentId: id, providerId: p, day: DAY, start: '15:00' };
      const answers = await Promise.all([call(skopje.clinic, input), call(skopje.clinic, input)]);
      expect(
        answers.filter((answer) => answer.ok),
        `race ${race}`,
      ).toHaveLength(1);
      expect(answers.filter((answer) => !answer.ok)).toEqual([
        { ok: false, error: { code: 'nothing_changed' } },
      ]);
      expect(await movedRows(id)).toBe(1);
    }
  });

  it('two visits moved into one provider’s slot at once: one moves, the other is an overlap', async () => {
    for (let race = 0; race < 4; race += 1) {
      const p = await provider(skopje);
      const target = await provider(skopje);
      const first = await visit(skopje, p);
      const second = await visit(skopje, p, {
        patientId: skopje.marko,
        startsAt: '2031-03-03T13:00:00Z',
      });
      const answers = await Promise.all([
        call(skopje.clinic, { appointmentId: first, providerId: target, day: DAY, start: '16:00' }),
        call(skopje.clinic, {
          appointmentId: second,
          providerId: target,
          day: DAY,
          start: '16:15',
        }),
      ]);
      expect(
        answers.filter((answer) => answer.ok),
        `race ${race}`,
      ).toHaveLength(1);
      expect(answers.filter((answer) => !answer.ok)).toEqual([
        { ok: false, error: { code: 'overlap' } },
      ]);
      const held = await count(
        `select count(*) as n from appointments where provider_id = $1 and status = 'booked'`,
        target,
      );
      expect(held).toBe(1);
    }
  });

  it('two moves that cross the same two providers at once both go through (the providers are locked in id order)', async () => {
    for (let race = 0; race < 5; race += 1) {
      const p = await provider(skopje);
      const q = await provider(skopje);
      const x = await visit(skopje, p);
      const y = await visit(skopje, q, { patientId: skopje.marko });
      const answers = await Promise.all([
        call(skopje.clinic, { appointmentId: x, providerId: q, day: DAY, start: '17:00' }),
        call(skopje.clinic, { appointmentId: y, providerId: p, day: DAY, start: '17:00' }),
      ]);
      expect(answers, `race ${race}`).toMatchObject([
        { ok: true, value: { day: DAY, providerId: q } },
        { ok: true, value: { day: DAY, providerId: p } },
      ]);
    }
  });

  it('a move in flight first: a booking of the same slot waits for the provider, then is an overlap', async () => {
    const p = await provider(skopje);
    const q = await provider(skopje);
    const id = await visit(skopje, p);
    const written = gate();
    const hold = gate();
    const emit = hook();
    emit.mockImplementationOnce(async () => {
      written.open();
      await hold.promise;
    });
    const moving = move(skopje, id, { providerId: q, start: 15 * H }, emit);
    await written.promise;
    const booking = withTenant(skopje.clinic, (tx) =>
      scheduling.createAppointment(
        tx,
        {
          patientId: skopje.marko,
          providerId: q,
          treatmentTypeId: skopje.treatment,
          day: DAY,
          startMinute: 15 * H,
          lengthMinutes: 30,
          timeZone: SKOPJE,
          createdBy: creatorId,
          anyway: false,
        },
        NOW,
      ),
    );
    const waited = await someoneWaits();
    hold.open();
    const [moved, booked] = await Promise.all([moving, booking]);

    expect(waited, 'the booking waits for the move').toBe(true);
    expect(moved.ok).toBe(true);
    expect(booked).toEqual({ ok: false, code: 'overlap' });
  });

  it('a booking in flight first: a move into the same slot waits for the provider, then is an overlap', async () => {
    const p = await provider(skopje);
    const q = await provider(skopje);
    const id = await visit(skopje, p);
    const before = await row(id);
    const written = gate();
    const hold = gate();
    const booking = withTenant(skopje.clinic, async (tx) => {
      const booked = await scheduling.createAppointment(
        tx,
        {
          patientId: skopje.marko,
          providerId: q,
          treatmentTypeId: skopje.treatment,
          day: DAY,
          startMinute: 15 * H,
          lengthMinutes: 30,
          timeZone: SKOPJE,
          createdBy: creatorId,
          anyway: false,
        },
        NOW,
      );
      written.open();
      await hold.promise;
      return booked;
    });
    await written.promise;
    const emit = hook();
    const moving = move(skopje, id, { providerId: q, start: 15 * H }, emit);
    const waited = await someoneWaits();
    hold.open();
    const [booked, moved] = await Promise.all([booking, moving]);

    expect(waited, 'the move waits for the booking').toBe(true);
    expect(booked.ok).toBe(true);
    expect(moved).toEqual({ ok: false, code: 'overlap' });
    await expectUntouched(id, before);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('the calendar’s read gives each visit movable (acceptance 8)', () => {
  it('true for a booked and a confirmed visit only, the same as the move accepts', async () => {
    const p = await provider(skopje);
    const statuses = ['booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'];
    const ids: Record<string, string> = {};
    for (const [index, status] of statuses.entries()) {
      ids[status] = await visit(skopje, p, {
        status,
        patientId: skopje.marko,
        startsAt: new Date(Date.parse('2031-03-03T13:00:00Z') + index * 3_600_000).toISOString(),
        confirmedAt: status === 'confirmed' ? NOON : null,
        confirmedVia: status === 'confirmed' ? 'staff' : null,
        cancelledAt: status === 'cancelled' ? NOON : null,
        cancelledBy: status === 'cancelled' ? 'staff' : null,
        completedAt: status === 'completed' ? NOON : null,
      });
    }
    const shown = await withTenant(skopje.clinic, (tx) =>
      scheduling.appointmentsOnDay(tx, DAY, SKOPJE, NOW),
    );
    for (const status of statuses) {
      const found = shown.find((appointment) => appointment.id === ids[status]);
      expect(found?.movable, status).toBe(status === 'booked' || status === 'confirmed');
      expect(found?.movable, status).toBe(scheduling.movable(status));
    }
  });
});

// Added by the tester (E01-T06c): cases the task's list does not name.
describe('tester: the edges of a move', () => {
  it.each(['confirmed', 'arrived', 'completed'])(
    'a %s visit of another patient holds the chair: a move onto it is an overlap, and with anyway sets overlap_ok',
    async (status) => {
      const p = await provider(skopje);
      const blocker = await visit(skopje, p, {
        patientId: skopje.marko,
        startsAt: '2031-03-03T13:00:00Z',
        status,
        confirmedAt: status === 'confirmed' ? NOON : null,
        confirmedVia: status === 'confirmed' ? 'staff' : null,
        completedAt: status === 'completed' ? NOON : null,
      });
      const id = await visit(skopje, p);
      const before = await row(id);
      const emit = hook();
      expect(await move(skopje, id, { providerId: p, start: 14 * H }, emit)).toEqual({
        ok: false,
        code: 'overlap',
      });
      expect(await row(id)).toEqual(before);
      expect(emit).not.toHaveBeenCalled();
      expect((await move(skopje, id, { providerId: p, start: 14 * H, anyway: true })).ok).toBe(
        true,
      );
      expect((await row(id)).overlap_ok).toBe(true);
      expect((await row(blocker)).status).toBe(status);
    },
  );

  it('a visit that overlaps another one booked anyway is an overlap too (the constraint ignores overlap_ok rows, the check does not)', async () => {
    const p = await provider(skopje);
    const already = await visit(skopje, p, {
      patientId: skopje.marko,
      startsAt: '2031-03-03T13:00:00Z',
    });
    await visit(skopje, p, {
      patientId: skopje.archived,
      startsAt: '2031-03-03T13:15:00Z',
      overlapOk: true,
    });
    expect(already).toBeTruthy();
    const id = await visit(skopje, p);
    const before = await row(id);
    expect(await move(skopje, id, { providerId: p, start: 14 * H + 20 })).toEqual({
      ok: false,
      code: 'overlap',
    });
    expect(await row(id)).toEqual(before);
  });

  it('across midnight: 23:45 for 30 minutes ends at 00:15 the next day; 00:00 starts at the local midnight', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p);
    expect((await move(skopje, id, { providerId: p, start: 23 * H + 45 })).ok).toBe(true);
    let stored = await row(id);
    expect(iso(stored.starts_at)).toBe('2031-03-03T22:45:00.000Z');
    expect(iso(stored.ends_at)).toBe('2031-03-03T23:15:00.000Z');
    expect((await move(skopje, id, { providerId: p, day: '2031-03-04', start: 0 })).ok).toBe(true);
    stored = await row(id);
    expect(iso(stored.starts_at)).toBe('2031-03-03T23:00:00.000Z');
    expect(iso(stored.ends_at)).toBe('2031-03-03T23:30:00.000Z');
  });

  // 26 October 2031: 03:00 summer time goes back to 02:00, so 02:30 comes twice in Skopje
  // (00:30Z summer, 01:30Z winter). PostgreSQL reads a typed 02:30 as the second.
  it('the hour the clocks go back: from the first 02:30 to the typed 02:30 is a move of the start; from the second it is nothing_changed', async () => {
    const p = await provider(skopje);
    const first = await visit(skopje, p, { startsAt: '2031-10-26T00:30:00Z' });
    expect(await move(skopje, first, { providerId: p, day: '2031-10-26', start: 150 })).toEqual({
      ok: true,
      from: 'booked',
      fields: ['start'],
    });
    expect(iso((await row(first)).starts_at)).toBe('2031-10-26T01:30:00.000Z');
    expect(await move(skopje, first, { providerId: p, day: '2031-10-26', start: 150 })).toEqual({
      ok: false,
      code: 'nothing_changed',
    });
    expect(await movedRows(first)).toBe(0); // the module writes no audit row, the action does
  });

  it('a visit of 90 minutes that spans the repeated hour keeps its real length when moved into it', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p, { startsAt: '2031-10-27T08:00:00Z', minutes: 90 });
    expect((await move(skopje, id, { providerId: p, day: '2031-10-26', start: 2 * H })).ok).toBe(
      true,
    );
    const stored = await row(id);
    const starts = Date.parse(String(iso(stored.starts_at)));
    const ends = Date.parse(String(iso(stored.ends_at)));
    expect((ends - starts) / 60_000).toBe(90);
  });

  it('a move of a visit away from an inactive provider to an active one is not refused', async () => {
    const gone = await provider(skopje, false);
    const q = await provider(skopje);
    const id = await visit(skopje, gone);
    expect((await move(skopje, id, { providerId: q, start: 12 * H })).ok).toBe(true);
  });

  it('a patient who became deceased after the booking: not movable, nothing written', async () => {
    const p = await provider(skopje);
    const id = await visit(skopje, p, { patientId: skopje.deceased });
    const before = await row(id);
    expect(await move(skopje, id, { providerId: p, start: 15 * H })).toEqual({
      ok: false,
      code: 'patient_not_bookable',
    });
    expect(await row(id)).toEqual(before);
  });
});

describe('tester: a move against a status change of the same visit', () => {
  it.each(['arrive', 'cancel'] as const)(
    'a move and %s at once: the status the person set is the one that stays',
    async (action) => {
      for (let race = 0; race < 6; race += 1) {
        const p = await provider(skopje);
        const q = await provider(skopje);
        const id = await visit(skopje, p);
        const change = withTenant(skopje.clinic, (tx) =>
          scheduling.changeAppointmentStatus(
            tx,
            action === 'cancel'
              ? {
                  appointmentId: id,
                  action: 'cancel',
                  actor: 'staff',
                  timeZone: SKOPJE,
                  cancelledBy: 'staff',
                  reason: null,
                }
              : { appointmentId: id, action: 'arrive', actor: 'staff', timeZone: SKOPJE },
            NOW,
          ),
        );
        const [moved, changed] = await Promise.all([
          move(skopje, id, { providerId: q, start: 15 * H }),
          change,
        ]);
        const stored = await row(id);
        expect(changed.ok, `race ${race}`).toBe(true);
        expect(stored.status, `race ${race}`).toBe(action === 'cancel' ? 'cancelled' : 'arrived');
        if (moved.ok) expect(stored.provider_id).toBe(q);
        else expect(moved).toEqual({ ok: false, code: 'not_movable' });
        if (!moved.ok) expect(stored.provider_id).toBe(p);
      }
    },
  );
});

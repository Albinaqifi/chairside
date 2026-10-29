import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppointmentStatus as changeStatus } from '@/app/(staff)/calendar/appointment-actions';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import type { TenantTransaction } from '@/db/tenant';
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

// E01-T06a: the appointment state machine and its status changes, as the app runs them: the
// scheduling and patients modules in a tenant transaction, as the app role, under Row-Level Security,
// and the real action with a real session for every role (only next/headers and next/cache are
// replaced, as there is no running Next.js). Rows are set up and inspected as the migration role.
// Moments are written and read in UTC and each clinic names its zone, so neither the computer's zone
// nor the database session's plays a part (D-099). Where a case needs two transactions at once, a gate
// in the middle of one fixes the order, and "waits" is seen in the database (pg_locks), never from a
// sleep. Every value is synthetic; the assertions name ids and statuses.

const PASSWORD = 'MARKER-pw-06a1-correct';
/** Monday 3 March 2031, 10:00 UTC: 11:00 in Skopje (winter time, UTC+1). */
const NOW = new Date('2031-03-03T10:00:00Z');
/** Where the visits are: an hour after NOW, so they have not started yet. */
const LATER = '2031-03-03T11:00:00Z';
/** And an hour before NOW: they have started. */
const EARLIER = '2031-03-03T09:00:00Z';
/** EARLIER as a stored moment reads back. */
const EARLIER_ISO = new Date(EARLIER).toISOString();
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
}

let skopje: Place;
let newYork: Place;
let other: Place;
let creatorId: string;
const roleUsers: Record<string, { id: string; cookie: string }> = {};
let strangerCookie: string;

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
  return {
    clinic,
    zone,
    ana: await patient('Ana', 'Brezovska'),
    marko: await patient('Marko', 'Dardha'),
    archived: await patient('Ana', 'Planinska', 'archived'),
    deceased: await patient('Shpëtim', 'Lumi', 'deceased'),
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
    roleUsers[role] = { id, cookie: await signInCookie(email, PASSWORD, `10.56.0.${address}`) };
  }
  // The owner of another clinic: a member of nothing in `skopje`.
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Staff stranger', password: PASSWORD });
  await insertMembership(admin, { clinicId: other.clinic, userId: id, role: 'owner' });
  strangerCookie = await signInCookie(email, PASSWORD, '10.56.0.9');
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => {
  cache.refresh.mockClear();
  cache.revalidatePath.mockClear();
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
  cancelReason?: string | null;
  completedAt?: string | null;
}

/** An appointment written as the migration role. */
async function visit(place: Place, providerId: string, fields: VisitFields = {}): Promise<string> {
  const id = newId();
  await admin.query(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, overlap_ok, source, created_by, confirmed_at, confirmed_via,
                               cancelled_at, cancelled_by, cancel_reason, completed_at)
     values ($1, $2, $3, $4, 'Checkup', $5::timestamptz, $5::timestamptz + make_interval(mins => $6),
             $7, $8, 'staff', $9, $10, $11, $12, $13, $14, $15)`,
    [
      id,
      place.clinic,
      fields.patientId ?? place.ana,
      providerId,
      fields.startsAt ?? LATER,
      fields.minutes ?? 30,
      fields.status ?? 'booked',
      fields.overlapOk ?? false,
      creatorId,
      fields.confirmedAt ?? null,
      fields.confirmedVia ?? null,
      fields.cancelledAt ?? null,
      fields.cancelledBy ?? null,
      fields.cancelReason ?? null,
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

const statusRows = (id: string) =>
  count(
    `select count(*) as n from audit_log where entity_id = $1 and action = 'appointment.status_changed'`,
    id,
  );

type Simple = 'confirm' | 'arrive' | 'complete' | 'no_show' | 'undo_arrival' | 'undo_completion';

/** The change the action builds for one of the actions without extra fields. */
function simple(id: string, action: Simple, zone = SKOPJE): scheduling.StatusChange {
  return { appointmentId: id, action, actor: 'staff', timeZone: zone };
}

function restoreOf(
  tx: TenantTransaction,
  id: string,
  anyway = false,
  zone = SKOPJE,
): scheduling.StatusChange {
  return {
    appointmentId: id,
    action: 'restore',
    actor: 'staff',
    timeZone: zone,
    anyway,
    patientIsActive: async (patientId) =>
      (await patients.patientStatus(tx, patientId)) === 'active',
  };
}

function cancelOf(id: string, reason: string | null, cancelledBy: 'staff' | 'patient' = 'staff') {
  return {
    appointmentId: id,
    action: 'cancel',
    actor: 'staff',
    timeZone: SKOPJE,
    cancelledBy,
    reason,
  } satisfies scheduling.StatusChange;
}

/** The hook as a spy that does nothing, so a test sees how often and with what it fired. */
const hook = () => vi.fn<scheduling.AppointmentChangedHook>(() => Promise.resolve());

/** Runs one change through the module in the clinic's own transaction. */
function run(
  place: Place,
  build: (tx: TenantTransaction) => scheduling.StatusChange,
  emit: scheduling.AppointmentChangedHook,
  now = NOW,
) {
  return withTenant(place.clinic, (tx) =>
    scheduling.changeAppointmentStatus(tx, build(tx), now, emit),
  );
}

describe('every change the table allows writes its columns (acceptance 3, module)', () => {
  const clear = {
    confirmed_at: null,
    confirmed_via: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
    completed_at: null,
  };
  const cases: {
    name: string;
    start: VisitFields;
    build: (id: string, tx: TenantTransaction) => scheduling.StatusChange;
    to: string;
    stored: Record<string, unknown>;
  }[] = [
    {
      name: 'confirm',
      start: { status: 'booked' },
      build: (id) => simple(id, 'confirm'),
      to: 'confirmed',
      stored: { ...clear, confirmed_at: NOW.toISOString(), confirmed_via: 'staff' },
    },
    {
      name: 'arrive from confirmed',
      start: { status: 'confirmed', confirmedAt: EARLIER, confirmedVia: 'link' },
      build: (id) => simple(id, 'arrive'),
      to: 'arrived',
      stored: { ...clear, confirmed_at: EARLIER_ISO, confirmed_via: 'link' },
    },
    {
      name: 'complete from arrived',
      start: { status: 'arrived' },
      build: (id) => simple(id, 'complete'),
      to: 'completed',
      stored: { ...clear, completed_at: NOW.toISOString() },
    },
    {
      name: 'no_show of a visit that has started',
      start: { status: 'booked', startsAt: EARLIER },
      build: (id) => simple(id, 'no_show'),
      to: 'no_show',
      stored: clear,
    },
    {
      name: 'cancel by the desk, with a reason',
      start: { status: 'confirmed', confirmedAt: EARLIER, confirmedVia: 'staff' },
      build: (id) => cancelOf(id, '  Rang to cancel  '),
      to: 'cancelled',
      stored: {
        confirmed_at: EARLIER_ISO,
        confirmed_via: 'staff',
        cancelled_at: NOW.toISOString(),
        cancelled_by: 'staff',
        cancel_reason: 'Rang to cancel',
        completed_at: null,
      },
    },
    {
      name: 'cancel for the patient, no reason',
      start: { status: 'booked' },
      build: (id) => cancelOf(id, '   ', 'patient'),
      to: 'cancelled',
      stored: {
        ...clear,
        cancelled_at: NOW.toISOString(),
        cancelled_by: 'patient',
        cancel_reason: null,
      },
    },
    {
      name: 'undo an arrival that was confirmed',
      start: { status: 'arrived', confirmedAt: EARLIER, confirmedVia: 'staff' },
      build: (id) => simple(id, 'undo_arrival'),
      to: 'confirmed',
      stored: { ...clear, confirmed_at: EARLIER_ISO, confirmed_via: 'staff' },
    },
    {
      name: 'undo an arrival that was not confirmed',
      start: { status: 'arrived' },
      build: (id) => simple(id, 'undo_arrival'),
      to: 'booked',
      stored: clear,
    },
    {
      name: 'undo a completion of the same day',
      start: { status: 'completed', completedAt: '2031-03-03T08:30:00Z' },
      build: (id) => simple(id, 'undo_completion'),
      to: 'arrived',
      stored: clear,
    },
    {
      name: 'restore a cancelled visit: the confirmation and the cancel columns cleared',
      start: {
        status: 'cancelled',
        confirmedAt: EARLIER,
        confirmedVia: 'link',
        cancelledAt: EARLIER,
        cancelledBy: 'patient',
        cancelReason: 'Away that week',
      },
      build: (id, tx) => restoreOf(tx, id),
      to: 'booked',
      stored: clear,
    },
    {
      name: 'restore a no-show',
      start: { status: 'no_show', startsAt: EARLIER },
      build: (id, tx) => restoreOf(tx, id),
      to: 'booked',
      stored: clear,
    },
  ];

  it.each(cases)('$name', async ({ start, build, to, stored }) => {
    const providerId = await provider(skopje);
    const id = await visit(skopje, providerId, start);
    const before = (await row(id)).status as string;
    const emit = hook();
    const result = await run(skopje, (tx) => build(id, tx), emit);

    expect(result).toEqual({ ok: true, from: before, to });
    const after = await row(id);
    expect(after.status).toBe(to);
    expect(iso(after.updated_at)).toBe(NOW.toISOString());
    expect(
      Object.fromEntries(Object.keys(stored).map((column) => [column, iso(after[column])])),
    ).toEqual(stored);
    expect(emit).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      appointmentId: id,
      from: before,
      to,
      at: NOW,
    });
  });

  it('a patient confirming through the module is confirmed by the link', async () => {
    const id = await visit(skopje, await provider(skopje));
    const result = await run(
      skopje,
      () => ({ appointmentId: id, action: 'confirm', actor: 'patient', timeZone: SKOPJE }),
      hook(),
    );
    expect(result).toEqual({ ok: true, from: 'booked', to: 'confirmed' });
    expect(await row(id)).toMatchObject({ confirmed_via: 'link' });
  });

  it('a patient cancelling is refused after the cut-off and allowed before it', async () => {
    const providerId = await provider(skopje);
    const id = await visit(skopje, providerId);
    const asPatient = (beforeCutoff: boolean) =>
      run(
        skopje,
        () => ({ ...cancelOf(id, null, 'patient'), actor: 'patient', beforeCutoff }),
        hook(),
      );
    expect(await asPatient(false)).toEqual({ ok: false, code: 'not_allowed' });
    expect((await row(id)).status).toBe('booked');
    expect(await asPatient(true)).toEqual({ ok: true, from: 'booked', to: 'cancelled' });
  });
});

describe('no-show only after the start (acceptance 2)', () => {
  it('one millisecond before the start it is too_early; at the start exactly it is a no-show', async () => {
    const providerId = await provider(skopje);
    const id = await visit(skopje, providerId, { startsAt: LATER });
    const start = new Date(LATER);
    const emit = hook();
    expect(
      await run(skopje, () => simple(id, 'no_show'), emit, new Date(start.getTime() - 1)),
    ).toEqual({ ok: false, code: 'too_early' });
    expect((await row(id)).status).toBe('booked');
    expect(emit).not.toHaveBeenCalled();

    expect(await run(skopje, () => simple(id, 'no_show'), emit, start)).toEqual({
      ok: true,
      from: 'booked',
      to: 'no_show',
    });
    expect((await row(id)).status).toBe('no_show');
    expect(emit).toHaveBeenCalledOnce();
  });
});

describe('an undone completion is of the same day in the clinic zone', () => {
  it('Skopje: 23:30 and 00:30 are one UTC day and two clinic days: refused; 23:30 and 23:50: allowed', async () => {
    const providerId = await provider(skopje);
    const id = await visit(skopje, providerId, {
      status: 'completed',
      completedAt: '2031-03-03T22:30:00Z',
    });
    expect(
      await run(
        skopje,
        () => simple(id, 'undo_completion'),
        hook(),
        new Date('2031-03-03T23:30:00Z'),
      ),
    ).toEqual({ ok: false, code: 'not_allowed' });
    expect(
      await run(
        skopje,
        () => simple(id, 'undo_completion'),
        hook(),
        new Date('2031-03-03T22:50:00Z'),
      ),
    ).toEqual({ ok: true, from: 'completed', to: 'arrived' });
  });

  it('New York: 18:30 and 20:00 local are two UTC days and one clinic day: allowed', async () => {
    const providerId = await provider(newYork);
    const id = await visit(newYork, providerId, {
      status: 'completed',
      completedAt: '2031-03-03T23:30:00Z',
    });
    expect(
      await run(
        newYork,
        () => simple(id, 'undo_completion', NEW_YORK),
        hook(),
        new Date('2031-03-04T01:00:00Z'),
      ),
    ).toEqual({ ok: true, from: 'completed', to: 'arrived' });
    // And the next local day is no longer the same day.
    const next = await visit(newYork, providerId, {
      status: 'completed',
      completedAt: '2031-03-03T23:30:00Z',
      startsAt: '2031-03-03T15:00:00Z',
    });
    expect(
      await run(
        newYork,
        () => simple(next, 'undo_completion', NEW_YORK),
        hook(),
        new Date('2031-03-04T06:00:00Z'),
      ),
    ).toEqual({ ok: false, code: 'not_allowed' });
  });
});

describe('the cancel reason', () => {
  it('a reason over 200 characters after trimming is an Error, with nothing written', async () => {
    const id = await visit(skopje, await provider(skopje));
    await expect(run(skopje, () => cancelOf(id, `  ${'x'.repeat(201)}  `), hook())).rejects.toThrow(
      'too long',
    );
    expect((await row(id)).status).toBe('booked');
    // Exactly 200 is kept whole.
    const kept = await run(skopje, () => cancelOf(id, 'x'.repeat(200)), hook());
    expect(kept.ok).toBe(true);
    expect((await row(id)).cancel_reason).toBe('x'.repeat(200));
  });
});

describe('the hook fires once per successful change and for nothing else (acceptance 4)', () => {
  it('not for a refusal of any kind', async () => {
    const providerId = await provider(skopje);
    const emit = hook();
    const booked = await visit(skopje, providerId);
    const cancelled = await visit(skopje, providerId, { status: 'cancelled', startsAt: EARLIER });
    const missing = newId();
    const refusals = await Promise.all([
      run(skopje, () => simple(booked, 'undo_arrival'), emit), // not_allowed
      run(skopje, () => simple(booked, 'no_show'), emit), // too_early
      run(skopje, () => simple(missing, 'confirm'), emit), // not_found
      run(skopje, () => simple(cancelled, 'arrive'), emit), // not_allowed
      run(skopje, (tx) => restoreOf(tx, booked), emit), // not_allowed
    ]);
    expect(refusals).toEqual([
      { ok: false, code: 'not_allowed' },
      { ok: false, code: 'too_early' },
      { ok: false, code: 'not_found' },
      { ok: false, code: 'not_allowed' },
      { ok: false, code: 'not_allowed' },
    ]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('a hook that throws rolls the whole change back: the write is undone', async () => {
    const id = await visit(skopje, await provider(skopje));
    const failing = vi.fn<scheduling.AppointmentChangedHook>(() =>
      Promise.reject(new Error('hook failed')),
    );
    await expect(run(skopje, () => simple(id, 'arrive'), failing)).rejects.toThrow();
    expect(failing).toHaveBeenCalledOnce();
    const stored = await row(id);
    expect(stored.status).toBe('booked');
    expect(stored.updated_at).not.toEqual(NOW);
  });
});

describe('restoring re-checks the chair (acceptance 5)', () => {
  const cancelled = (providerId: string, fields: VisitFields = {}) =>
    visit(skopje, providerId, { status: 'cancelled', ...fields });

  it('another visit holds the chair: overlap, nothing written, no hook', async () => {
    const providerId = await provider(skopje);
    const id = await cancelled(providerId);
    await visit(skopje, providerId, { patientId: skopje.marko, startsAt: '2031-03-03T11:15:00Z' });
    const emit = hook();
    expect(await run(skopje, (tx) => restoreOf(tx, id), emit)).toEqual({
      ok: false,
      code: 'overlap',
    });
    expect((await row(id)).status).toBe('cancelled');
    expect(emit).not.toHaveBeenCalled();
  });

  it('with "anyway" it is restored with overlap_ok', async () => {
    const providerId = await provider(skopje);
    const id = await cancelled(providerId);
    await visit(skopje, providerId, { patientId: skopje.marko, startsAt: '2031-03-03T11:15:00Z' });
    expect(await run(skopje, (tx) => restoreOf(tx, id, true), hook())).toEqual({
      ok: true,
      from: 'cancelled',
      to: 'booked',
    });
    expect(await row(id)).toMatchObject({ status: 'booked', overlap_ok: true });
  });

  it('a visit that was overlap_ok whose clash has gone is restored with overlap_ok false, anyway or not', async () => {
    const providerId = await provider(skopje);
    for (const anyway of [false, true]) {
      const id = await cancelled(providerId, {
        overlapOk: true,
        startsAt: anyway ? EARLIER : LATER,
      });
      expect(await run(skopje, (tx) => restoreOf(tx, id, anyway), hook())).toEqual({
        ok: true,
        from: 'cancelled',
        to: 'booked',
      });
      expect(await row(id)).toMatchObject({ status: 'booked', overlap_ok: false });
    }
  });

  it('a clash with a visit that no longer holds the chair is no clash', async () => {
    const providerId = await provider(skopje);
    const id = await cancelled(providerId);
    await visit(skopje, providerId, {
      patientId: skopje.marko,
      status: 'no_show',
      startsAt: '2031-03-03T11:15:00Z',
    });
    expect((await run(skopje, (tx) => restoreOf(tx, id), hook())).ok).toBe(true);
    expect(await row(id)).toMatchObject({ overlap_ok: false });
  });

  it('the same visit booked again: already_booked, with or without "anyway"', async () => {
    const providerId = await provider(skopje);
    const id = await cancelled(providerId);
    await visit(skopje, providerId); // the same patient, the same start
    for (const anyway of [false, true]) {
      expect(await run(skopje, (tx) => restoreOf(tx, id, anyway), hook())).toEqual({
        ok: false,
        code: 'already_booked',
      });
    }
    expect((await row(id)).status).toBe('cancelled');
  });

  it('an inactive provider: provider_not_bookable', async () => {
    const providerId = await provider(skopje, false);
    const id = await cancelled(providerId);
    expect(await run(skopje, (tx) => restoreOf(tx, id), hook())).toEqual({
      ok: false,
      code: 'provider_not_bookable',
    });
    expect((await row(id)).status).toBe('cancelled');
  });

  it.each([
    { what: 'archived', patient: () => skopje.archived },
    { what: 'deceased', patient: () => skopje.deceased },
  ])('a patient who is $what: patient_not_bookable', async ({ patient }) => {
    const providerId = await provider(skopje);
    const id = await cancelled(providerId, { patientId: patient() });
    const emit = hook();
    expect(await run(skopje, (tx) => restoreOf(tx, id), emit)).toEqual({
      ok: false,
      code: 'patient_not_bookable',
    });
    expect((await row(id)).status).toBe('cancelled');
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('two changes at once take turns (acceptance 6)', () => {
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

  function deferred() {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('a cancel in flight first: the arrive waits, then is not_allowed; one write, the hook once', async () => {
    const id = await visit(skopje, await provider(skopje));
    const written = deferred();
    const gate = deferred();
    const emit = hook();
    emit.mockImplementationOnce(async () => {
      written.resolve();
      await gate.promise;
    });
    const cancel = run(skopje, () => cancelOf(id, null), emit);
    await written.promise; // the cancel is written and holds the appointment's row
    const arrive = run(skopje, () => simple(id, 'arrive'), emit);
    const waited = await someoneWaits();
    gate.resolve();
    const [first, second] = await Promise.all([cancel, arrive]);

    expect(waited, 'the arrive waits for the cancel').toBe(true);
    expect(first).toEqual({ ok: true, from: 'booked', to: 'cancelled' });
    expect(second).toEqual({ ok: false, code: 'not_allowed' });
    expect((await row(id)).status).toBe('cancelled');
    expect(emit).toHaveBeenCalledOnce();
  });

  it('a restore in flight first: a booking of the same slot waits for the provider, then sees the visit', async () => {
    const providerId = await provider(skopje);
    const id = await visit(skopje, providerId, { status: 'cancelled' });
    const written = deferred();
    const gate = deferred();
    const emit = hook();
    emit.mockImplementationOnce(async () => {
      written.resolve();
      await gate.promise;
    });
    const restore = run(skopje, (tx) => restoreOf(tx, id), emit);
    await written.promise;
    const treatment = newId();
    await insertRow(admin, 'treatment_types', {
      id: treatment,
      clinic_id: skopje.clinic,
      name: 'Checkup',
      default_duration_min: 30,
    });
    const booking = withTenant(skopje.clinic, (tx) =>
      scheduling.createAppointment(
        tx,
        {
          patientId: skopje.marko,
          providerId,
          treatmentTypeId: treatment,
          day: '2031-03-03',
          startMinute: 12 * 60,
          lengthMinutes: 30,
          timeZone: SKOPJE,
          createdBy: creatorId,
          anyway: false,
        },
        NOW,
      ),
    );
    const waited = await someoneWaits();
    gate.resolve();
    const [restored, booked] = await Promise.all([restore, booking]);

    expect(waited, 'the booking waits for the restore').toBe(true);
    expect(restored.ok).toBe(true);
    expect(booked).toEqual({ ok: false, code: 'overlap' });
  });

  it('a booking in flight first: the restore of the same slot waits for the provider, then is an overlap', async () => {
    const providerId = await provider(skopje);
    const id = await visit(skopje, providerId, { status: 'cancelled' });
    const treatment = newId();
    await insertRow(admin, 'treatment_types', {
      id: treatment,
      clinic_id: skopje.clinic,
      name: 'Checkup',
      default_duration_min: 30,
    });
    const written = deferred();
    const gate = deferred();
    const booking = withTenant(skopje.clinic, async (tx) => {
      const booked = await scheduling.createAppointment(
        tx,
        {
          patientId: skopje.marko,
          providerId,
          treatmentTypeId: treatment,
          day: '2031-03-03',
          startMinute: 12 * 60,
          lengthMinutes: 30,
          timeZone: SKOPJE,
          createdBy: creatorId,
          anyway: false,
        },
        NOW,
      );
      written.resolve();
      await gate.promise;
      return booked;
    });
    await written.promise;
    const emit = hook();
    const restore = run(skopje, (tx) => restoreOf(tx, id), emit);
    const waited = await someoneWaits();
    gate.resolve();
    const [booked, restored] = await Promise.all([booking, restore]);

    expect(waited, 'the restore waits for the booking').toBe(true);
    expect(booked.ok).toBe(true);
    expect(restored).toEqual({ ok: false, code: 'overlap' });
    expect((await row(id)).status).toBe('cancelled');
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('another clinic’s appointment is not found, for every action (acceptance 7)', () => {
  it.each(['confirm', 'arrive', 'complete', 'no_show', 'undo_arrival', 'undo_completion'] as const)(
    '%s',
    async (action) => {
      const id = await visit(other, await provider(other), { startsAt: EARLIER });
      const emit = hook();
      expect(await run(skopje, () => simple(id, action), emit)).toEqual({
        ok: false,
        code: 'not_found',
      });
      expect((await row(id)).status).toBe('booked');
      expect(emit).not.toHaveBeenCalled();
    },
  );

  it('cancel and restore', async () => {
    const id = await visit(other, await provider(other));
    const emit = hook();
    expect(await run(skopje, () => cancelOf(id, null), emit)).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(await run(skopje, (tx) => restoreOf(tx, id), emit)).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect((await row(id)).status).toBe('booked');
    expect(emit).not.toHaveBeenCalled();
  });
});

/** What the browser sends to the action, with the clinic its frame names. */
const call = (clinic: string, input: unknown) =>
  changeStatus(clinic, input as never) as Promise<
    { ok: true; value: { from: string; to: string } } | { ok: false; error: { code: string } }
  >;

describe('the action, as every role (acceptance 3)', () => {
  it.each(['owner', 'dentist', 'hygienist', 'front_desk'])(
    'as %s: confirms a visit, with one audit row of ids and the two statuses',
    async (role) => {
      request.cookie = roleUsers[role]!.cookie;
      request.clinic = skopje.clinic;
      const id = await visit(skopje, await provider(skopje));
      // The id as typed in capitals: the audit row keeps it in one case (E01-T03a).
      const result = await call(skopje.clinic, {
        appointmentId: id.toUpperCase(),
        action: 'confirm',
      });

      expect(result).toMatchObject({ ok: true, value: { from: 'booked', to: 'confirmed' } });
      expect(await row(id)).toMatchObject({ status: 'confirmed', confirmed_via: 'staff' });
      const { rows } = await admin.query(
        `select actor_type, actor_id, action, entity_type, entity_id, metadata
           from audit_log where clinic_id = $1 and entity_id = $2`,
        [skopje.clinic, id],
      );
      expect(rows).toEqual([
        {
          actor_type: 'user',
          actor_id: roleUsers[role]!.id,
          action: 'appointment.status_changed',
          entity_type: 'appointment',
          entity_id: id,
          metadata: { fromStatus: 'booked', toStatus: 'confirmed' },
        },
      ]);
      expect(cache.refresh).toHaveBeenCalledOnce();
      expect(cache.revalidatePath).toHaveBeenCalledExactlyOnceWith('/patients');
    },
  );

  beforeEach(() => {
    request.cookie = roleUsers['front_desk']!.cookie;
    request.clinic = skopje.clinic;
  });

  it('a cancel with a reason keeps it in the row and out of the audit row and the log', async () => {
    const id = await visit(skopje, await provider(skopje));
    const reason = 'MARKER-reason-06a1 away on holiday';
    const { output, result } = await captureOutput(() =>
      call(skopje.clinic, { appointmentId: id, action: 'cancel', cancelledBy: 'patient', reason }),
    );
    expect(result).toMatchObject({ ok: true, value: { from: 'booked', to: 'cancelled' } });
    expect(await row(id)).toMatchObject({
      status: 'cancelled',
      cancelled_by: 'patient',
      cancel_reason: reason,
    });
    const { rows } = await admin.query('select * from audit_log where entity_id = $1', [id]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('MARKER-reason');
    expect(rows[0]).toMatchObject({ metadata: { fromStatus: 'booked', toStatus: 'cancelled' } });
    expect(output).not.toContain('MARKER-reason');
  });

  it('a reason is trimmed and a blank one is none; one of 201 characters is invalid_input', async () => {
    const providerId = await provider(skopje);
    const blank = await visit(skopje, providerId);
    expect(
      (
        await call(skopje.clinic, {
          appointmentId: blank,
          action: 'cancel',
          cancelledBy: 'staff',
          reason: '  ',
        })
      ).ok,
    ).toBe(true);
    expect((await row(blank)).cancel_reason).toBeNull();
    const long = await visit(skopje, providerId, { startsAt: EARLIER });
    expect(
      await call(skopje.clinic, {
        appointmentId: long,
        action: 'cancel',
        cancelledBy: 'staff',
        reason: 'y'.repeat(201),
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect((await row(long)).status).toBe('booked');
  });

  it.each([
    { what: 'an unknown action', input: (id: string) => ({ appointmentId: id, action: 'delete' }) },
    {
      what: 'a cancel without who cancelled',
      input: (id: string) => ({ appointmentId: id, action: 'cancel' }),
    },
    { what: 'an id that is no id', input: () => ({ appointmentId: 'nope', action: 'arrive' }) },
  ])('$what: invalid_input, nothing written', async ({ input }) => {
    const id = await visit(skopje, await provider(skopje));
    expect(await call(skopje.clinic, input(id))).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(await statusRows(id)).toBe(0);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it('a refusal writes no audit row and brings no day, but an overlap and the same visit do', async () => {
    const providerId = await provider(skopje);
    const booked = await visit(skopje, providerId);
    expect(await call(skopje.clinic, { appointmentId: booked, action: 'undo_arrival' })).toEqual({
      ok: false,
      error: { code: 'not_allowed' },
    });
    expect(await call(skopje.clinic, { appointmentId: booked, action: 'no_show' })).toEqual({
      ok: false,
      error: { code: 'too_early' },
    });
    expect(await call(skopje.clinic, { appointmentId: newId(), action: 'arrive' })).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await statusRows(booked)).toBe(0);
    expect(cache.refresh).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();

    // A restore over a visit that holds the chair: the day comes back so the warning names it.
    const gone = await visit(skopje, providerId, {
      status: 'cancelled',
      patientId: skopje.marko,
      startsAt: '2031-03-03T11:10:00Z',
    });
    expect(await call(skopje.clinic, { appointmentId: gone, action: 'restore' })).toEqual({
      ok: false,
      error: { code: 'overlap' },
    });
    expect(cache.refresh).toHaveBeenCalledOnce();
    cache.refresh.mockClear();
    const same = await visit(skopje, providerId, { status: 'cancelled', startsAt: LATER });
    expect(await call(skopje.clinic, { appointmentId: same, action: 'restore' })).toEqual({
      ok: false,
      error: { code: 'already_booked' },
    });
    expect(cache.refresh).toHaveBeenCalledOnce();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
    expect(await statusRows(gone)).toBe(0);
    expect(await statusRows(same)).toBe(0);
    expect((await row(gone)).status).toBe('cancelled');
  });

  it('a restore: "anyway" books over a clash, an archived patient is refused', async () => {
    const providerId = await provider(skopje);
    await visit(skopje, providerId, { patientId: skopje.marko, startsAt: '2031-03-03T11:10:00Z' });
    const clashing = await visit(skopje, providerId, { status: 'cancelled' });
    expect(
      await call(skopje.clinic, { appointmentId: clashing, action: 'restore', anyway: true }),
    ).toMatchObject({ ok: true, value: { from: 'cancelled', to: 'booked' } });
    expect(await row(clashing)).toMatchObject({ status: 'booked', overlap_ok: true });
    expect(await statusRows(clashing)).toBe(1);

    const archived = await visit(skopje, await provider(skopje), {
      status: 'no_show',
      patientId: skopje.archived,
      startsAt: EARLIER,
    });
    expect(await call(skopje.clinic, { appointmentId: archived, action: 'restore' })).toEqual({
      ok: false,
      error: { code: 'patient_not_bookable' },
    });
    expect(await statusRows(archived)).toBe(0);
  });

  it('another clinic’s owner changing this clinic’s appointment: not_found, nothing written', async () => {
    request.cookie = strangerCookie;
    request.clinic = other.clinic;
    const id = await visit(skopje, await provider(skopje));
    expect(await call(other.clinic, { appointmentId: id, action: 'confirm' })).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    // And naming this clinic is refused before any work: the owner is no member of it.
    expect((await call(skopje.clinic, { appointmentId: id, action: 'confirm' })).ok).toBe(false);
    expect((await row(id)).status).toBe('booked');
    expect(await statusRows(id)).toBe(0);
  });

  it('a cancel and an arrive at once: one wins, the other is not_allowed, one audit row', async () => {
    for (let race = 0; race < 5; race += 1) {
      const id = await visit(skopje, await provider(skopje));
      const [cancel, arrive] = await Promise.all([
        call(skopje.clinic, { appointmentId: id, action: 'cancel', cancelledBy: 'staff' }),
        call(skopje.clinic, { appointmentId: id, action: 'arrive' }),
      ]);
      const wins = [cancel, arrive].filter((answer) => answer.ok);
      expect(wins, `race ${race}`).toHaveLength(1);
      expect([cancel, arrive].filter((answer) => !answer.ok)).toEqual([
        { ok: false, error: { code: 'not_allowed' } },
      ]);
      expect((await row(id)).status).toBe(cancel.ok ? 'cancelled' : 'arrived');
      expect(await statusRows(id)).toBe(1);
    }
  });

  it('two cancels at once: one wins, the other is not_allowed, one audit row', async () => {
    const id = await visit(skopje, await provider(skopje));
    const cancel = () =>
      call(skopje.clinic, { appointmentId: id, action: 'cancel', cancelledBy: 'staff' });
    const answers = await Promise.all([cancel(), cancel()]);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok)).toEqual([
      { ok: false, error: { code: 'not_allowed' } },
    ]);
    expect(await statusRows(id)).toBe(1);
  });
});

// Added by the tester (E01-T06a): the races and days the builder's cases leave out. Same helpers.

/** True when some backend waits for a row lock, within three seconds (pg_locks, not a sleep). */
async function lockWaiter(): Promise<boolean> {
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

describe('tester: two restores at once take turns on the provider', () => {
  beforeEach(() => {
    request.cookie = roleUsers['front_desk']!.cookie;
    request.clinic = skopje.clinic;
  });

  it('two cancelled visits that overlap, restored at once: one is booked, the other is an overlap', async () => {
    for (let race = 0; race < 4; race += 1) {
      const providerId = await provider(skopje);
      const first = await visit(skopje, providerId, { status: 'cancelled' });
      const second = await visit(skopje, providerId, {
        status: 'cancelled',
        patientId: skopje.marko,
        startsAt: '2031-03-03T11:15:00Z',
      });
      const answers = await Promise.all([
        call(skopje.clinic, { appointmentId: first, action: 'restore' }),
        call(skopje.clinic, { appointmentId: second, action: 'restore' }),
      ]);
      expect(
        answers.filter((answer) => answer.ok),
        `race ${race}`,
      ).toHaveLength(1);
      expect(answers.filter((answer) => !answer.ok)).toEqual([
        { ok: false, error: { code: 'overlap' } },
      ]);
      const held = await count(
        `select count(*) as n from appointments where id = any($1) and status = 'booked'`,
        [first, second],
      );
      expect(held).toBe(1);
      expect((await statusRows(first)) + (await statusRows(second))).toBe(1);
    }
  });

  it('the same visit cancelled twice, restored at once: one is booked, the other is already_booked', async () => {
    for (let race = 0; race < 4; race += 1) {
      const providerId = await provider(skopje);
      const first = await visit(skopje, providerId, { status: 'cancelled' });
      const second = await visit(skopje, providerId, { status: 'no_show' });
      const answers = await Promise.all([
        call(skopje.clinic, { appointmentId: first, action: 'restore', anyway: true }),
        call(skopje.clinic, { appointmentId: second, action: 'restore', anyway: true }),
      ]);
      expect(
        answers.filter((answer) => answer.ok),
        `race ${race}`,
      ).toHaveLength(1);
      expect(answers.filter((answer) => !answer.ok)).toEqual([
        { ok: false, error: { code: 'already_booked' } },
      ]);
    }
  });

  it('the same visit restored twice at once: one wins, the other is not_allowed', async () => {
    const id = await visit(skopje, await provider(skopje), { status: 'cancelled' });
    const answers = await Promise.all([
      call(skopje.clinic, { appointmentId: id, action: 'restore' }),
      call(skopje.clinic, { appointmentId: id, action: 'restore' }),
    ]);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok)).toEqual([
      { ok: false, error: { code: 'not_allowed' } },
    ]);
    expect(await statusRows(id)).toBe(1);
  });
});

describe('tester: a restore and archiving the patient take turns', () => {
  async function racePatient(): Promise<string> {
    const id = newId();
    await insertRow(admin, 'patients', {
      id,
      clinic_id: skopje.clinic,
      first_name: 'Race',
      last_name: 'Patient',
      language: 'en',
      status: 'active',
    });
    return id;
  }

  const archive = (tx: TenantTransaction, patientId: string) =>
    patients.update(
      tx,
      patientId,
      {
        firstName: 'Race',
        lastName: 'Patient',
        dateOfBirth: null,
        phone: null,
        email: null,
        language: 'en',
        guardianName: null,
        notes: '',
        status: 'archived',
      },
      NOW,
      async () => (await scheduling.patientVisitsAhead(tx, patientId, NOW)).length > 0,
    );

  it('a restore in flight first: the archive waits, then finds the restored visit ahead', async () => {
    const patientId = await racePatient();
    const id = await visit(skopje, await provider(skopje), { status: 'cancelled', patientId });
    const written = gate();
    const hold = gate();
    const emit = hook();
    emit.mockImplementationOnce(async () => {
      written.open();
      await hold.promise;
    });
    const restore = run(skopje, (tx) => restoreOf(tx, id), emit);
    await written.promise;
    const archiving = withTenant(skopje.clinic, (tx) => archive(tx, patientId));
    const waited = await lockWaiter();
    hold.open();
    const [restored, archived] = await Promise.all([restore, archiving]);

    expect(waited, 'the archive waits for the restore').toBe(true);
    expect(restored.ok).toBe(true);
    expect(archived).toEqual({ ok: false, code: 'visits_ahead' });
    const { rows } = await admin.query('select status from patients where id = $1', [patientId]);
    expect(rows[0]).toEqual({ status: 'active' });
  });

  it('an archive in flight first: the restore waits, then is patient_not_bookable', async () => {
    const patientId = await racePatient();
    const id = await visit(skopje, await provider(skopje), { status: 'cancelled', patientId });
    const written = gate();
    const hold = gate();
    const archiving = withTenant(skopje.clinic, async (tx) => {
      const archived = await archive(tx, patientId);
      written.open();
      await hold.promise;
      return archived;
    });
    await written.promise;
    const emit = hook();
    const restore = run(skopje, (tx) => restoreOf(tx, id), emit);
    const waited = await lockWaiter();
    hold.open();
    const [archived, restored] = await Promise.all([archiving, restore]);

    expect(waited, 'the restore waits for the archive').toBe(true);
    expect(archived).toEqual({ ok: true, fields: ['status'] });
    expect(restored).toEqual({ ok: false, code: 'patient_not_bookable' });
    expect((await row(id)).status).toBe('cancelled');
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('tester: the same day across a daylight-saving change', () => {
  it('Skopje, 30 March 2031 (23 hours): completed 00:30, undone at 23:59 is the same day; at midnight is not', async () => {
    const make = async () =>
      visit(skopje, await provider(skopje), {
        status: 'completed',
        completedAt: '2031-03-29T23:30:00Z', // 00:30 on the 30th, before the clocks move
        startsAt: '2031-03-29T22:00:00Z',
      });
    const same = await make();
    expect(
      await run(
        skopje,
        () => simple(same, 'undo_completion'),
        hook(),
        new Date('2031-03-30T21:59:00Z'), // 23:59 local, UTC+2
      ),
    ).toEqual({ ok: true, from: 'completed', to: 'arrived' });
    const next = await make();
    expect(
      await run(
        skopje,
        () => simple(next, 'undo_completion'),
        hook(),
        new Date('2031-03-30T22:00:00Z'), // 00:00 on the 31st
      ),
    ).toEqual({ ok: false, code: 'not_allowed' });
  });

  it('Skopje, 26 October 2031 (25 hours): the day ends at 23:00 UTC', async () => {
    const make = async () =>
      visit(skopje, await provider(skopje), {
        status: 'completed',
        completedAt: '2031-10-25T22:30:00Z', // 00:30 on the 26th, still summer time
        startsAt: '2031-10-25T21:30:00Z',
      });
    const same = await make();
    expect(
      await run(
        skopje,
        () => simple(same, 'undo_completion'),
        hook(),
        new Date('2031-10-26T22:59:00Z'),
      ),
    ).toEqual({ ok: true, from: 'completed', to: 'arrived' });
    const next = await make();
    expect(
      await run(
        skopje,
        () => simple(next, 'undo_completion'),
        hook(),
        new Date('2031-10-26T23:00:00Z'),
      ),
    ).toEqual({ ok: false, code: 'not_allowed' });
  });
});

describe('tester: a walk through the table keeps the columns coherent', () => {
  it('confirm, arrive, undo, complete, undo: the confirmation is kept, the completion cleared', async () => {
    const id = await visit(skopje, await provider(skopje));
    const steps: [Simple, string][] = [
      ['confirm', 'confirmed'],
      ['arrive', 'arrived'],
      ['undo_arrival', 'confirmed'],
      ['arrive', 'arrived'],
      ['complete', 'completed'],
      ['undo_completion', 'arrived'],
      ['complete', 'completed'],
      ['undo_completion', 'arrived'],
      ['undo_arrival', 'confirmed'],
    ];
    for (const [action, to] of steps) {
      const done = await run(skopje, () => simple(id, action), hook());
      expect(done, action).toMatchObject({ ok: true, to });
      const stored = await row(id);
      expect(stored.status).toBe(to);
      expect(stored.confirmed_via, action).toBe('staff');
      expect(iso(stored.confirmed_at), action).toBe(NOW.toISOString());
      expect(stored.completed_at === null, action).toBe(to !== 'completed');
    }
    expect(await row(id)).toMatchObject({ cancelled_at: null, cancelled_by: null });
  });

  it('cancel, restore, cancel again: the restore clears everything, the second cancel has its own', async () => {
    const id = await visit(skopje, await provider(skopje), {
      status: 'confirmed',
      confirmedAt: EARLIER,
      confirmedVia: 'link',
    });
    expect((await run(skopje, () => cancelOf(id, 'first reason'), hook())).ok).toBe(true);
    expect((await run(skopje, (tx) => restoreOf(tx, id), hook())).ok).toBe(true);
    expect(await row(id)).toMatchObject({
      status: 'booked',
      confirmed_at: null,
      confirmed_via: null,
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
    });
    expect((await run(skopje, () => cancelOf(id, null, 'patient'), hook())).ok).toBe(true);
    expect(await row(id)).toMatchObject({ cancelled_by: 'patient', cancel_reason: null });
  });
});

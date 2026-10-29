import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { newId } from '@/lib/ids';
import * as patients from '@/modules/patients';
import * as scheduling from '@/modules/scheduling';
import { insertClinic, migratorPool } from './fixtures';
import { insertProvider, insertRow, insertUser } from './scheduling-fixtures';

// E01-T03b, acceptance 9 and 10: the edit and the booking of one patient take turns on the patient's
// row, and two sends of one new patient at once add them once. Concurrent transactions, as the app
// role under Row-Level Security: two `withTenant` at the same moment, with a gate in the middle of
// one of them so that the order is the test's and not the scheduler's. "Waits" is seen in the
// database (pg_stat_activity: a backend waiting on a lock, in a query on `patients`), never from a
// sleep: the test fails when nothing waits. Rows are set up and inspected as the migration role.
// Every value is synthetic.

const admin = migratorPool();
/** Wednesday 2 March 2033, 08:00 UTC: every visit these tests book is on the next day. */
const NOW = new Date('2033-03-02T08:00:00Z');
const BOOK_DAY = '2033-03-03';

let clinic: string;
let treatment: string;
let userId: string;

beforeAll(async () => {
  clinic = await insertClinic(admin);
  treatment = newId();
  await insertRow(admin, 'treatment_types', {
    id: treatment,
    clinic_id: clinic,
    name: 'Filling',
    default_duration_min: 30,
  });
  userId = await insertUser(admin);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function patient(fields: Record<string, unknown> = {}): Promise<string> {
  const id = newId();
  await insertRow(admin, 'patients', {
    id,
    clinic_id: clinic,
    first_name: 'Ana',
    last_name: 'Brezovska',
    language: 'en',
    ...fields,
  });
  return id;
}

/**
 * Whether some backend waits for a row lock (a lock not granted, on a transaction or a tuple), within
 * three seconds: what "the edit waits for the booking" (and the other way round) looks like from
 * outside. pg_locks is visible to every role; pg_stat_activity hides other roles' queries. A wait of
 * another test file at the same moment would only make a missing wait look present: each case also
 * checks the order of the outcome, which only a real wait makes true.
 */
async function someoneWaitsOnAPatient(): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { rows } = await admin.query(
      `select 1 from pg_locks where not granted and locktype in ('transactionid', 'tuple')`,
    );
    if (rows.length > 0) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return false;
}

const ARCHIVE: Omit<patients.PatientChanges, 'firstName'> = {
  lastName: 'Brezovska',
  dateOfBirth: null,
  phone: null,
  email: null,
  language: 'en',
  guardianName: null,
  notes: '',
  status: 'archived',
};

/** The edit that archives the patient, as the action runs it: asking scheduling for visits ahead. */
function archive(id: string, beforeAsking?: () => Promise<void>) {
  return withTenant(clinic, (tx) =>
    patients.update(tx, id, { ...ARCHIVE, firstName: 'Ana' }, NOW, async () => {
      await beforeAsking?.();
      return (await scheduling.patientVisitsAhead(tx, id, NOW)).length > 0;
    }),
  );
}

/** The booking as the action runs it: the patient's status first, the booking only for an active one. */
function book(id: string, providerId: string, afterStatus?: () => Promise<void>) {
  return withTenant(clinic, async (tx) => {
    const status = await patients.patientStatus(tx, id);
    await afterStatus?.();
    if (status !== 'active') return { status, booked: null };
    const booked = await scheduling.createAppointment(
      tx,
      {
        patientId: id,
        providerId,
        treatmentTypeId: treatment,
        day: BOOK_DAY,
        startMinute: 10 * 60,
        lengthMinutes: 30,
        timeZone: 'Europe/Skopje',
        createdBy: userId,
        anyway: false,
      },
      NOW,
    );
    return { status, booked };
  });
}

async function holdsTheChair(id: string): Promise<boolean> {
  const { rows } = await admin.query(
    `select 1 from appointments where patient_id = $1 and status in ('booked', 'confirmed', 'arrived')`,
    [id],
  );
  return rows.length > 0;
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await admin.query<{ status: string }>(
    'select status from patients where id = $1',
    [id],
  );
  return rows[0]!.status;
}

describe('the booking and the edit take turns on the patient (acceptance 9)', () => {
  it('a booking in flight first: the archive waits for it, sees its visit, and is refused', async () => {
    const id = await patient();
    const provider = await insertProvider(admin, clinic);
    const read = deferred();
    const gate = deferred();
    const booking = book(id, provider, async () => {
      read.resolve();
      await gate.promise;
    });
    await read.promise; // the booking has read the patient, and holds their row
    const edit = archive(id);
    const waited = await someoneWaitsOnAPatient();
    gate.resolve();
    const [booked, edited] = await Promise.all([booking, edit]);

    expect(waited, 'the archive waits for the booking').toBe(true);
    expect(booked.booked?.ok).toBe(true);
    expect(edited).toEqual({ ok: false, code: 'visits_ahead' });
    expect(await statusOf(id)).toBe('active');
    expect(await holdsTheChair(id)).toBe(true);
  });

  it('an archive in flight first: the booking waits for it, then reads archived and books nothing', async () => {
    const id = await patient();
    const provider = await insertProvider(admin, clinic);
    const locked = deferred();
    const release = deferred();
    const edit = archive(id, async () => {
      locked.resolve();
      await release.promise;
    });
    await locked.promise; // the edit holds the patient's row and has seen no visit
    const booking = book(id, provider);
    const waited = await someoneWaitsOnAPatient();
    release.resolve();
    const [edited, booked] = await Promise.all([edit, booking]);

    expect(waited, 'the booking waits for the archive').toBe(true);
    expect(edited).toEqual({ ok: true, fields: ['status'] });
    expect(booked).toEqual({ status: 'archived', booked: null });
    expect(await statusOf(id)).toBe('archived');
    expect(await holdsTheChair(id)).toBe(false);
  });

  it('thirty races of a booking and an archive, started together: never an archived patient with a visit ahead', async () => {
    for (let race = 0; race < 30; race += 1) {
      const id = await patient();
      const provider = await insertProvider(admin, clinic);
      const [booked, edited] = await Promise.all([book(id, provider), archive(id)]);
      // One of the two won; the other saw its work.
      expect(booked.booked?.ok === true || edited.ok, `race ${race}`).toBe(true);
      expect(edited.ok && booked.booked !== null, `race ${race}: both won`).toBe(false);
      expect(
        (await statusOf(id)) !== 'active' && (await holdsTheChair(id)),
        `race ${race}: a visit ahead holds the chair for a patient who is not active`,
      ).toBe(false);
    }
  });
});

describe('two sends of one new patient at once add them once (acceptance 10, the flaky case)', () => {
  // The cause (found in a log line, not guessed): `patients.id` is unique twice, by the primary key
  // and with the clinic (`patients_clinic_id_id_key`, for the composite foreign keys). `ON CONFLICT
  // (id) DO NOTHING` covers the first only. Two inserts of one id at the same moment could both pass
  // the first check, and the second then met the other in the second index, where a unique violation
  // (23505) is an error and not "do nothing": the booking answered `internal` instead of
  // `already_booked`, about one run in thirty under load. `ON CONFLICT DO NOTHING` has no target.
  const newcomer = (id: string): patients.NewPatient => ({
    id,
    firstName: 'Vesna',
    lastName: 'Trajkovska',
    dateOfBirth: null,
    phone: null,
    email: null,
    language: 'en',
    guardianName: null,
    notes: '',
  });

  it('two hundred pairs sent at the same moment: in each, one adds the patient and the other finds them', async () => {
    let rejected = 0;
    let wrong = 0;
    for (let pair = 0; pair < 200; pair += 1) {
      const id = newId();
      const answers = await Promise.allSettled([
        withTenant(clinic, (tx) => patients.create(tx, newcomer(id), NOW)),
        withTenant(clinic, (tx) => patients.create(tx, newcomer(id), NOW)),
      ]);
      rejected += answers.filter((answer) => answer.status === 'rejected').length;
      const created = answers.filter(
        (answer) => answer.status === 'fulfilled' && answer.value.ok && answer.value.created,
      );
      if (created.length !== 1) wrong += 1;
    }
    expect(rejected, 'sends that failed instead of finding the patient').toBe(0);
    expect(wrong, 'pairs where not exactly one send added the patient').toBe(0);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookAppointment } from '@/app/(staff)/calendar/actions';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import * as patients from '@/modules/patients';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertRow } from './scheduling-fixtures';

// E01-T05d, acceptance 1, 3, 4 and 5: a new patient booked in one go, as the app runs it: the real
// booking action with a real session, the patients and scheduling modules in one tenant transaction,
// as the app role, under Row-Level Security (only next/headers and next/cache are replaced, as there
// is no running Next.js). Rows are set up and inspected as the migration role. Each case books on a
// day of its own in 2032, so no case's visit is another's overlap. Names are from the seed's invented
// lists, phones from its made-up block, emails from example.test; the assertions name ids.

const PASSWORD = 'MARKER-pw-05d1-correct';
const NOW = new Date('2026-10-26T08:00:00Z');

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

// The tester's (E01-T05d): a role without patients.manage, which no role is today. While
// `permission.withoutPatientsManage` is set, can() answers no for that permission alone; the wrapper's
// calendar.manage and everything else are answered as ever.
const permission = vi.hoisted(() => ({ withoutPatientsManage: false }));
vi.mock('@/modules/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/auth')>();
  return {
    ...actual,
    can: (...args: Parameters<typeof actual.can>) =>
      permission.withoutPatientsManage && args[2] === 'patients.manage'
        ? false
        : actual.can(...args),
  };
});

const admin = migratorPool();

/** One clinic's rows: a provider, a treatment type, an active and an archived patient. */
interface Place {
  clinic: string;
  dentist: string;
  checkup: string;
  marko: string;
  archived: string;
}

let skopje: Place;
let other: Place;
let frontDeskId: string;

async function clinic(): Promise<Place> {
  const id = await insertClinic(admin); // Europe/Skopje, phone country MK
  const dentist = newId();
  await insertRow(admin, 'providers', {
    id: dentist,
    clinic_id: id,
    name: 'Elena Planinska',
    short_name: 'Planinska',
    kind: 'dentist',
    chair_label: 'Chair 1',
    color_hue: 195,
    sort_order: 1,
    active: true,
  });
  const checkup = newId();
  await insertRow(admin, 'treatment_types', {
    id: checkup,
    clinic_id: id,
    name: 'Checkup',
    default_duration_min: 30,
    active: true,
  });
  const patient = async (first: string, last: string, status: string) => {
    const patientId = newId();
    await insertRow(admin, 'patients', {
      id: patientId,
      clinic_id: id,
      first_name: first,
      last_name: last,
      language: 'en',
      status,
    });
    return patientId;
  };
  return {
    clinic: id,
    dentist,
    checkup,
    marko: await patient('Marko', 'Dardha', 'active'),
    archived: await patient('Ana', 'Planinska', 'archived'),
  };
}

beforeAll(async () => {
  skopje = await clinic();
  other = await clinic();
  const email = testEmail();
  ({ id: frontDeskId } = await createStaffUser({ email, name: 'Front desk', password: PASSWORD }));
  for (const clinicId of [skopje.clinic, other.clinic]) {
    await insertMembership(admin, { clinicId, userId: frontDeskId, role: 'front_desk' });
  }
  request.cookie = await signInCookie(email, PASSWORD, '10.51.0.5');
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => {
  request.clinic = skopje.clinic;
  permission.withoutPatientsManage = false;
  cache.refresh.mockClear();
  cache.revalidatePath.mockClear();
});

let dayCount = 0;
/** A Monday … Friday of its own for each case, from 5 January 2032 on. */
function freshDay(): string {
  const day = new Date(Date.UTC(2032, 0, 5));
  const week = Math.floor(dayCount / 5);
  day.setUTCDate(day.getUTCDate() + week * 7 + (dayCount % 5));
  dayCount += 1;
  return day.toISOString().slice(0, 10);
}

/** The booking form as the drawer sends it with a new patient: these fields in place of these. */
function form(
  place: Place,
  fields: Record<string, string | undefined> = {},
): { data: FormData; id: string } {
  const id = fields.newPatientId ?? newId();
  const all: Record<string, string | undefined> = {
    day: '2032-01-05',
    newPatientId: id,
    firstName: 'Vesna',
    lastName: 'Trajkovska',
    phone: '070 001 451',
    email: '',
    treatmentTypeId: place.checkup,
    start: '10:00',
    length: '30',
    providerId: place.dentist,
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) {
    if (value !== undefined) data.append(name, value);
  }
  return { data, id };
}

async function count(query: string, ...values: unknown[]): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(query, values);
  return Number(rows[0]?.n);
}

/** The clinic's patients, appointments, and patient.created and appointment.created audit rows. */
async function written(clinicId: string): Promise<Record<string, number>> {
  const audit = (action: string) =>
    count(
      'select count(*) as n from audit_log where clinic_id = $1 and action = $2',
      clinicId,
      action,
    );
  return {
    patients: await count('select count(*) as n from patients where clinic_id = $1', clinicId),
    appointments: await count(
      'select count(*) as n from appointments where clinic_id = $1',
      clinicId,
    ),
    patientCreated: await audit('patient.created'),
    appointmentCreated: await audit('appointment.created'),
  };
}

function plus(before: Record<string, number>, each: number): Record<string, number> {
  return Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value + each]));
}

/** A visit the clinic already had, of Marko, so a booking over it is an overlap. */
async function existing(place: Place, startsAt: string, minutes: number): Promise<void> {
  await admin.query(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, source, created_by)
     values ($1, $2, $3, $4, 'Checkup', $5::timestamptz, $5::timestamptz + make_interval(mins => $6),
             'booked', 'staff', $7)`,
    [newId(), place.clinic, place.marko, place.dentist, startsAt, minutes, frontDeskId],
  );
}

describe('a new patient is added and booked in one go (acceptance 1)', () => {
  it('one patient as typed, one appointment for them, and two audit rows of ids: one patient.created, one appointment.created', async () => {
    const day = freshDay();
    const before = await written(skopje.clinic);
    const { data, id } = form(skopje, {
      day,
      firstName: '  Vesna ',
      lastName: 'Trajkovska',
      phone: '070 001 452',
      email: ' Vesna.Trajkovska@Example.TEST ',
    });
    const result = await bookAppointment(skopje.clinic, data);
    if (!result.ok) throw new Error(`refused: ${result.error.code}`);
    expect(await written(skopje.clinic)).toEqual(plus(before, 1));

    const stored = await admin.query(
      `select clinic_id, first_name, last_name, date_of_birth, phone_e164, email, language,
              guardian_name, notes, status, created_at, updated_at
         from patients where id = $1`,
      [id],
    );
    expect(stored.rows).toEqual([
      {
        clinic_id: skopje.clinic,
        first_name: 'Vesna',
        last_name: 'Trajkovska',
        date_of_birth: null,
        phone_e164: '+38970001452',
        email: 'vesna.trajkovska@example.test',
        language: 'en',
        guardian_name: null,
        notes: '',
        status: 'active',
        created_at: expect.any(Date) as Date,
        updated_at: expect.any(Date) as Date,
      },
    ]);
    const appointment = await admin.query(
      'select patient_id, provider_id, treatment_type_id, status from appointments where id = $1',
      [result.value.id],
    );
    expect(appointment.rows).toEqual([
      {
        patient_id: id,
        provider_id: skopje.dentist,
        treatment_type_id: skopje.checkup,
        status: 'booked',
      },
    ]);

    // One row of each, in no order of writing: both ids are UUID v7 made in one handler, unordered
    // within a millisecond (src/lib/ids.ts), so the rows are put in a fixed order by their action.
    const audit = await admin.query(
      `select actor_type, actor_id, action, entity_type, entity_id, metadata
         from audit_log where clinic_id = $1 and entity_id in ($2, $3) order by action desc`,
      [skopje.clinic, id, result.value.id],
    );
    expect(audit.rows).toEqual([
      {
        actor_type: 'user',
        actor_id: frontDeskId,
        action: 'patient.created',
        entity_type: 'patient',
        entity_id: id,
        metadata: {},
      },
      {
        actor_type: 'user',
        actor_id: frontDeskId,
        action: 'appointment.created',
        entity_type: 'appointment',
        entity_id: result.value.id,
        metadata: {},
      },
    ]);
    const auditText = JSON.stringify(audit.rows);
    for (const value of ['Vesna', 'Trajkovska', '38970001452', 'example.test']) {
      expect(auditText).not.toContain(value);
    }
    // Both audit rows at the action's one moment.
    const moments = await admin.query<{ at: Date }>(
      'select at from audit_log where clinic_id = $1 and entity_id in ($2, $3)',
      [skopje.clinic, id, result.value.id],
    );
    expect(new Set(moments.rows.map((row) => row.at.toISOString())).size).toBe(1);
    expect(cache.refresh).toHaveBeenCalledOnce();
    expect(cache.revalidatePath).toHaveBeenCalledExactlyOnceWith('/patients');
  });
});

describe('without a phone and an email it books (acceptance 3)', () => {
  it('neither sent, or both blank: the patient without them, and the visit', async () => {
    for (const fields of [
      { phone: undefined, email: undefined },
      { phone: '  ', email: '' },
    ]) {
      const before = await written(skopje.clinic);
      const { data, id } = form(skopje, { day: freshDay(), ...fields });
      const result = await bookAppointment(skopje.clinic, data);
      expect(result.ok).toBe(true);
      expect(await written(skopje.clinic)).toEqual(plus(before, 1));
      const stored = await admin.query('select phone_e164, email from patients where id = $1', [
        id,
      ]);
      expect(stored.rows).toEqual([{ phone_e164: null, email: null }]);
    }
  });
});

describe('refused with nothing written (acceptance 4)', () => {
  it.each(['070 001 45', '070 abc 451', '070 001 4512'])(
    'an impossible phone, %j: phone_impossible, no patient, no visit, no audit row',
    async (phone) => {
      const before = await written(skopje.clinic);
      const { data } = form(skopje, { day: freshDay(), phone });
      expect(await bookAppointment(skopje.clinic, data)).toEqual({
        ok: false,
        error: { code: 'phone_impossible' },
      });
      expect(await written(skopje.clinic)).toEqual(before);
    },
  );

  it('an email that is no email, or a name left empty: invalid_input at its field, before any transaction', async () => {
    const before = await written(skopje.clinic);
    const result = await bookAppointment(
      skopje.clinic,
      form(skopje, { day: freshDay(), email: 'vesna.trajkovska', firstName: ' ', lastName: '' })
        .data,
    );
    if (result.ok || result.error.code !== 'invalid_input' || !('issues' in result.error)) {
      throw new Error('expected invalid_input');
    }
    expect(result.error.issues.map((issue) => issue.path[0]).sort()).toEqual(
      ['email', 'firstName', 'lastName'].sort(),
    );
    expect(await written(skopje.clinic)).toEqual(before);
  });

  it('a refused booking (an overlap without "anyway") writes no patient and no audit row', async () => {
    const day = freshDay();
    await existing(skopje, `${day}T09:00:00Z`, 30); // 10:00 in Skopje, winter time
    const before = await written(skopje.clinic);
    const { data, id } = form(skopje, { day, start: '10:00' });
    expect(await bookAppointment(skopje.clinic, data)).toEqual({
      ok: false,
      error: { code: 'overlap' },
    });
    expect(await written(skopje.clinic)).toEqual(before);
    expect(await count('select count(*) as n from patients where id = $1', id)).toBe(0);
  });
});

describe('the patient is the picked one or a new one, never both (the schema)', () => {
  it.each([
    {
      what: 'a picked patient and a new one',
      fields: (p: Place) => ({ patientId: p.marko }),
      field: 'newPatientId',
    },
    {
      what: "a picked patient and a new one's names",
      fields: (p: Place) => ({ patientId: p.marko, newPatientId: undefined }),
      field: 'patientId',
    },
    {
      what: "a picked patient and a new one's phone",
      fields: (p: Place) => ({
        patientId: p.marko,
        newPatientId: undefined,
        firstName: undefined,
        lastName: undefined,
        phone: '070 001 451',
      }),
      field: 'patientId',
    },
    {
      what: "a new patient's id without names",
      fields: () => ({ firstName: undefined, lastName: undefined }),
      field: 'firstName',
    },
    {
      what: 'neither',
      fields: () => ({
        newPatientId: undefined,
        firstName: undefined,
        lastName: undefined,
        phone: undefined,
      }),
      field: 'patientId',
    },
  ])('$what: invalid_input at $field, nothing written', async ({ fields, field }) => {
    const before = await written(skopje.clinic);
    // A field given as undefined is not sent.
    const { data } = form(skopje, { day: freshDay(), ...fields(skopje) });
    const result = await bookAppointment(skopje.clinic, data);
    if (result.ok || result.error.code !== 'invalid_input' || !('issues' in result.error)) {
      throw new Error('expected invalid_input');
    }
    expect(result.error.issues.map((issue) => issue.path[0])).toEqual([field]);
    expect(await written(skopje.clinic)).toEqual(before);
  });
});

describe('the same booking with a new patient sent twice books one patient once (acceptance 5)', () => {
  it.each([undefined, 'true'])(
    'sent twice (anyway: %s): one patient, one visit, one patient.created; the second already_booked',
    async (anyway) => {
      const day = freshDay();
      if (anyway) await existing(skopje, `${day}T09:00:00Z`, 30);
      const fields = { day, start: '10:00', newPatientId: newId(), anyway };
      const before = await written(skopje.clinic);
      const first = await bookAppointment(skopje.clinic, form(skopje, fields).data);
      if (!first.ok) throw new Error(`refused: ${first.error.code}`);
      expect(await bookAppointment(skopje.clinic, form(skopje, fields).data)).toEqual({
        ok: false,
        error: { code: 'already_booked' },
      });
      expect(await written(skopje.clinic)).toEqual(plus(before, 1));
      expect(
        await count('select count(*) as n from patients where id = $1', fields.newPatientId),
      ).toBe(1);
    },
  );

  it.each([undefined, 'true'])(
    'sent twice at once (anyway: %s): one patient, one visit, one patient.created; the other already_booked',
    async (anyway) => {
      const day = freshDay();
      if (anyway) await existing(skopje, `${day}T09:00:00Z`, 30);
      const fields = { day, start: '10:00', newPatientId: newId(), anyway };
      const before = await written(skopje.clinic);
      const answers = await Promise.all([
        bookAppointment(skopje.clinic, form(skopje, fields).data),
        bookAppointment(skopje.clinic, form(skopje, fields).data),
      ]);
      expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
      expect(answers.filter((answer) => !answer.ok)).toEqual([
        { ok: false, error: { code: 'already_booked' } },
      ]);
      expect(await written(skopje.clinic)).toEqual(plus(before, 1));
    },
  );

  it('sent again with other names after the first was booked: the first patient, no new one, already_booked', async () => {
    const day = freshDay();
    const newPatientId = newId();
    const first = await bookAppointment(skopje.clinic, form(skopje, { day, newPatientId }).data);
    expect(first.ok).toBe(true);
    const before = await written(skopje.clinic);
    expect(
      await bookAppointment(
        skopje.clinic,
        form(skopje, { day, newPatientId, firstName: 'Teuta', phone: '' }).data,
      ),
    ).toEqual({ ok: false, error: { code: 'already_booked' } });
    expect(await written(skopje.clinic)).toEqual(before);
    const stored = await admin.query('select first_name from patients where id = $1', [
      newPatientId,
    ]);
    expect(stored.rows).toEqual([{ first_name: 'Vesna' }]);
  });

  it('the first refused as an overlap, then Book anyway: the patient is added then, once', async () => {
    const day = freshDay();
    await existing(skopje, `${day}T09:00:00Z`, 30);
    const newPatientId = newId();
    const before = await written(skopje.clinic);
    expect(await bookAppointment(skopje.clinic, form(skopje, { day, newPatientId }).data)).toEqual({
      ok: false,
      error: { code: 'overlap' },
    });
    const anyway = await bookAppointment(
      skopje.clinic,
      form(skopje, { day, newPatientId, anyway: 'true' }).data,
    );
    expect(anyway.ok).toBe(true);
    expect(await written(skopje.clinic)).toEqual(plus(before, 1));
  });
});

describe("a new patient's id that is already another patient's books no one", () => {
  it("another clinic's patient (Row-Level Security hides them): patient_not_bookable, nothing written in either", async () => {
    const counts = async () => [await written(skopje.clinic), await written(other.clinic)];
    const before = await counts();
    const { data } = form(skopje, { day: freshDay(), newPatientId: other.marko });
    expect(await bookAppointment(skopje.clinic, data)).toEqual({
      ok: false,
      error: { code: 'patient_not_bookable' },
    });
    expect(await counts()).toEqual(before);
    const stored = await admin.query('select clinic_id, first_name from patients where id = $1', [
      other.marko,
    ]);
    expect(stored.rows).toEqual([{ clinic_id: other.clinic, first_name: 'Marko' }]);
  });

  it("the clinic's archived patient: patient_not_bookable, nothing written", async () => {
    const before = await written(skopje.clinic);
    const { data } = form(skopje, { day: freshDay(), newPatientId: skopje.archived });
    expect(await bookAppointment(skopje.clinic, data)).toEqual({
      ok: false,
      error: { code: 'patient_not_bookable' },
    });
    expect(await written(skopje.clinic)).toEqual(before);
  });

  it("the clinic's active patient: booked as picked, no patient.created, no change to them", async () => {
    const before = await written(skopje.clinic);
    const { data } = form(skopje, { day: freshDay(), newPatientId: skopje.marko });
    const result = await bookAppointment(skopje.clinic, data);
    expect(result.ok).toBe(true);
    expect(await written(skopje.clinic)).toEqual({
      ...before,
      appointments: (before.appointments ?? 0) + 1,
      appointmentCreated: (before.appointmentCreated ?? 0) + 1,
    });
    const stored = await admin.query('select first_name, phone_e164 from patients where id = $1', [
      skopje.marko,
    ]);
    expect(stored.rows).toEqual([{ first_name: 'Marko', phone_e164: null }]);
  });
});

describe('patients.create with an id given (E01-T05d)', () => {
  const vesna = (id: string): patients.NewPatient => ({
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

  it('adds them under that id; a second time writes nothing and says so', async () => {
    const id = newId();
    expect(await withTenant(skopje.clinic, (tx) => patients.create(tx, vesna(id), NOW))).toEqual({
      ok: true,
      id,
      created: true,
    });
    expect(
      await withTenant(skopje.clinic, (tx) =>
        patients.create(tx, { ...vesna(id), firstName: 'Teuta' }, NOW),
      ),
    ).toEqual({ ok: true, id, created: false });
    const stored = await admin.query('select first_name from patients where id = $1', [id]);
    expect(stored.rows).toEqual([{ first_name: 'Vesna' }]);
  });

  it("another clinic's id: nothing written, no error", async () => {
    expect(
      await withTenant(skopje.clinic, (tx) => patients.create(tx, vesna(other.marko), NOW)),
    ).toEqual({ ok: true, id: other.marko, created: false });
  });

  it('without an id, a new one each time', async () => {
    const noId: patients.NewPatient = { ...vesna(newId()), id: undefined };
    const first = await withTenant(skopje.clinic, (tx) => patients.create(tx, noId, NOW));
    const second = await withTenant(skopje.clinic, (tx) => patients.create(tx, noId, NOW));
    if (!first.ok || !second.ok) throw new Error('refused');
    expect(first.created && second.created).toBe(true);
    expect(first.id).not.toBe(second.id);
  });
});

describe("the tester's: a new patient where the booking or the request goes wrong writes nothing (E01-T05d)", () => {
  it('a role without patients.manage: new_patient_forbidden, nothing written; a picked patient still books', async () => {
    permission.withoutPatientsManage = true;
    const before = await written(skopje.clinic);
    const { data, id } = form(skopje, { day: freshDay() });
    expect(await bookAppointment(skopje.clinic, data)).toEqual({
      ok: false,
      error: { code: 'new_patient_forbidden' },
    });
    expect(await written(skopje.clinic)).toEqual(before);
    expect(await count('select count(*) as n from patients where id = $1', id)).toBe(0);

    const picked = form(skopje, {
      day: freshDay(),
      newPatientId: undefined,
      firstName: undefined,
      lastName: undefined,
      phone: undefined,
      email: undefined,
    }).data;
    picked.append('patientId', skopje.marko);
    expect((await bookAppointment(skopje.clinic, picked)).ok).toBe(true);
  });

  it('a start the clocks skip (Skopje, 2032-03-28 02:30): start_skipped, no patient, no audit row', async () => {
    const before = await written(skopje.clinic);
    const { data, id } = form(skopje, { day: '2032-03-28', start: '02:30' });
    expect(await bookAppointment(skopje.clinic, data)).toEqual({
      ok: false,
      error: { code: 'start_skipped' },
    });
    expect(await written(skopje.clinic)).toEqual(before);
    expect(await count('select count(*) as n from patients where id = $1', id)).toBe(0);
  });

  it("another clinic's provider: provider_not_bookable, no patient in either clinic", async () => {
    const counts = async () => [await written(skopje.clinic), await written(other.clinic)];
    const before = await counts();
    const { data, id } = form(skopje, { day: freshDay(), providerId: other.dentist });
    expect(await bookAppointment(skopje.clinic, data)).toEqual({
      ok: false,
      error: { code: 'provider_not_bookable' },
    });
    expect(await counts()).toEqual(before);
    expect(await count('select count(*) as n from patients where id = $1', id)).toBe(0);
  });

  it("sent with clinic A's id while the request is in clinic B: clinic_changed, no patient in either", async () => {
    request.clinic = other.clinic;
    const counts = async () => [await written(skopje.clinic), await written(other.clinic)];
    const before = await counts();
    const { data, id } = form(skopje, { day: freshDay() });
    expect(await bookAppointment(skopje.clinic, data)).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect(await counts()).toEqual(before);
    expect(await count('select count(*) as n from patients where id = $1', id)).toBe(0);
  });

  it('names at the edge: Cyrillic names of 100 characters book as typed; 101 is invalid_input at its field', async () => {
    const long = 'Ж'.repeat(100);
    const { data, id } = form(skopje, { day: freshDay(), firstName: 'Весна', lastName: long });
    expect((await bookAppointment(skopje.clinic, data)).ok).toBe(true);
    const stored = await admin.query('select first_name, last_name from patients where id = $1', [
      id,
    ]);
    expect(stored.rows).toEqual([{ first_name: 'Весна', last_name: long }]);

    const before = await written(skopje.clinic);
    const result = await bookAppointment(
      skopje.clinic,
      form(skopje, { day: freshDay(), lastName: `${long}Ж` }).data,
    );
    if (result.ok || result.error.code !== 'invalid_input' || !('issues' in result.error)) {
      throw new Error('expected invalid_input');
    }
    expect(result.error.issues.map((issue) => issue.path[0])).toEqual(['lastName']);
    expect(await written(skopje.clinic)).toEqual(before);
  });
});

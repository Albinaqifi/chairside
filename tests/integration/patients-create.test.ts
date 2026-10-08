import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPatient, findLikelyDuplicates } from '@/app/(staff)/patients/new/actions';
import { closeDb } from '@/db/client';
import { fakePhone } from '@/db/seed/fake-data';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { createStaffUser } from '@/modules/auth';
import * as patients from '@/modules/patients';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertRow } from './scheduling-fixtures';

// E01-T02b, acceptance 1, 2, 4, 5 and 6: adding a patient and the likely-duplicate check, as the app
// runs them: the patients module in a tenant transaction, as the app role, under Row-Level Security,
// and the real actions with a real session (only next/headers and next/cache are replaced, as there
// is no running Next.js). Rows are set up and inspected as the migration role. Names come from the
// seed's invented lists, phones from its made-up block, emails from example.test; the assertions
// name ids, never a person.

const PASSWORD = 'MARKER-pw-5b8e-correct';
const NOW = new Date('2026-10-08T09:00:00Z');

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

// Outside a request revalidatePath() throws; the action calls it when a patient was added.
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);

const admin = migratorPool();
let clinicA: string;
let clinicB: string;
/** A clinic whose country the phone package does not know: the clinic's mistake. */
let clinicUnknownCountry: string;
let userId: string;
/** Clinic A's patients, and clinic B's namesake of one of them. */
const a = {} as Record<'ana' | 'gjorgji' | 'archived', string>;
let bAna: string;

const ANA_BORN = '1990-01-01';
const B_ANA_BORN = '1992-02-02';

async function patient(
  clinicId: string,
  fields: {
    first: string;
    last: string;
    born?: string;
    phone?: number;
    email?: string;
    status?: string;
  },
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'patients', {
    id,
    clinic_id: clinicId,
    first_name: fields.first,
    last_name: fields.last,
    date_of_birth: fields.born ?? null,
    phone_e164: fields.phone === undefined ? null : fakePhone(fields.phone),
    email: fields.email ?? null,
    status: fields.status ?? 'active',
    language: 'en',
  });
  return id;
}

/** The new-patient form's data, as the browser sends it: every field, these in place of the empty. */
function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  const all: Record<string, string> = {
    firstName: 'Elena',
    lastName: 'Planinska',
    dateOfBirth: '',
    language: 'en',
    phone: '',
    email: '',
    guardianName: '',
    notes: '',
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) data.append(name, value);
  return data;
}

/** The action as the front desk of `clinicId`, with that clinic picked. */
function asFrontDeskOf(clinicId: string): void {
  request.clinic = clinicId;
}

async function count(sql: string, clinicId: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(sql, [clinicId]);
  return Number(rows[0]?.n);
}

const patientsIn = (clinicId: string) =>
  count('select count(*) as n from patients where clinic_id = $1', clinicId);
const createdRowsIn = (clinicId: string) =>
  count(
    `select count(*) as n from audit_log where clinic_id = $1 and action = 'patient.created'`,
    clinicId,
  );

async function storedPhone(id: string): Promise<string | null> {
  const { rows } = await admin.query<{ phone_e164: string | null }>(
    'select phone_e164 from patients where id = $1',
    [id],
  );
  return rows[0]?.phone_e164 ?? null;
}

function check(clinicId: string, typed: Partial<patients.TypedPatient>): Promise<string[]> {
  const full: patients.TypedPatient = {
    firstName: 'Ana',
    lastName: 'Kodra',
    dateOfBirth: null,
    phone: null,
    email: null,
    ...typed,
  };
  return withTenant(clinicId, async (tx) =>
    (await patients.likelyDuplicates(tx, full)).map((found) => found.id),
  );
}

beforeAll(async () => {
  [clinicA, clinicB, clinicUnknownCountry] = await Promise.all([
    insertClinic(admin),
    insertClinic(admin),
    insertClinic(admin),
  ]);
  await admin.query(`update clinics set default_country = 'XX' where id = $1`, [
    clinicUnknownCountry,
  ]);
  a.ana = await patient(clinicA, {
    first: 'Ana',
    last: 'Kodra',
    born: ANA_BORN,
    phone: 1234,
    email: 'ana.kodra@example.test',
  });
  a.gjorgji = await patient(clinicA, { first: 'Ѓорѓи', last: 'Каменов', born: '1985-06-15' });
  a.archived = await patient(clinicA, {
    first: 'Marko',
    last: 'Lumi',
    born: '1979-03-03',
    status: 'archived',
  });
  bAna = await patient(clinicB, { first: 'Ana', last: 'Kodra', born: B_ANA_BORN, phone: 1235 });

  // A front desk member of the three clinics, signed in once; each test picks its clinic.
  const email = testEmail();
  ({ id: userId } = await createStaffUser({ email, name: 'Front desk', password: PASSWORD }));
  for (const clinicId of [clinicA, clinicB, clinicUnknownCountry]) {
    await insertMembership(admin, { clinicId, userId, role: 'front_desk' });
  }
  request.cookie = await signInCookie(email, PASSWORD, '10.39.0.1');
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

describe('the phone, however it is typed, is stored as one E.164 number (acceptance 1)', () => {
  it.each([
    { typed: '070 001 301', how: 'the national form' },
    { typed: '+389 70 001 301', how: 'with +389' },
    { typed: '00389 70 001 301', how: 'with 00389' },
    { typed: '‪070 001 301‬', how: 'pasted with direction marks' },
  ])('$how', async ({ typed }) => {
    const made = await withTenant(clinicA, (tx) =>
      patients.create(
        tx,
        {
          firstName: 'Blerina',
          lastName: 'Dardha',
          dateOfBirth: null,
          phone: typed,
          email: null,
          language: 'en',
          guardianName: null,
          notes: '',
        },
        NOW,
      ),
    );
    if (!made.ok) throw new Error(`refused: ${made.code}`);
    expect(await storedPhone(made.id)).toBe(fakePhone(1301));
  });
});

describe('patients.create: the row it adds', () => {
  it("in the transaction's clinic, every field as stored, both moments the action's now", async () => {
    const made = await withTenant(clinicB, (tx) =>
      patients.create(
        tx,
        {
          firstName: ' Јована ',
          lastName: 'Лозанова ',
          dateOfBirth: '2016-05-04',
          phone: '070 001 302',
          email: ' Jovana.Lozanova@Example.TEST ',
          language: 'en',
          guardianName: ' Стефан Лозанова ',
          notes: '  Prefers mornings. ',
        },
        NOW,
      ),
    );
    if (!made.ok) throw new Error(`refused: ${made.code}`);
    const { rows } = await admin.query(
      `select *, date_of_birth::text as date_of_birth from patients where id = $1`,
      [made.id],
    );
    expect(rows[0]).toMatchObject({
      clinic_id: clinicB,
      first_name: 'Јована',
      last_name: 'Лозанова',
      date_of_birth: '2016-05-04',
      phone_e164: fakePhone(1302),
      email: 'jovana.lozanova@example.test',
      language: 'en',
      guardian_name: 'Стефан Лозанова',
      notes: 'Prefers mornings.',
      status: 'active',
      created_at: NOW,
      updated_at: NOW,
    });
  });

  it('an optional field left empty: none, notes empty', async () => {
    const made = await withTenant(clinicB, (tx) =>
      patients.create(
        tx,
        {
          firstName: 'Bojan',
          lastName: 'Brezovska',
          dateOfBirth: '',
          phone: '  ',
          email: '',
          language: 'en',
          guardianName: '',
          notes: '',
        },
        NOW,
      ),
    );
    if (!made.ok) throw new Error(`refused: ${made.code}`);
    const { rows } = await admin.query(
      `select *, date_of_birth::text as date_of_birth from patients where id = $1`,
      [made.id],
    );
    expect(rows[0]).toMatchObject({
      date_of_birth: null,
      phone_e164: null,
      email: null,
      guardian_name: null,
      notes: '',
    });
  });

  it('in a clinic whose country the phone package does not know: an Error with a phone, a row without', async () => {
    const without = await withTenant(clinicUnknownCountry, (tx) =>
      patients.create(
        tx,
        {
          firstName: 'Arben',
          lastName: 'Dardha',
          dateOfBirth: null,
          phone: null,
          email: null,
          language: 'en',
          guardianName: null,
          notes: '',
        },
        NOW,
      ),
    );
    expect(without.ok).toBe(true);
    await expect(
      withTenant(clinicUnknownCountry, (tx) =>
        patients.create(
          tx,
          {
            firstName: 'Arben',
            lastName: 'Dardha',
            dateOfBirth: null,
            phone: '070 001 303',
            email: null,
            language: 'en',
            guardianName: null,
            notes: '',
          },
          NOW,
        ),
      ),
    ).rejects.toThrow(/country the phone package does not know/);
  });
});

describe('the action: an impossible phone is refused, with nothing written (acceptance 2)', () => {
  it.each([
    { typed: '070 001 2345', why: 'too long' },
    { typed: '070 00', why: 'too short' },
    { typed: '070 abc 234', why: 'letters' },
    { typed: '070 001 234 ext. 5', why: 'an extension' },
    { typed: '+49 30 1234567890123', why: 'more than 15 digits' },
    { typed: '070 001 23', why: 'a digit missing' },
  ])('$why: phone_impossible, no patient row, no audit row', async ({ typed }) => {
    asFrontDeskOf(clinicA);
    const [rowsBefore, auditBefore] = [await patientsIn(clinicA), await createdRowsIn(clinicA)];
    expect(await createPatient(clinicA, form({ phone: typed }))).toEqual({
      ok: false,
      error: { code: 'phone_impossible' },
    });
    expect(await patientsIn(clinicA)).toBe(rowsBefore);
    expect(await createdRowsIn(clinicA)).toBe(auditBefore);
  });

  it('a clinic country the phone package does not know: internal, never phone_impossible', async () => {
    asFrontDeskOf(clinicUnknownCountry);
    const before = await patientsIn(clinicUnknownCountry);
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      expect(await createPatient(clinicUnknownCountry, form({ phone: '070 001 304' }))).toEqual({
        ok: false,
        error: { code: 'internal' },
      });
    } finally {
      logged.mockRestore();
    }
    expect(await patientsIn(clinicUnknownCountry)).toBe(before);
  });
});

describe('the action: each patient added writes one audit row, with no personal value (acceptance 6)', () => {
  it('patient.created, by the member, for the new id: ids and codes only', async () => {
    asFrontDeskOf(clinicA);
    cache.revalidatePath.mockClear();
    const auditBefore = await createdRowsIn(clinicA);
    const result = await createPatient(
      clinicA,
      form({
        firstName: 'Mimoza',
        lastName: 'Shkëmbi',
        dateOfBirth: '1984-07-21',
        phone: '070 001 305',
        email: 'Mimoza.Shkembi@Example.TEST',
        notes: 'Prefers mornings.',
      }),
    );
    if (!result.ok) throw new Error(`refused: ${result.error.code}`);
    const { id } = result.value;
    expect(Object.keys(result.value)).toEqual(['id']);
    expect(await createdRowsIn(clinicA)).toBe(auditBefore + 1);
    const { rows } = await admin.query(
      `select clinic_id, actor_type, actor_id, action, entity_type, entity_id, metadata
         from audit_log where clinic_id = $1 and entity_id = $2`,
      [clinicA, id],
    );
    expect(rows).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: userId,
        action: 'patient.created',
        entity_type: 'patient',
        entity_id: id,
        metadata: {},
      },
    ]);
    const written = JSON.stringify(rows);
    for (const value of ['Mimoza', 'Shkëmbi', '1984', '38970001305', 'example.test', 'mornings']) {
      expect(written).not.toContain(value);
    }
    // The email is stored lower-cased, and the list is read again on its next visit.
    const stored = await admin.query('select email from patients where id = $1', [id]);
    expect(stored.rows[0]).toEqual({ email: 'mimoza.shkembi@example.test' });
    expect(cache.revalidatePath).toHaveBeenCalledExactlyOnceWith('/patients');
  });
});

describe('the likely-duplicate check, in each clinic (acceptance 4)', () => {
  it('the same name and date of birth: the patient already in the list', async () => {
    expect(await check(clinicA, { dateOfBirth: ANA_BORN })).toEqual([a.ana]);
  });

  it('the name typed in another case, with spaces around it, is the same name', async () => {
    expect(
      await check(clinicA, { firstName: '  aNA ', lastName: ' KODRA  ', dateOfBirth: ANA_BORN }),
    ).toEqual([a.ana]);
    expect(
      await check(clinicA, { firstName: 'ѓорѓи', lastName: 'КАМЕНОВ', dateOfBirth: '1985-06-15' }),
    ).toEqual([a.gjorgji]);
  });

  it('the same name and the same phone, however typed, or the same email in any case', async () => {
    expect(await check(clinicA, { phone: '070 001 234' })).toEqual([a.ana]);
    expect(await check(clinicA, { phone: '+389 70 001 234' })).toEqual([a.ana]);
    expect(await check(clinicA, { email: ' Ana.Kodra@Example.TEST ' })).toEqual([a.ana]);
  });

  it('of every status: an archived patient too', async () => {
    expect(
      await check(clinicA, { firstName: 'Marko', lastName: 'Lumi', dateOfBirth: '1979-03-03' }),
    ).toEqual([a.archived]);
  });

  it('the name alone, or with something else that differs, is no likely duplicate', async () => {
    expect(await check(clinicA, {})).toEqual([]);
    expect(await check(clinicA, { dateOfBirth: '1990-01-02' })).toEqual([]);
    expect(await check(clinicA, { phone: '070 001 999' })).toEqual([]);
    expect(await check(clinicA, { email: 'someone.else@example.test' })).toEqual([]);
    expect(await check(clinicA, { firstName: 'Ana', lastName: '', dateOfBirth: ANA_BORN })).toEqual(
      [],
    );
  });

  it('an impossible phone matches no one, and is no error', async () => {
    expect(await check(clinicA, { phone: '070 001 23' })).toEqual([]);
    expect(await check(clinicA, { phone: 'not a phone' })).toEqual([]);
  });

  it("in the second clinic the same typing finds none of the first clinic's patients", async () => {
    expect(await check(clinicB, { dateOfBirth: ANA_BORN })).toEqual([]);
    expect(await check(clinicB, { phone: '070 001 234' })).toEqual([]);
    expect(await check(clinicB, { email: 'ana.kodra@example.test' })).toEqual([]);
    // Its own namesake it finds, so the empty answers above are the isolation, not a wrong query.
    expect(await check(clinicB, { dateOfBirth: B_ANA_BORN })).toEqual([bAna]);
    expect(await check(clinicA, { dateOfBirth: B_ANA_BORN })).toEqual([]);
  });

  it("through the action, with the frame's clinic: each clinic's own patients only", async () => {
    const typed = {
      firstName: 'Ana',
      lastName: 'Kodra',
      dateOfBirth: ANA_BORN,
      phone: '',
      email: '',
    };
    asFrontDeskOf(clinicA);
    const inA = await findLikelyDuplicates(clinicA, typed);
    expect(inA).toEqual({
      ok: true,
      value: [{ id: a.ana, firstName: 'Ana', lastName: 'Kodra', dateOfBirth: ANA_BORN }],
    });
    asFrontDeskOf(clinicB);
    expect(await findLikelyDuplicates(clinicB, typed)).toEqual({ ok: true, value: [] });
    // Sent with clinic A's id while the request is in clinic B: nothing is read (D-069).
    expect(await findLikelyDuplicates(clinicA, typed)).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
  });

  it('writes nothing: no audit row', async () => {
    asFrontDeskOf(clinicA);
    const { rows } = await admin.query<{ n: string }>(
      'select count(*) as n from audit_log where clinic_id = $1',
      [clinicA],
    );
    await findLikelyDuplicates(clinicA, {
      firstName: 'Ana',
      lastName: 'Kodra',
      dateOfBirth: ANA_BORN,
      phone: '',
      email: '',
    });
    const after = await admin.query<{ n: string }>(
      'select count(*) as n from audit_log where clinic_id = $1',
      [clinicA],
    );
    expect(after.rows[0]?.n).toBe(rows[0]?.n);
  });
});

describe('siblings who share a phone (acceptance 5, D-033)', () => {
  it('their own first names, the same phone: no warning, and both are added', async () => {
    // Ana Kodra's phone, typed for her brother and her sister: a shared phone alone is no duplicate.
    expect(
      await check(clinicA, { firstName: 'Elena', lastName: 'Kodra', phone: '070 001 234' }),
    ).toEqual([]);
    expect(
      await check(clinicA, {
        firstName: 'Bojan',
        lastName: 'Kodra',
        dateOfBirth: '2015-09-09',
        phone: '070 001 234',
      }),
    ).toEqual([]);
    asFrontDeskOf(clinicA);
    const added: string[] = [];
    for (const firstName of ['Elena', 'Bojan']) {
      const result = await createPatient(
        clinicA,
        form({ firstName, lastName: 'Kodra', phone: '070 001 234', guardianName: 'Ana Kodra' }),
      );
      if (!result.ok) throw new Error(`refused: ${result.error.code}`);
      added.push(result.value.id);
    }
    const { rows } = await admin.query<{ id: string; phone_e164: string }>(
      `select id, phone_e164 from patients where clinic_id = $1 and phone_e164 = $2 order by id`,
      [clinicA, fakePhone(1234)],
    );
    expect(rows.map((row) => row.id).sort()).toEqual([a.ana, ...added].sort());
  });
});

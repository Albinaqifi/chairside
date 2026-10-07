import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { FIRST_NAMES, fakePhone, LAST_NAMES } from '@/db/seed/fake-data';
import { withTenant } from '@/db/tenant';
import { newId } from '@/lib/ids';
import { LIST_LIMIT, listPatients, type PatientList } from '@/modules/patients';
import { lastAndNextVisits } from '@/modules/scheduling';
import { clinicPlace } from '@/modules/tenancy';
import { insertClinic, migratorPool } from './fixtures';
import { insertProvider, insertRow, insertUser } from './scheduling-fixtures';

// E01-T02a, acceptance 1, 2, 3 and 6: the patient list's search, as the app runs it: the patients
// module in a tenant transaction, as the app role, under Row-Level Security. The rows are written
// as the migration role. Names come from the seed's invented lists and phones from its made-up
// block (src/db/seed/fake-data.ts); the assertions name ids, never a person.

const admin = migratorPool();
/** 10:00 UTC on Wednesday 7 October 2026: noon in Skopje. */
const NOW = new Date('2026-10-07T10:00:00Z');
const MINUTE = 60_000;

let clinicA: string;
let clinicB: string;
let userId: string;
/** Clinic A's patients, by a word for each. */
const a = {} as Record<
  'anaKodra' | 'elenaKodra' | 'gjorgji' | 'archived' | 'deceased' | 'late' | 'stale',
  string
>;
let bPatient: string;

async function patient(
  clinicId: string,
  fields: { first: string; last: string; phone?: number; born?: string; status?: string },
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'patients', {
    id,
    clinic_id: clinicId,
    first_name: fields.first,
    last_name: fields.last,
    phone_e164: fields.phone === undefined ? null : fakePhone(fields.phone),
    date_of_birth: fields.born ?? null,
    status: fields.status ?? 'active',
    language: 'en',
  });
  return id;
}

async function visit(
  clinicId: string,
  providerId: string,
  patientId: string,
  startsAt: string,
  status: string,
  minutes = 30,
): Promise<void> {
  await insertRow(admin, 'appointments', {
    id: newId(),
    clinic_id: clinicId,
    patient_id: patientId,
    provider_id: providerId,
    title: 'Checkup',
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + minutes * MINUTE).toISOString(),
    status,
    source: 'staff',
    created_by: userId,
  });
}

function search(clinicId: string, typed: string, now = NOW): Promise<PatientList> {
  return withTenant(clinicId, (tx) => listPatients(tx, typed, now));
}

async function idsFound(clinicId: string, typed: string): Promise<string[]> {
  return (await search(clinicId, typed)).rows.map((row) => row.id);
}

beforeAll(async () => {
  userId = await insertUser(admin);
  clinicA = await insertClinic(admin);
  clinicB = await insertClinic(admin);
  a.anaKodra = await patient(clinicA, {
    first: 'Ana',
    last: 'Kodra',
    phone: 1234,
    born: '1988-10-08',
  });
  a.elenaKodra = await patient(clinicA, { first: 'Elena', last: 'Kodra', phone: 2001 });
  a.gjorgji = await patient(clinicA, { first: 'Ѓорѓи', last: 'Каменов' });
  a.archived = await patient(clinicA, {
    first: 'Marko',
    last: 'Ezerovski',
    phone: 3001,
    status: 'archived',
  });
  a.deceased = await patient(clinicA, {
    first: 'Bojan',
    last: 'Lumi',
    phone: 4001,
    status: 'deceased',
  });
  a.late = await patient(clinicA, { first: 'Arben', last: 'Dardha', phone: 5001 });
  a.stale = await patient(clinicA, { first: 'Mimoza', last: 'Shkëmbi', phone: 6001 });
  // In clinic B, a namesake of clinic A's patient, with the next number of the block.
  bPatient = await patient(clinicB, { first: 'Ana', last: 'Kodra', phone: 1235 });

  const dentist = await insertProvider(admin, clinicA);
  const hygienist = await insertProvider(admin, clinicA, 'hygienist');
  // Ana Kodra: two completed visits, then a no-show, a cancelled one, a confirmed and a booked one.
  await visit(clinicA, dentist, a.anaKodra, '2026-09-01T08:00:00Z', 'completed');
  await visit(clinicA, dentist, a.anaKodra, '2026-09-15T08:00:00Z', 'completed');
  await visit(clinicA, dentist, a.anaKodra, '2026-10-01T08:00:00Z', 'no_show');
  await visit(clinicA, dentist, a.anaKodra, '2026-10-08T08:00:00Z', 'cancelled');
  await visit(clinicA, dentist, a.anaKodra, '2026-10-20T08:00:00Z', 'booked');
  await visit(clinicA, dentist, a.anaKodra, '2026-10-10T08:00:00Z', 'confirmed');
  // Arben Dardha is late for a visit that started at 09:45 and ends at 10:15: still his next.
  await visit(clinicA, hygienist, a.late, '2026-10-07T09:45:00Z', 'booked');
  // Mimoza Shkëmbi's booked visit of yesterday was never marked: it is not her next.
  await visit(clinicA, hygienist, a.stale, '2026-10-06T08:00:00Z', 'booked');
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

describe('the search finds a patient (acceptance 1)', () => {
  it.each(['Kodra', 'kodra', 'KODRA', 'Ana Kod', 'na Ko', '  ana   kodra  '])(
    'by part of the name, in any case: %s',
    async (typed) => {
      expect(await idsFound(clinicA, typed)).toContain(a.anaKodra);
    },
  );

  it.each(['каменов', 'ЃОРЃИ', 'Ѓорѓи Кам'])('in Cyrillic letters too: %s', async (typed) => {
    expect(await idsFound(clinicA, typed)).toEqual([a.gjorgji]);
  });

  it.each([
    '70001234',
    '001234',
    '70 001 234',
    '+389 70 001 234',
    '+38970001234',
    '00389 70 001 234',
    '070 001 234',
    '070/001-234',
  ])('by part of the phone, however it is written: %s', async (typed) => {
    expect(await idsFound(clinicA, typed)).toEqual([a.anaKodra]);
  });

  it('a name holds the text as typed: % and _ are letters, not patterns', async () => {
    expect(await idsFound(clinicA, '%')).toEqual([]);
    expect(await idsFound(clinicA, '_')).toEqual([]);
    expect(await idsFound(clinicA, "Ana' or '1'='1")).toEqual([]);
  });

  it('text with a letter in it looks for names only, not for the digits in it', async () => {
    expect(await idsFound(clinicA, 'Ana 1234')).toEqual([]);
  });
});

describe('the list', () => {
  it('with nothing typed: every status, by last name, then first name', async () => {
    const list = await search(clinicA, '');
    expect(list.rows.map((row) => row.id)).toEqual([
      a.late, // Dardha
      a.archived, // Ezerovski
      a.anaKodra, // Kodra, Ana
      a.elenaKodra, // Kodra, Elena
      a.deceased, // Lumi
      a.stale, // Shkëmbi
      a.gjorgji, // Каменов: Cyrillic after Latin
    ]);
    expect(list).toMatchObject({ total: 7, more: false });
  });

  it('marks an archived or deceased patient by their status', async () => {
    const statuses = Object.fromEntries(
      (await search(clinicA, '')).rows.map((row) => [row.id, row.status]),
    );
    expect(statuses[a.archived]).toBe('archived');
    expect(statuses[a.deceased]).toBe('deceased');
    expect(statuses[a.anaKodra]).toBe('active');
  });

  it("the age on the clinic's today, and the phone as the clinic writes it", async () => {
    // 23:30 UTC on 7 October is 8 October in Skopje, Ana Kodra's birthday.
    const evening = await search(clinicA, 'Ana Kodra', new Date('2026-10-07T23:30:00Z'));
    expect(evening.rows[0]).toMatchObject({ age: 38, phone: '070 001 234' });
    const morning = await search(clinicA, 'Ana Kodra', new Date('2026-10-07T08:00:00Z'));
    expect(morning.rows[0]?.age).toBe(37);
    const gjorgji = (await search(clinicA, 'Каменов')).rows[0];
    expect(gjorgji).toMatchObject({ age: null, phone: null });
  });

  it("a number of another country than the clinic's, in the international form", async () => {
    await admin.query(`update clinics set default_country = 'GB' where id = $1`, [clinicB]);
    try {
      expect((await search(clinicB, '')).rows[0]?.phone).toBe('+389 70 001 235');
    } finally {
      await admin.query(`update clinics set default_country = 'MK' where id = $1`, [clinicB]);
    }
  });

  it('the last completed visit, and the next booked or confirmed one that has not ended', async () => {
    const rows = Object.fromEntries((await search(clinicA, '')).rows.map((row) => [row.id, row]));
    expect(rows[a.anaKodra]).toMatchObject({
      lastVisit: '2026-09-15T08:00:00.000Z',
      nextVisit: '2026-10-10T08:00:00.000Z',
    });
    expect(rows[a.late]).toMatchObject({ lastVisit: null, nextVisit: '2026-10-07T09:45:00.000Z' });
    expect(rows[a.stale]).toMatchObject({ lastVisit: null, nextVisit: null });
    expect(rows[a.elenaKodra]).toMatchObject({ lastVisit: null, nextVisit: null });
  });
});

describe("a user of the second clinic finds none of the first clinic's patients (acceptance 3)", () => {
  it('by name, by phone, or with nothing typed', async () => {
    expect(await idsFound(clinicB, 'Kodra')).toEqual([bPatient]);
    expect(await idsFound(clinicB, '070 001 234')).toEqual([]);
    expect(await idsFound(clinicB, 'Каменов')).toEqual([]);
    const all = await search(clinicB, '');
    expect(all.rows.map((row) => row.id)).toEqual([bPatient]);
    expect(all.total).toBe(1);
  });

  it("and the first clinic's search finds none of the second's", async () => {
    expect(await idsFound(clinicA, '070 001 235')).toEqual([]);
    expect(await idsFound(clinicA, 'Kodra')).not.toContain(bPatient);
  });

  it("nor the first clinic's visits through scheduling, given that clinic's patient by id", async () => {
    // test-strategy.md, "Tenant isolation": through the module's public function, which takes its
    // ids from its caller (a later screen may take one from the browser). In clinic A the same
    // call finds her visits, so the empty answer in clinic B is the isolation, not a wrong id.
    const visitsOf = (clinicId: string) =>
      withTenant(clinicId, (tx) => lastAndNextVisits(tx, [a.anaKodra], NOW));
    expect(await visitsOf(clinicA)).toEqual(
      new Map([
        [
          a.anaKodra,
          { last: new Date('2026-09-15T08:00:00Z'), next: new Date('2026-10-10T08:00:00Z') },
        ],
      ]),
    );
    expect(await visitsOf(clinicB)).toEqual(new Map());
  });
});

describe("the clinic's place: its time zone and country", () => {
  it('as the clinic holds them, in its own transaction', async () => {
    expect(await withTenant(clinicA, (tx) => clinicPlace(tx))).toEqual({
      timeZone: 'Europe/Skopje',
      country: 'MK',
    });
  });

  it('a zone Intl does not know fails the list, rather than show times in another zone', async () => {
    const clinic = await insertClinic(admin);
    await admin.query(`update clinics set timezone = 'Mars/Olympus_Mons' where id = $1`, [clinic]);
    await expect(search(clinic, '')).rejects.toThrow('a time zone Intl does not know');
  });
});

describe('the trigram indexes are gone (acceptance 6)', () => {
  it('neither index on patients, nor pg_trgm', async () => {
    const indexes = await admin.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'patients' order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'patients_clinic_id_id_key',
      'patients_pkey',
    ]);
    const extensions = await admin.query(`select 1 from pg_extension where extname = 'pg_trgm'`);
    expect(extensions.rows).toEqual([]);
  });
});

describe('the speed (acceptance 2)', () => {
  const PATIENTS = 20_000;
  let clinic: string;

  beforeAll(async () => {
    clinic = await insertClinic(admin);
    // Names in one script each, from the invented lists; nine in ten with a number of the block.
    const people = Array.from({ length: PATIENTS }, (_, n) => {
      const letters = n % 2 === 0 ? 'latin' : 'cyrillic';
      return {
        id: newId(),
        first: FIRST_NAMES[letters][n % 8]!,
        last: LAST_NAMES[letters][Math.floor(n / 8) % 8]!,
        born: new Date(Date.UTC(1940, 0, 1 + (n % 25_000))).toISOString().slice(0, 10),
        phone: n % 10 === 9 ? null : fakePhone(n % 10_000),
      };
    });
    await admin.query(
      `insert into patients (id, clinic_id, first_name, last_name, date_of_birth, phone_e164, language)
       select id, $1, first, last, born::date, phone, 'en'
         from unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[])
           as t(id, first, last, born, phone)`,
      [
        clinic,
        people.map((p) => p.id),
        people.map((p) => p.first),
        people.map((p) => p.last),
        people.map((p) => p.born),
        people.map((p) => p.phone),
      ],
    );
    // A visit for each patient, one after another in one column: completed before NOW, booked after.
    const provider = await insertProvider(admin, clinic);
    const first = Date.parse('2026-01-05T08:00:00Z');
    const starts = people.map((_, n) => new Date(first + n * 30 * MINUTE));
    await admin.query(
      `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                                 status, source, created_by)
       select gen_random_uuid(), $1, patient, $2, 'Checkup', starts, starts + interval '30 minutes',
              case when starts < $3 then 'completed' else 'booked' end, 'staff', $4
         from unnest($5::uuid[], $6::timestamptz[]) as t(patient, starts)`,
      [clinic, provider, NOW, userId, people.map((p) => p.id), starts],
    );
    // As a database in use is: its statistics up to date.
    await admin.query('analyze patients');
    await admin.query('analyze appointments');
  }, 60_000);

  it.each(['', 'Kodra', 'ана', 'Elena Planinska', '070 00', '+389 70 000 12', 'Zzz'])(
    'a search for "%s" over 20,000 patients answers in under 300 ms',
    async (typed) => {
      const started = performance.now();
      const list = await search(clinic, typed);
      const took = performance.now() - started;
      expect(list.total).toBe(PATIENTS);
      expect(list.rows.length).toBeLessThanOrEqual(LIST_LIMIT);
      expect(took, `${Math.round(took)} ms`).toBeLessThan(300);
    },
  );

  it(`with nothing typed: the first ${LIST_LIMIT}, and more to find by typing`, async () => {
    const list = await search(clinic, '');
    expect(list.rows).toHaveLength(LIST_LIMIT);
    expect(list.more).toBe(true);
    const names = list.rows.map((row) => [row.lastName, row.firstName]);
    expect(names).toEqual(
      [...names].sort(([l1 = '', f1 = ''], [l2 = '', f2 = '']) =>
        l1 === l2 ? (f1 < f2 ? -1 : f1 > f2 ? 1 : 0) : l1 < l2 ? -1 : 1,
      ),
    );
  });
});

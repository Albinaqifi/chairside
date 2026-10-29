import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { readVisitsAhead, updatePatient } from '@/app/(staff)/patients/[id]/edit/actions';
import { EditPatientForm } from '@/app/(staff)/patients/[id]/edit/edit-patient-form';
import { editValuesOf } from '@/app/(staff)/patients/[id]/edit/edit-values';
import EditPatientPage from '@/app/(staff)/patients/[id]/edit/page';
import { closeDb } from '@/db/client';
import { scheduling as seedScheduling } from '@/db/seed/02-scheduling';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import * as patients from '@/modules/patients';
import {
  captureOutput,
  insertClinic,
  insertMembership,
  migratorPool,
  signInCookie,
  testEmail,
} from './fixtures';
import { insertProvider, insertRow } from './scheduling-fixtures';

// E01-T03b, acceptance 1 to 8: editing a patient as the app runs it: the real save action and the
// real edit page with a real session, the patients and scheduling modules in one tenant transaction,
// as the app role, under Row-Level Security (only next/headers, next/cache and next-intl's server
// side are replaced, as there is no running Next.js). Rows are set up and inspected as the migration
// role. The locks and the flaky case are in patients-update-locks.test.ts. Every value is synthetic:
// names from the seed's invented lists, phones from its made-up block, emails from example.test; the
// assertions on audit rows name ids and field names only.

const PASSWORD = 'MARKER-pw-03b1-correct';
const NOT_FOUND = 'NEXT_HTTP_ERROR_FALLBACK;404';
const ROLES = ['owner', 'dentist', 'hygienist', 'front_desk'] as const;
const MINUTE = 60_000;

const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));
// Outside a server action revalidatePath() throws; the save calls it when done.
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);

const admin = migratorPool();

let clinicA: string;
let clinicB: string;
/** A clinic in Britain: the seed's +389 numbers read back there in the international form. */
let clinicGb: string;
const logins = {} as Record<(typeof ROLES)[number] | 'all', string>;
let treatment: string;
let userId: string;

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.53.0.${nextAddress++}`;

async function signInAs(who: keyof typeof logins, clinic: string): Promise<void> {
  request.cookie = await signInCookie(logins[who], PASSWORD, freshAddress());
  request.clinic = clinic;
}

async function patient(clinicId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const id = newId();
  await insertRow(admin, 'patients', {
    id,
    clinic_id: clinicId,
    first_name: 'Ana',
    last_name: 'Brezovska',
    language: 'en',
    ...fields,
  });
  return id;
}

/** A visit of the patient with a provider of its own, so no provider is double booked. */
async function visit(
  patientId: string,
  startsAt: Date,
  status: string,
  minutes = 30,
  clinicId = clinicA,
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'appointments', {
    id,
    clinic_id: clinicId,
    patient_id: patientId,
    provider_id: await insertProvider(admin, clinicId),
    treatment_type_id: treatment,
    title: 'Check-up',
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + minutes * MINUTE).toISOString(),
    status,
    source: 'staff',
    created_by: userId,
  });
  return id;
}

/** `minutes` from the real clock: the save action reads the clock itself. */
const fromNow = (minutes: number) => new Date(Date.now() + minutes * MINUTE);

interface StoredPatient {
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  phone_e164: string | null;
  email: string | null;
  language: string;
  guardian_name: string | null;
  notes: string;
  status: string;
  updated_at: Date;
}

async function stored(id: string): Promise<StoredPatient> {
  const { rows } = await admin.query<StoredPatient>(
    `select first_name, last_name, to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth, phone_e164,
            email, language, guardian_name, notes, status, updated_at
       from patients where id = $1`,
    [id],
  );
  return rows[0]!;
}

interface UpdateRow {
  actor_id: string;
  entity_type: string;
  entity_id: string;
  metadata: unknown;
}

/** The `patient.updated` rows of a clinic, oldest first. */
async function updateRows(clinicId: string, entityId?: string): Promise<UpdateRow[]> {
  const { rows } = await admin.query<UpdateRow>(
    `select actor_id, entity_type, entity_id, metadata from audit_log
      where clinic_id = $1 and action = 'patient.updated' and ($2::text is null or entity_id = $2)
      order by at, id`,
    [clinicId, entityId ?? null],
  );
  return rows;
}

async function viewRows(clinicId: string, entityId: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    `select count(*) as n from audit_log
      where clinic_id = $1 and action = 'patient.viewed' and entity_id = $2`,
    [clinicId, entityId],
  );
  return Number(rows[0]?.n);
}

/** What the edit form of a patient holds, as the page fills it (the profile's read). */
async function formOf(clinicId: string, id: string): Promise<Record<string, string>> {
  const profile = await withTenant(clinicId, (tx) => patients.patientProfile(tx, id, new Date()));
  if (!profile) throw new Error('no such patient');
  return { patientId: id, status: profile.status, ...editValuesOf(profile) };
}

function formData(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields))
    if (value !== undefined) data.append(name, value);
  return data;
}

/** The form of a patient as filled in, with these fields in place of theirs, sent to the save. */
async function save(
  clinicId: string,
  id: string,
  changes: Record<string, string | undefined> = {},
  as: string = clinicId,
) {
  return updatePatient(as, formData({ ...(await formOf(clinicId, id)), ...changes }));
}

function elementsOf<P>(node: ReactNode, type: unknown): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => elementsOf<P>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const own = node.type === type ? [node as ReactElement<P>] : [];
  return [...own, ...elementsOf<P>(node.props.children, type)];
}

async function answersNotFound(id: string): Promise<boolean> {
  try {
    await EditPatientPage({ params: Promise.resolve({ id }) });
    return false;
  } catch (error) {
    if ((error as { digest?: unknown } | null)?.digest === NOT_FOUND) return true;
    throw error;
  }
}

beforeAll(async () => {
  clinicA = await insertClinic(admin);
  clinicB = await insertClinic(admin);
  clinicGb = await insertClinic(admin);
  await admin.query(
    `update clinics set default_country = 'GB', timezone = 'Europe/London' where id = $1`,
    [clinicGb],
  );
  treatment = newId();
  await insertRow(admin, 'treatment_types', {
    id: treatment,
    clinic_id: clinicA,
    name: 'Filling',
    default_duration_min: 30,
  });
  for (const role of ROLES) {
    const email = testEmail();
    const { id } = await createStaffUser({ email, name: 'Staff', password: PASSWORD });
    await insertMembership(admin, { clinicId: clinicA, userId: id, role });
    logins[role] = email;
    userId = id;
  }
  const all = testEmail();
  const { id: allId } = await createStaffUser({ email: all, name: 'Staff', password: PASSWORD });
  for (const clinicId of [clinicA, clinicB, clinicGb]) {
    await insertMembership(admin, { clinicId, userId: allId });
  }
  logins.all = all;
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => {
  request.cookie = '';
  request.clinic = undefined;
  cache.revalidatePath.mockClear();
});

describe('a save changes the fields and writes one patient.updated row (acceptance 1)', () => {
  it.each(ROLES)(
    'a %s: trimmed and normalised as create does, the fields named, no value',
    async (role) => {
      const id = await patient(clinicA, {
        first_name: 'Vesna',
        phone_e164: '+38970001111',
        email: 'vesna.old@example.test',
        notes: 'Old note',
        updated_at: '2026-01-01T00:00:00Z',
      });
      await signInAs(role, clinicA);
      const result = await save(clinicA, id, {
        firstName: '  Vesna-Maria ',
        phone: '070 001 452',
        email: ' Vesna.New@Example.TEST ',
        notes: ' A new note ',
        dateOfBirth: '1990-05-17',
        guardianName: ' Mimoza Shkëmbi ',
        status: 'archived',
      });
      expect(result).toEqual({
        ok: true,
        value: { id, audit: { fields: expect.any(Array) as string[] } },
      });
      expect(await stored(id)).toMatchObject({
        first_name: 'Vesna-Maria',
        last_name: 'Brezovska',
        date_of_birth: '1990-05-17',
        phone_e164: '+38970001452',
        email: 'vesna.new@example.test',
        language: 'en',
        guardian_name: 'Mimoza Shkëmbi',
        notes: 'A new note',
        status: 'archived',
      });
      expect((await stored(id)).updated_at.getTime()).toBeGreaterThan(Date.parse('2026-01-02'));

      const rows = await updateRows(clinicA, id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_id: expect.any(String) as string,
        entity_type: 'patient',
      });
      expect(rows[0]!.metadata).toEqual({
        fields: ['firstName', 'dateOfBirth', 'phone', 'email', 'guardianName', 'notes', 'status'],
      });
      const text = JSON.stringify(rows);
      for (const value of [
        'Vesna',
        '38970001452',
        'example.test',
        'Mimoza',
        '1990',
        'A new note',
      ]) {
        expect(text).not.toContain(value);
      }
      expect(cache.revalidatePath).toHaveBeenCalledWith('/patients');
      expect(cache.revalidatePath).toHaveBeenCalledWith(`/patients/${id}`);
    },
  );

  it('only the fields that differ are named, and an optional field emptied is stored as none', async () => {
    const id = await patient(clinicA, {
      phone_e164: '+38970001111',
      email: 'ana@example.test',
      guardian_name: 'Mimoza Shkëmbi',
      date_of_birth: '2016-02-11',
    });
    await signInAs('front_desk', clinicA);
    expect(
      (await save(clinicA, id, { phone: ' ', email: '', guardianName: '', dateOfBirth: '' })).ok,
    ).toBe(true);
    expect(await stored(id)).toMatchObject({
      phone_e164: null,
      email: null,
      guardian_name: null,
      date_of_birth: null,
    });
    expect((await updateRows(clinicA, id))[0]!.metadata).toEqual({
      fields: ['dateOfBirth', 'phone', 'email', 'guardianName'],
    });
  });

  it('a patient whose language the message file does not offer keeps it through a save', async () => {
    const id = await patient(clinicA, { language: 'mk' });
    await signInAs('owner', clinicA);
    expect((await save(clinicA, id, { firstName: 'Ana-Maria' })).ok).toBe(true);
    expect((await stored(id)).language).toBe('mk');
  });
});

describe('a save that changes nothing is refused (acceptance 2)', () => {
  it('nothing_changed, no audit row, no updated_at, however the values were typed around', async () => {
    const id = await patient(clinicA, {
      phone_e164: '+38970001111',
      email: 'ana@example.test',
      updated_at: '2026-01-01T00:00:00Z',
    });
    await signInAs('owner', clinicA);
    for (const around of [
      {},
      { firstName: ' Ana ', email: ' ANA@Example.test ', phone: '+389 70 001 111' },
      { notes: '   ', guardianName: ' ' },
    ]) {
      expect(await save(clinicA, id, around)).toEqual({
        ok: false,
        error: { code: 'nothing_changed' },
      });
    }
    expect(await updateRows(clinicA, id)).toEqual([]);
    expect((await stored(id)).updated_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  // The seed's patients, in a clinic in North Macedonia and one in Britain: the phone as the clinic
  // writes it reads back to the stored number, so a form saved untouched changes nothing.
  const seeded = (seedScheduling.tables ?? [])
    .filter(({ table }) => table === 'patients')
    .flatMap(({ rows }) => rows);

  it.each([
    ['North Macedonia', () => clinicA],
    ['Britain', () => clinicGb],
  ])(
    'the form of every seeded patient, sent as filled in, in a clinic in %s',
    async (_where, clinicOf) => {
      expect(seeded.length).toBeGreaterThanOrEqual(45);
      const clinicId = clinicOf();
      const ids: string[] = [];
      for (const row of seeded) {
        const id = newId();
        ids.push(id);
        await insertRow(admin, 'patients', { ...row, id, clinic_id: clinicId });
      }
      await signInAs('all', clinicId);
      let withPhone = 0;
      for (const id of ids) {
        const before = await stored(id);
        if (before.phone_e164 !== null) withPhone += 1;
        expect(await save(clinicId, id), id).toEqual({
          ok: false,
          error: { code: 'nothing_changed' },
        });
        expect(await stored(id)).toEqual(before);
      }
      expect(withPhone).toBeGreaterThan(0);
      expect((await updateRows(clinicId)).filter((row) => ids.includes(row.entity_id))).toEqual([]);
    },
  );

  it('a foreign number in a clinic at home, and the clinic’s own in another, read back too', async () => {
    const mk = await patient(clinicA, { phone_e164: '+4930123456' });
    const gb = await patient(clinicGb, { phone_e164: '+447700900123' });
    await signInAs('all', clinicA);
    expect(await save(clinicA, mk)).toEqual({ ok: false, error: { code: 'nothing_changed' } });
    await signInAs('all', clinicGb);
    expect(await save(clinicGb, gb)).toEqual({ ok: false, error: { code: 'nothing_changed' } });
  });
});

describe('the audit row names the patient by the stored lower-case id (acceptance 3)', () => {
  it('a capital-letter id in the call: the row holds the stored id, so a later search finds it', async () => {
    const id = await patient(clinicA);
    await signInAs('owner', clinicA);
    const sent = formData({
      ...(await formOf(clinicA, id)),
      patientId: id.toUpperCase(),
      notes: 'Changed',
    });
    expect((await updatePatient(clinicA, sent)).ok).toBe(true);
    expect(id).toBe(id.toLowerCase());
    const rows = await updateRows(clinicA, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entity_id).toBe(id);
  });
});

describe('what the schema or the clinic refuses, with nothing written (acceptance 4)', () => {
  it.each(['070 001 45', '070 abc 451', '070 001 4512'])(
    'an impossible phone, %j: phone_impossible, nothing written',
    async (phone) => {
      const id = await patient(clinicA, { phone_e164: '+38970001111' });
      await signInAs('owner', clinicA);
      const before = await stored(id);
      expect(await save(clinicA, id, { phone, notes: 'Would change' })).toEqual({
        ok: false,
        error: { code: 'phone_impossible' },
      });
      expect(await stored(id)).toEqual(before);
      expect(await updateRows(clinicA, id)).toEqual([]);
    },
  );

  it('a name missing, an email that is no email, a date that is none, a status unknown: invalid_input at each field', async () => {
    const id = await patient(clinicA);
    await signInAs('owner', clinicA);
    const result = await save(clinicA, id, {
      firstName: ' ',
      email: 'ana.brezovska',
      dateOfBirth: '2031-02-30',
      status: 'gone',
    });
    if (result.ok || result.error.code !== 'invalid_input' || !('issues' in result.error)) {
      throw new Error('expected invalid_input');
    }
    expect(result.error.issues.map((issue) => issue.path[0]).sort()).toEqual(
      ['dateOfBirth', 'email', 'firstName', 'status'].sort(),
    );
    expect(await updateRows(clinicA, id)).toEqual([]);
  });

  it('a patient id that is no UUID is invalid_input; one the clinic has none by, not_found', async () => {
    await signInAs('owner', clinicA);
    const bare = {
      firstName: 'Ana',
      lastName: 'Kodra',
      language: 'en',
      notes: '',
      status: 'active',
    };
    const result = await updatePatient(clinicA, formData({ ...bare, patientId: 'not-a-uuid' }));
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await updatePatient(clinicA, formData({ ...bare, patientId: newId() }))).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('prints no personal value to the log, for a save or a refusal', async () => {
    const id = await patient(clinicA, { first_name: 'Shpëtim', phone_e164: '+38970001111' });
    await signInAs('owner', clinicA);
    const { output } = await captureOutput(async () => {
      await save(clinicA, id, { lastName: 'Shkëmbi-Kodra' });
      await save(clinicA, id, { phone: '070 001 45' });
    });
    for (const value of ['Shpëtim', 'Shkëmbi', '38970001111', '070 001 45']) {
      expect(output).not.toContain(value);
    }
  });
});

describe("the other clinic's patient, as the other clinic's owner (acceptance 6)", () => {
  it('is not found by the save, the visits read and both pages, and nothing is written in either clinic', async () => {
    const bPatient = await patient(clinicB, { first_name: 'Teuta' });
    const before = await stored(bPatient);
    await signInAs('all', clinicA);
    expect(await save(clinicB, bPatient, { notes: 'Changed by A' }, clinicA)).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await readVisitsAhead(clinicA, { patientId: bPatient })).toEqual({
      ok: true,
      value: [],
    });
    expect(await answersNotFound(bPatient)).toBe(true);
    expect(await stored(bPatient)).toEqual(before);
    expect(await updateRows(clinicB)).toEqual([]);
    expect(await viewRows(clinicB, bPatient)).toBe(0);
    expect(await viewRows(clinicA, bPatient)).toBe(0);
  });

  it('a request in another clinic than the form names is clinic_changed, nothing written', async () => {
    const id = await patient(clinicA);
    await signInAs('all', clinicB);
    expect(await save(clinicA, id, { notes: 'Changed' }, clinicA)).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect((await stored(id)).notes).toBe('');
  });

  it('a signed-out request is sent to the login page, and writes nothing', async () => {
    const id = await patient(clinicA);
    await expect(
      updatePatient(clinicA, formData({ ...(await formOf(clinicA, id)), notes: 'Changed' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') as string });
    expect((await stored(id)).notes).toBe('');
  });
});

describe('the edit page (acceptance 5)', () => {
  it.each(ROLES)(
    'a %s opens it: filled with the stored values, and one patient.viewed row',
    async (role) => {
      const id = await patient(clinicA, {
        first_name: 'Shpëtim',
        phone_e164: '+38970001111',
        email: 'shpetim@example.test',
        status: 'archived',
      });
      await signInAs(role, clinicA);
      const before = await viewRows(clinicA, id);
      const shown = await EditPatientPage({ params: Promise.resolve({ id }) });
      const forms = elementsOf<{
        patientId: string;
        status: string;
        values: Record<string, string>;
      }>(shown, EditPatientForm);
      expect(forms).toHaveLength(1);
      expect(forms[0]!.props).toMatchObject({
        patientId: id,
        status: 'archived',
        values: {
          firstName: 'Shpëtim',
          phone: expect.stringMatching(/^07\d \d{3} \d{3}$/) as string,
        },
      });
      expect(elementsOf<{ clinicId: string }>(shown, PageClinic)[0]?.props.clinicId).toBe(clinicA);
      expect(await viewRows(clinicA, id)).toBe(before + 1);
    },
  );

  it("an unknown id, a non-UUID and another clinic's patient answer 404 and write no row", async () => {
    const bPatient = await patient(clinicB);
    await signInAs('all', clinicA);
    for (const id of [newId(), 'not-a-uuid', '', bPatient]) {
      const before = [await viewRows(clinicA, bPatient), await viewRows(clinicB, bPatient)];
      expect(await answersNotFound(id), id).toBe(true);
      expect([await viewRows(clinicA, bPatient), await viewRows(clinicB, bPatient)]).toEqual(
        before,
      );
    }
  });
});

describe('archived or deceased with a visit ahead (acceptance 8)', () => {
  it.each(['booked', 'confirmed', 'arrived'])(
    'a %s visit that has not ended: visits_ahead, nothing written, and the visit is listed',
    async (status) => {
      const id = await patient(clinicA);
      const ahead = await visit(id, fromNow(status === 'arrived' ? -10 : 2 * 24 * 60), status);
      await signInAs('front_desk', clinicA);
      for (const wanted of ['archived', 'deceased']) {
        expect(await save(clinicA, id, { status: wanted, notes: 'Would change' })).toEqual({
          ok: false,
          error: { code: 'visits_ahead' },
        });
      }
      expect(await stored(id)).toMatchObject({ status: 'active', notes: '' });
      expect(await updateRows(clinicA, id)).toEqual([]);
      const listed = await readVisitsAhead(clinicA, { patientId: id });
      if (!listed.ok) throw new Error('refused');
      expect(listed.value.map((row) => row.id)).toEqual([ahead]);
    },
  );

  it('only cancelled, no-show or completed visits ahead, or visits that ended, or none: it is saved', async () => {
    await signInAs('front_desk', clinicA);
    const cases: Record<string, (id: string) => Promise<void>> = {
      none: async () => undefined,
      cancelled: async (id) => void (await visit(id, fromNow(60), 'cancelled')),
      no_show: async (id) => void (await visit(id, fromNow(60), 'no_show')),
      completed: async (id) => void (await visit(id, fromNow(60), 'completed')),
      'a booked one that ended': async (id) => void (await visit(id, fromNow(-90), 'booked')),
      'a confirmed one that ended': async (id) => void (await visit(id, fromNow(-90), 'confirmed')),
    };
    for (const [what, setUp] of Object.entries(cases)) {
      for (const wanted of ['archived', 'deceased']) {
        const id = await patient(clinicA);
        await setUp(id);
        expect((await save(clinicA, id, { status: wanted })).ok, `${what} → ${wanted}`).toBe(true);
        expect((await stored(id)).status).toBe(wanted);
      }
    }
  });

  it('back to active is always saved, a visit ahead or not; an archived patient keeps their details editable', async () => {
    const id = await patient(clinicA, { status: 'archived' });
    await visit(id, fromNow(60), 'booked');
    await signInAs('owner', clinicA);
    // Not changing to archived: the phone of an archived patient with a visit ahead is saved.
    expect((await save(clinicA, id, { notes: 'Moved house' })).ok).toBe(true);
    expect((await save(clinicA, id, { status: 'active' })).ok).toBe(true);
    expect((await stored(id)).status).toBe('active');
    const deceased = await patient(clinicA, { status: 'deceased' });
    await visit(deceased, fromNow(60), 'confirmed');
    expect((await save(clinicA, deceased, { status: 'active' })).ok).toBe(true);
  });

  it('the list is soonest first, at most 20, with the provider and the treatment', async () => {
    const id = await patient(clinicA);
    const later = await visit(id, fromNow(3 * 24 * 60), 'booked');
    const sooner = await visit(id, fromNow(60), 'confirmed');
    await visit(id, fromNow(30), 'cancelled');
    await signInAs('hygienist', clinicA);
    const listed = await readVisitsAhead(clinicA, { patientId: id });
    if (!listed.ok) throw new Error('refused');
    expect(listed.value.map((row) => row.id)).toEqual([sooner, later]);
    expect(listed.value[0]).toMatchObject({
      what: 'Filling',
      providerName: expect.any(String) as string,
    });

    const many = await patient(clinicA);
    for (let n = 0; n < 22; n += 1) await visit(many, fromNow(60 + n), 'booked');
    const capped = await readVisitsAhead(clinicA, { patientId: many });
    expect(capped.ok && capped.value).toHaveLength(20);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePatient } from '@/app/(staff)/patients/[id]/edit/actions';
import { editValuesOf } from '@/app/(staff)/patients/[id]/edit/edit-values';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import * as patients from '@/modules/patients';
import * as scheduling from '@/modules/scheduling';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertProvider, insertRow } from './scheduling-fixtures';

// E01-T03b, the tester's cases (extra to patients-update.test.ts): the same save sent twice at once,
// the edge of "a visit that has not ended", and extreme input. Synthetic values only.

const PASSWORD = 'MARKER-pw-03b1-correct';
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const admin = migratorPool();
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
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Staff', password: PASSWORD });
  await insertMembership(admin, { clinicId: clinic, userId: id, role: 'front_desk' });
  userId = id;
  request.cookie = await signInCookie(email, PASSWORD, '10.54.0.1');
  request.clinic = clinic;
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => undefined);

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

async function save(id: string, changes: Record<string, string> = {}) {
  const profile = await withTenant(clinic, (tx) => patients.patientProfile(tx, id, new Date()));
  if (!profile) throw new Error('no such patient');
  const data = new FormData();
  const fields = { patientId: id, status: profile.status, ...editValuesOf(profile), ...changes };
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return updatePatient(clinic, data);
}

async function rows(id: string): Promise<number> {
  const { rows: found } = await admin.query(
    `select 1 from audit_log where clinic_id = $1 and action = 'patient.updated' and entity_id = $2`,
    [clinic, id],
  );
  return found.length;
}

describe('the same save sent twice at once (a double click that got past the button)', () => {
  it('is saved once: the second finds the first’s work and is nothing_changed, one audit row', async () => {
    for (let round = 0; round < 10; round += 1) {
      const id = await patient();
      const [one, two] = await Promise.all([
        save(id, { phone: '070 700 151', notes: 'Call after 5' }),
        save(id, { phone: '070 700 151', notes: 'Call after 5' }),
      ]);
      const results = [one, two].map((r) => (r.ok ? 'ok' : r.error.code)).sort();
      expect(results, `round ${round}`).toEqual(['nothing_changed', 'ok']);
      expect(await rows(id)).toBe(1);
    }
  });

  it('archive sent twice at once with a visit ahead: both refused, nothing written', async () => {
    const id = await patient();
    await insertRow(admin, 'appointments', {
      id: newId(),
      clinic_id: clinic,
      patient_id: id,
      provider_id: await insertProvider(admin, clinic),
      treatment_type_id: treatment,
      title: 'Check-up',
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      ends_at: new Date(Date.now() + 86_400_000 + 1_800_000).toISOString(),
      status: 'booked',
      source: 'staff',
      created_by: userId,
    });
    const both = await Promise.all([
      save(id, { status: 'archived' }),
      save(id, { status: 'archived' }),
    ]);
    expect(both.map((r) => (r.ok ? 'ok' : r.error.code))).toEqual(['visits_ahead', 'visits_ahead']);
    expect(await rows(id)).toBe(0);
  });
});

describe('a visit "has not ended" exactly at now', () => {
  it('ending at now is not ahead; one millisecond later is', async () => {
    const NOW = new Date('2033-05-04T10:00:00.000Z');
    const id = await patient();
    const book = async (endsAt: Date, startsAt: Date) =>
      insertRow(admin, 'appointments', {
        id: newId(),
        clinic_id: clinic,
        patient_id: id,
        provider_id: await insertProvider(admin, clinic),
        treatment_type_id: treatment,
        title: 'Check-up',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: 'booked',
        source: 'staff',
        created_by: userId,
      });
    await book(NOW, new Date(NOW.getTime() - 30 * 60_000));
    const ahead = () => withTenant(clinic, (tx) => scheduling.patientVisitsAhead(tx, id, NOW));
    expect(await ahead()).toHaveLength(0);
    await book(new Date(NOW.getTime() + 1), new Date(NOW.getTime() - 29 * 60_000 + 1));
    expect(await ahead()).toHaveLength(1);
  });
});

describe('extreme input', () => {
  it('notes of exactly 2000 characters are saved; 2001 are refused at the field', async () => {
    const id = await patient();
    expect((await save(id, { notes: 'x'.repeat(2000) })).ok).toBe(true);
    const over = await save(id, { notes: 'x'.repeat(2001) });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('invalid_input');
  });

  it.each([
    ['a date of birth in year 9999', { dateOfBirth: '9999-12-31' }],
    ['a lone surrogate in the notes', { notes: 'a\ud800b' }],
  ])('%s is a refusal at the field or a save, never an internal error', async (_what, changes) => {
    const id = await patient();
    const result = await save(id, changes);
    const code = result.ok ? 'ok' : result.error.code;
    expect(['ok', 'invalid_input']).toContain(code);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import { patientProfile } from '@/modules/patients';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertRow } from './scheduling-fixtures';

// E01-T03a, the tester's cases: what the builder's tests do not name. The age follows the clinic's
// zone at the moment asked about (the page's test cannot set "now"), and the audit row of a view
// names the patient the way the record is stored, however the address was written. Synthetic data.

const PASSWORD = 'MARKER-pw-7c1d-correct';
const request = vi.hoisted(() => ({ cookie: '' }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (name === CLINIC_COOKIE ? undefined : undefined),
    }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));

const admin = migratorPool();
let nextAddress = 1;
const freshAddress = () => `10.48.0.${nextAddress++}`;

async function clinicIn(timezone: string): Promise<string> {
  const id = await insertClinic(admin);
  await admin.query(`update clinics set timezone = $1 where id = $2`, [timezone, id]);
  return id;
}

async function patientBornOn(clinicId: string, dateOfBirth: string): Promise<string> {
  const id = newId();
  await insertRow(admin, 'patients', {
    id,
    clinic_id: clinicId,
    first_name: 'Ana',
    last_name: 'Brezovska',
    language: 'mk',
    date_of_birth: dateOfBirth,
  });
  return id;
}

afterAll(async () => {
  await closeDb();
  await admin.end();
});

describe('the age is on the clinic’s today, not the server’s or UTC’s', () => {
  // The birthday is 7 October. 2026-10-06T12:30Z is still the 6th in UTC and already 01:30 on the 7th
  // in Auckland (UTC+13 in October); 2026-10-07T05:00Z is the 7th in UTC and still 18:00 on the 6th
  // in Pago Pago (UTC-11).
  const BEFORE_MIDNIGHT_UTC = new Date('2026-10-06T12:30:00Z');
  const BIRTHDAY_UTC_MORNING = new Date('2026-10-07T05:00:00Z');

  it('a clinic far ahead of UTC has the birthday while UTC still has the day before', async () => {
    const clinic = await clinicIn('Pacific/Auckland');
    const born = await patientBornOn(clinic, '2016-10-07');
    const shown = await withTenant(clinic, (tx) => patientProfile(tx, born, BEFORE_MIDNIGHT_UTC));
    expect(shown?.age).toBe(10);
  });

  it('a clinic behind UTC has not had the birthday while UTC already has', async () => {
    const clinic = await clinicIn('Pacific/Pago_Pago');
    const born = await patientBornOn(clinic, '2016-10-07');
    const shown = await withTenant(clinic, (tx) => patientProfile(tx, born, BIRTHDAY_UTC_MORNING));
    expect(shown?.age).toBe(9);
  });
});

describe('the view row names the patient as the record does', () => {
  let clinic: string;
  let patientId: string;

  beforeAll(async () => {
    clinic = await insertClinic(admin);
    const email = testEmail();
    const { id } = await createStaffUser({ email, name: 'Staff', password: PASSWORD });
    await insertMembership(admin, { clinicId: clinic, userId: id, role: 'front_desk' });
    request.cookie = await signInCookie(email, PASSWORD, freshAddress());
    patientId = await patientBornOn(clinic, '1990-01-01');
  });
  beforeEach(() => undefined);

  it('an address in capital letters shows the patient and records the patient’s own id', async () => {
    const { default: Page } = await import('@/app/(staff)/patients/[id]/page');
    await Page({ params: Promise.resolve({ id: patientId.toUpperCase() }) });
    const { rows } = await admin.query<{ entity_id: string }>(
      `select entity_id from audit_log where clinic_id = $1 and action = 'patient.viewed'`,
      [clinic],
    );
    expect(rows.map((row) => row.entity_id)).toEqual([patientId]);
  });
});

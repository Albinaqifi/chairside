import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageClinic } from '@/app/_lib/frame-clinic';
import type { ProfileRead } from '@/app/(staff)/patients/[id]/actions';
import PatientProfilePage from '@/app/(staff)/patients/[id]/page';
import { PatientProfileView } from '@/app/(staff)/patients/[id]/patient-profile';
import { searchPatients } from '@/app/(staff)/patients/actions';
import { closeDb } from '@/db/client';
import { fakePhone } from '@/db/seed/fake-data';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import { HISTORY_LIMIT, patientVisits } from '@/modules/scheduling';
import {
  captureOutput,
  insertClinic,
  insertMembership,
  migratorPool,
  signInCookie,
  testEmail,
} from './fixtures';
import { insertProvider, insertRow } from './scheduling-fixtures';

// E01-T03a, acceptance 1, 3, 4 and 7: the patient profile's page as Next.js calls it, as each role,
// under Row-Level Security: what it reads, the one `patient.viewed` row for each render, none for a
// list, a search, an unknown id, a non-UUID or another clinic's patient (all answer 404), and the
// next visit and the history by the rule the list uses. Only Next.js's request functions and
// next-intl's server side are replaced, as there is no running Next.js; the profile is read from the
// element the page returns, never rendered (its render is patient-profile.test.ts). Every value is
// synthetic; names are the seed's invented ones, and the assertions on audit rows name ids only.

const PASSWORD = 'MARKER-pw-9e3b-correct';
const NOT_FOUND = 'NEXT_HTTP_ERROR_FALLBACK;404';

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

const admin = migratorPool();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** 10:00 UTC on Wednesday 7 October 2026: noon in Skopje. */
const NOW = new Date('2026-10-07T10:00:00Z');

const ROLES = ['owner', 'dentist', 'hygienist', 'front_desk'] as const;

let clinicA: string;
let clinicB: string;
/** One login for each role in clinic A, by role; and one in both clinics. */
const logins = {} as Record<(typeof ROLES)[number] | 'both', string>;
let treatmentA: string;
let userId: string;
/** Clinic A's patient with everything, a guardian's child; one with nothing; clinic B's patient. */
let full: string;
let bare: string;
let bPatient: string;

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.47.0.${nextAddress++}`;

function elementsOf<P>(node: ReactNode, type: unknown): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => elementsOf<P>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const own = node.type === type ? [node as ReactElement<P>] : [];
  return [...own, ...elementsOf<P>(node.props.children, type)];
}

/** The profile the page for this address shows, and the clinic it names. */
async function open(id: string): Promise<{ read: ProfileRead; clinic: unknown }> {
  const shown = await PatientProfilePage({ params: Promise.resolve({ id }) });
  const views = elementsOf<{ read: ProfileRead }>(shown, PatientProfileView);
  expect(views).toHaveLength(1);
  const clinics = elementsOf<{ clinicId: unknown }>(shown, PageClinic);
  return { read: views[0]!.props.read, clinic: clinics[0]?.props.clinicId };
}

/** Whether the page answers 404 (Next.js's notFound()) for this id. */
async function answersNotFound(id: string): Promise<boolean> {
  try {
    await PatientProfilePage({ params: Promise.resolve({ id }) });
    return false;
  } catch (error) {
    if ((error as { digest?: unknown } | null)?.digest === NOT_FOUND) return true;
    throw error;
  }
}

interface ViewRow {
  actor_id: string;
  entity_type: string;
  entity_id: string;
  metadata: unknown;
}

/** The `patient.viewed` rows of a clinic, oldest first. */
async function viewRows(clinicId: string): Promise<ViewRow[]> {
  const { rows } = await admin.query<ViewRow>(
    `select actor_id, entity_type, entity_id, metadata from audit_log
     where clinic_id = $1 and action = 'patient.viewed' order by at, id`,
    [clinicId],
  );
  return rows;
}

async function patient(clinicId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const id = newId();
  await insertRow(admin, 'patients', {
    id,
    clinic_id: clinicId,
    first_name: 'Ana',
    last_name: 'Brezovska',
    language: 'mk',
    ...fields,
  });
  return id;
}

/**
 * A provider of clinic A for each patient's visits: no provider is double booked, whatever the
 * tests write, and a visit's provider is named.
 */
const providers = new Map<string, string>();
async function providerOf(patientId: string): Promise<string> {
  const known = providers.get(patientId);
  if (known) return known;
  const id = await insertProvider(admin, clinicA);
  await admin.query(`update providers set name = 'Elena Planinska' where id = $1`, [id]);
  providers.set(patientId, id);
  return id;
}

async function visit(
  patientId: string,
  startsAt: string,
  status: string,
  minutes = 30,
  fields: Record<string, unknown> = {},
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'appointments', {
    id,
    clinic_id: clinicA,
    patient_id: patientId,
    provider_id: await providerOf(patientId),
    treatment_type_id: treatmentA,
    title: 'Check-up',
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + minutes * MINUTE).toISOString(),
    status,
    source: 'staff',
    created_by: userId,
    ...fields,
  });
  return id;
}

/** `hour`:00 UTC, `days` days from NOW's day. */
const at = (days: number, hour = 9) => new Date(Date.UTC(2026, 9, 7 + days, hour)).toISOString();

beforeAll(async () => {
  clinicA = await insertClinic(admin);
  clinicB = await insertClinic(admin);
  treatmentA = newId();
  await insertRow(admin, 'treatment_types', {
    id: treatmentA,
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
  const both = testEmail();
  const { id: bothId } = await createStaffUser({ email: both, name: 'Staff', password: PASSWORD });
  await insertMembership(admin, { clinicId: clinicA, userId: bothId });
  await insertMembership(admin, { clinicId: clinicB, userId: bothId });
  logins.both = both;

  full = await patient(clinicA, {
    first_name: 'Shpëtim',
    last_name: 'Shkëmbi',
    date_of_birth: '2016-02-11',
    phone_e164: fakePhone(119),
    email: 'mimoza.shkembi@example.test',
    guardian_name: 'Mimoza Shkëmbi',
    notes: 'Prefers the morning.',
  });
  bare = await patient(clinicA, { first_name: 'Elena', last_name: 'Kodra', language: 'en' });
  bPatient = await patient(clinicB, { first_name: 'Ana', last_name: 'Kodra' });
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => {
  request.cookie = '';
  request.clinic = undefined;
});

describe('the profile of a patient of the clinic, as each role (acceptance 1, 3)', () => {
  it.each(ROLES)('a %s sees the record and writes one patient.viewed row', async (role) => {
    request.cookie = await signInCookie(logins[role], PASSWORD, freshAddress());
    const before = (await viewRows(clinicA)).length;
    const { read, clinic } = await open(full);
    expect(clinic).toBe(clinicA);
    expect(read.profile).toMatchObject({
      id: full,
      firstName: 'Shpëtim',
      lastName: 'Shkëmbi',
      dateOfBirth: '2016-02-11',
      email: 'mimoza.shkembi@example.test',
      language: 'mk',
      guardianName: 'Mimoza Shkëmbi',
      notes: 'Prefers the morning.',
      status: 'active',
    });
    // The phone as the clinic's people write it: the national form for the clinic's own country.
    expect(read.profile.phone).toMatch(/^07\d \d{3} \d{3}$/);
    expect(typeof read.profile.age).toBe('number');
    const rows = await viewRows(clinicA);
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ entity_type: 'patient', entity_id: full });
  });

  it('one row for each render, with the viewer, the patient and the entity, and nothing else', async () => {
    request.cookie = await signInCookie(logins.owner, PASSWORD, freshAddress());
    const before = (await viewRows(clinicA)).filter((row) => row.entity_id === bare).length;
    await open(bare);
    await open(bare);
    const mine = (await viewRows(clinicA)).filter((row) => row.entity_id === bare);
    expect(mine).toHaveLength(before + 2);
    const row = mine.at(-1)!;
    expect(Object.keys(row).sort()).toEqual(['actor_id', 'entity_id', 'entity_type', 'metadata']);
    expect(row.metadata ?? {}).toEqual({});
    // Nothing personal is in the row: the patient's names are not in it.
    const text = JSON.stringify(row);
    for (const value of ['Elena', 'Kodra', 'example.test']) expect(text).not.toContain(value);
  });

  it('a patient with no date of birth, phone, email or visit: the fields are null and empty', async () => {
    request.cookie = await signInCookie(logins.front_desk, PASSWORD, freshAddress());
    const { read } = await open(bare);
    expect(read.profile).toMatchObject({
      dateOfBirth: null,
      age: null,
      phone: null,
      email: null,
      guardianName: null,
      notes: '',
    });
    expect(read.next).toBeNull();
    expect(read.history).toEqual([]);
  });

  it('prints no personal value to the log: neither for a profile nor for a 404', async () => {
    request.cookie = await signInCookie(logins.owner, PASSWORD, freshAddress());
    const { output } = await captureOutput(async () => {
      await open(full);
      await answersNotFound(newId());
    });
    for (const value of ['Shpëtim', 'Shkëmbi', 'Mimoza', 'example.test', '2016-02-11']) {
      expect(output).not.toContain(value);
    }
  });
});

describe('what is not a profile, and what is not found (acceptance 3)', () => {
  it("an unknown id, a non-UUID and another clinic's patient answer 404 and write no row", async () => {
    request.cookie = await signInCookie(logins.both, PASSWORD, freshAddress());
    const asked: [string, string][] = [
      [clinicA, newId()],
      [clinicA, 'not-a-uuid'],
      [clinicA, ''],
      [clinicA, bPatient], // clinic B's patient, asked for from clinic A
      [clinicB, full], // and clinic A's, from clinic B
    ];
    for (const [chosen, id] of asked) {
      request.clinic = chosen;
      const before = [await viewRows(clinicA), await viewRows(clinicB)];
      expect(await answersNotFound(id), `${chosen} / ${id}`).toBe(true);
      expect([await viewRows(clinicA), await viewRows(clinicB)]).toEqual(before);
    }
  });

  it("each role gets the same 404 for another clinic's patient", async () => {
    for (const role of ROLES) {
      request.cookie = await signInCookie(logins[role], PASSWORD, freshAddress());
      expect(await answersNotFound(bPatient)).toBe(true);
    }
    expect(await viewRows(clinicB)).toEqual([]);
  });

  it('the list and a search write no patient.viewed row', async () => {
    request.cookie = await signInCookie(logins.owner, PASSWORD, freshAddress());
    const before = await viewRows(clinicA);
    const everyone = await searchPatients.forPage({ text: '' });
    const found = await searchPatients.forPage({ text: 'Shk' });
    expect(everyone.ok && found.ok).toBe(true);
    expect(await viewRows(clinicA)).toEqual(before);
  });

  it('a signed-out request is sent to the login page, and writes no row', async () => {
    const before = await viewRows(clinicA);
    await expect(
      PatientProfilePage({ params: Promise.resolve({ id: full }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') as string });
    expect(await viewRows(clinicA)).toEqual(before);
  });
});

describe('the next visit and the history (acceptance 4)', () => {
  /** The visits of one patient of clinic A, read as the app role under the clinic's policy. */
  const visitsOf = (patientId: string, now = NOW) =>
    withTenant(clinicA, (tx) => patientVisits(tx, patientId, now));

  it('the next is the first booked or confirmed visit that has not ended; the rest is neither', async () => {
    const id = await patient(clinicA, { first_name: 'Arben', last_name: 'Dardha' });
    await visit(id, at(-1), 'booked'); // ended yesterday, unmarked: not next
    await visit(id, at(0, 8), 'confirmed', 30); // 08:00 to 08:30 UTC: ended before NOW (10:00)
    await visit(id, at(0, 9), 'booked', 90); // 09:00 to 10:30: under way, not yet arrived: next
    await visit(id, at(0, 11), 'cancelled');
    await visit(id, at(1, 9), 'no_show');
    await visit(id, at(0, 12), 'arrived');
    await visit(id, at(2, 9), 'confirmed');
    const { next, history } = await visitsOf(id);
    expect(next).toMatchObject({
      startsAt: new Date(at(0, 9)),
      providerName: 'Elena Planinska',
      treatmentName: 'Filling',
    });
    expect(history).toEqual([]);
  });

  it('a visit is next until it ends, and not at the moment it does', async () => {
    const id = await patient(clinicA, { first_name: 'Blerina', last_name: 'Lumi' });
    await visit(id, at(0, 9), 'booked', 60); // ends 10:00 sharp
    expect((await visitsOf(id, new Date(NOW.getTime() - 1))).next).not.toBeNull();
    expect((await visitsOf(id, NOW)).next).toBeNull();
  });

  it('the history is the completed visits, newest first, at most 20', async () => {
    const id = await patient(clinicA, { first_name: 'Marko', last_name: 'Ezerovski' });
    const ids: string[] = [];
    for (let day = 1; day <= HISTORY_LIMIT + 3; day++) {
      const fields = { treatment_type_id: null, title: 'Cleaning' };
      ids.push(await visit(id, at(-day), 'completed', 30, fields));
    }
    await visit(id, at(-40), 'cancelled');
    await visit(id, at(-41), 'no_show');
    const { next, history } = await visitsOf(id);
    expect(next).toBeNull();
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history.map((entry) => entry.id)).toEqual(ids.slice(0, HISTORY_LIMIT));
    // Without a treatment type the appointment's own label is what there is.
    expect(history[0]).toMatchObject({ treatmentName: null, title: 'Cleaning' });
  });

  it("another patient's visits and another clinic's are not read", async () => {
    const mine = await patient(clinicA, { first_name: 'Shpëtim', last_name: 'Lumi' });
    const other = await patient(clinicA, { first_name: 'Mimoza', last_name: 'Kodra' });
    await visit(other, at(1), 'booked');
    expect(await visitsOf(mine)).toEqual({ next: null, history: [] });
    // Clinic B's transaction sees none of clinic A's visits, whatever patient id it asks for.
    const fromB = await withTenant(clinicB, (tx) => patientVisits(tx, other, NOW));
    expect(fromB).toEqual({ next: null, history: [] });
  });

  it('the page shows the next visit and the history of the patient it opens', async () => {
    request.cookie = await signInCookie(logins.front_desk, PASSWORD, freshAddress());
    const id = await patient(clinicA, { first_name: 'Elena', last_name: 'Lumi' });
    const ahead = await visit(id, new Date(Date.now() + 3 * DAY).toISOString(), 'booked');
    const done = await visit(id, new Date(Date.now() - 3 * DAY).toISOString(), 'completed');
    const { read } = await open(id);
    expect(read.next?.id).toBe(ahead);
    expect(read.history.map((entry) => entry.id)).toEqual([done]);
    expect(read.history[0]).toMatchObject({ what: 'Filling', providerName: 'Elena Planinska' });
  });
});

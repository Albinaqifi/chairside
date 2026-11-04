import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { newId } from '@/lib/ids';
import { listPatients } from '@/modules/patients';
import { lastAndNextVisits, patientVisits } from '@/modules/scheduling';
import { insertClinic, migratorPool } from './fixtures';
import { insertProvider, insertRow, insertUser } from './scheduling-fixtures';

// E01-T06d, acceptance 1 and 2: "In the chair now" as the app reads it, as the app role under
// Row-Level Security: the list's `inChair` and the profile's, from one rule in the scheduling module
// (an arrived visit, by status alone, whatever its end). Rows are written as the migration role.
// Every value is synthetic; the assertions name ids and codes, never a person.

const admin = migratorPool();
const MINUTE = 60_000;
/** 10:00 UTC on Wednesday 7 October 2026: noon in Skopje. */
const NOW = new Date('2026-10-07T10:00:00Z');
/** `hour`:00 UTC on a day of October 2026, as the database returns it (an ISO string). */
const at = (hour: number, day = 7) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();

let clinicA: string;
let clinicB: string;
let userId: string;
const keys = [
  'arrived',
  'arrivedLong',
  'arrivedAndLater',
  'onlyBooked',
  'onlyOver',
  'none',
  'twoArrived',
] as const;
/** Clinic A's patients, one for each case. */
const a = {} as Record<(typeof keys)[number], string>;
let bArrived: string;
let arrivedId: string;
let laterBookedId: string;
let firstArrivedId: string;

async function patient(clinicId: string, first: string, last: string): Promise<string> {
  const id = newId();
  await insertRow(admin, 'patients', {
    id,
    clinic_id: clinicId,
    first_name: first,
    last_name: last,
    status: 'active',
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
  title = 'Check-up',
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'appointments', {
    id,
    clinic_id: clinicId,
    patient_id: patientId,
    provider_id: providerId,
    title,
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + minutes * MINUTE).toISOString(),
    status,
    source: 'staff',
    created_by: userId,
  });
  return id;
}

beforeAll(async () => {
  userId = await insertUser(admin);
  clinicA = await insertClinic(admin);
  clinicB = await insertClinic(admin);
  const providerA = await insertProvider(admin, clinicA);
  const providerB = await insertProvider(admin, clinicB);
  let n = 0;
  for (const key of keys) a[key] = await patient(clinicA, `Name${++n}`, 'Dardha');
  bArrived = await patient(clinicB, 'Ana', 'Kodra');

  arrivedId = await visit(clinicA, providerA, a.arrived, at(9), 'arrived', 30, 'Root canal');
  // Ended days ago, never completed: by status alone, still in the chair (D-122).
  await visit(clinicA, providerA, a.arrivedLong, at(8, 6), 'arrived');
  await visit(clinicA, providerA, a.arrivedAndLater, at(11), 'arrived');
  laterBookedId = await visit(clinicA, providerA, a.arrivedAndLater, at(9, 9), 'booked');
  await visit(clinicA, providerA, a.onlyBooked, at(13), 'booked');
  await visit(clinicA, providerA, a.onlyBooked, at(12, 8), 'confirmed');
  await visit(clinicA, providerA, a.onlyOver, at(8, 3), 'completed');
  await visit(clinicA, providerA, a.onlyOver, at(8, 4), 'cancelled');
  await visit(clinicA, providerA, a.onlyOver, at(8, 5), 'no_show');
  // Two arrived visits: the earliest start is the one the profile shows.
  await visit(clinicA, providerA, a.twoArrived, at(11, 1), 'arrived');
  firstArrivedId = await visit(clinicA, providerA, a.twoArrived, at(8, 1), 'arrived');
  await visit(clinicB, providerB, bArrived, at(9), 'arrived');
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

const visitsOf = (clinicId: string, id: string) =>
  withTenant(clinicId, (tx) => patientVisits(tx, id, NOW));

const rowsOf = async (clinicId: string, text = '') => {
  const { rows } = await withTenant(clinicId, (tx) => listPatients(tx, text, NOW));
  return Object.fromEntries(rows.map((row) => [row.id, row]));
};

describe('the list (acceptance 1 and 2)', () => {
  it('inChair is true for an arrived visit whatever its end, with nextVisit as it was', async () => {
    const byId = await rowsOf(clinicA);
    expect(byId[a.arrived]).toMatchObject({ inChair: true, nextVisit: null });
    expect(byId[a.arrivedLong]).toMatchObject({ inChair: true, nextVisit: null });
    expect(byId[a.twoArrived]).toMatchObject({ inChair: true });
    // Arrived and a later booked visit: both, in the one row.
    expect(byId[a.arrivedAndLater]).toMatchObject({
      inChair: true,
      nextVisit: new Date(at(9, 9)).toISOString(),
    });
  });

  it('inChair is false with only booked, confirmed or finished visits, or none', async () => {
    const byId = await rowsOf(clinicA);
    expect(byId[a.onlyBooked]).toMatchObject({ inChair: false });
    expect(byId[a.onlyBooked]?.nextVisit).not.toBeNull();
    expect(byId[a.onlyOver]).toMatchObject({ inChair: false, nextVisit: null });
    expect(byId[a.none]).toMatchObject({ inChair: false, nextVisit: null });
  });

  it('a search that finds the patient in the chair still marks them', async () => {
    const found = await withTenant(clinicA, (tx) => listPatients(tx, 'Name1', NOW));
    expect(found.rows.map((row) => [row.id, row.inChair])).toEqual([[a.arrived, true]]);
  });

  it("the other clinic's arrived patient shows to nobody of this one", async () => {
    expect(Object.keys(await rowsOf(clinicA, 'Kodra'))).toEqual([]);
    expect(Object.entries(await rowsOf(clinicB)).map(([id, row]) => [id, row.inChair])).toEqual([
      [bArrived, true],
    ]);
    const map = await withTenant(clinicA, (tx) => lastAndNextVisits(tx, [bArrived], NOW));
    expect(map).toEqual(new Map());
  });
});

describe('the visit leaves the chair (tester, E01-T06d)', () => {
  it('backed out (booked again) or completed: both reads go back to what they were', async () => {
    const providerId = (
      await admin.query<{ id: string }>('select id from providers where clinic_id = $1 limit 1', [
        clinicA,
      ])
    ).rows[0]?.id;
    if (!providerId) throw new Error('A provider of the clinic was written.');
    const id = await patient(clinicA, 'Flip', 'Dardha');
    // Starts tomorrow, so once it is booked again it is the next visit: the chair line must go,
    // and the date come back, with nothing left over from the arrived state.
    const visitId = await visit(clinicA, providerId, id, at(9, 8), 'arrived');
    const row = async () => (await rowsOf(clinicA))[id];
    expect(await row()).toMatchObject({ inChair: true, nextVisit: null });
    expect((await visitsOf(clinicA, id)).inChair?.id).toBe(visitId);

    await admin.query("update appointments set status = 'booked' where id = $1", [visitId]);
    expect(await row()).toMatchObject({
      inChair: false,
      nextVisit: new Date(at(9, 8)).toISOString(),
    });
    const booked = await visitsOf(clinicA, id);
    expect(booked.inChair).toBeNull();
    expect(booked.next?.id).toBe(visitId);

    await admin.query("update appointments set status = 'arrived' where id = $1", [visitId]);
    await admin.query("update appointments set status = 'completed' where id = $1", [visitId]);
    expect(await row()).toMatchObject({ inChair: false, nextVisit: null });
    const done = await visitsOf(clinicA, id);
    expect(done.inChair).toBeNull();
    expect(done.next).toBeNull();
    expect(done.history.map((entry) => entry.id)).toEqual([visitId]);
  });

  it('two arrived visits that start together: the lower id, every time', async () => {
    // One chair each, so the two visits can share their start (a provider cannot be booked twice).
    const chairOne = await insertProvider(admin, clinicA);
    const chairTwo = await insertProvider(admin, clinicA);
    const id = await patient(clinicA, 'Tie', 'Dardha');
    const first = await visit(clinicA, chairOne, id, at(9, 2), 'arrived');
    const second = await visit(clinicA, chairTwo, id, at(9, 2), 'arrived');
    const expected = [first, second].sort()[0];
    for (let n = 0; n < 3; n += 1) {
      expect((await visitsOf(clinicA, id)).inChair?.id).toBe(expected);
    }
  });
});

describe('the profile read (acceptance 1 and 2)', () => {
  it('inChair is the arrived visit with its provider and label', async () => {
    const { inChair, next, history } = await visitsOf(clinicA, a.arrived);
    expect(inChair).toMatchObject({ id: arrivedId, title: 'Root canal' });
    expect(inChair?.providerName).toEqual(expect.any(String));
    expect(next).toBeNull();
    expect(history).toEqual([]);
  });

  it('an arrived visit that ended days ago still is', async () => {
    expect((await visitsOf(clinicA, a.arrivedLong)).inChair).not.toBeNull();
  });

  it('arrived and a later booked visit: inChair and next both', async () => {
    const { inChair, next } = await visitsOf(clinicA, a.arrivedAndLater);
    expect(inChair).not.toBeNull();
    expect(next?.id).toBe(laterBookedId);
  });

  it('only booked or confirmed, only finished, or no visits: inChair null, next as it was', async () => {
    const booked = await visitsOf(clinicA, a.onlyBooked);
    expect(booked.inChair).toBeNull();
    expect(booked.next).not.toBeNull();
    const over = await visitsOf(clinicA, a.onlyOver);
    expect(over.inChair).toBeNull();
    expect(over.next).toBeNull();
    expect(await visitsOf(clinicA, a.none)).toEqual({ next: null, inChair: null, history: [] });
  });

  it('two arrived visits: the earliest start', async () => {
    expect((await visitsOf(clinicA, a.twoArrived)).inChair?.id).toBe(firstArrivedId);
  });

  it("another clinic's arrived patient is read by nobody of this one", async () => {
    expect(await visitsOf(clinicA, bArrived)).toEqual({ next: null, inChair: null, history: [] });
    expect((await visitsOf(clinicB, bArrived)).inChair).not.toBeNull();
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookableProviders } from '@/app/(staff)/calendar/booking-choices';
import { bookAppointment, readCalendarDay } from '@/app/(staff)/calendar/actions';
import {
  activateProvider,
  changeProvider,
  deactivateProvider,
  readLinkedProviders,
} from '@/app/(staff)/settings/provider-actions';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { clinicsForUser, createStaffUser } from '@/modules/auth';
import * as scheduling from '@/modules/scheduling';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertRow, validRow, type ClinicRefs } from './scheduling-fixtures';

// E01-T09d, acceptance 1, 2, 3 and 5: changing a provider, the kind of one linked to a login locked,
// making one inactive and active again, as the app runs it: the real actions with a real session, the
// modules in a tenant transaction, as the app role, under Row-Level Security; then the calendar's
// read, the booking drawer's choices made from it, and the booking action (no browser). Only
// next/headers, next/cache and next-intl's request functions are replaced, as there is no running
// Next.js. Rows are set up and inspected as the migration role, links to logins too (memberships:
// linking is E04-T02's). Every value is synthetic: role words, invented names.

const PASSWORD = 'MARKER-pw-5c1d-correct';

const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));

// Outside a server action refresh() throws; each change calls it when it is done. The booking action
// revalidates the calendar's path when it is done.
const cache = vi.hoisted(() => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);

vi.mock('next-intl/server', () => ({
  getRequestConfig: (create: unknown) => create,
  getTranslations: () => Promise.resolve((key: string) => key),
}));

const admin = migratorPool();
let clinicA: string;
let clinicB: string;
const cookies = {} as Record<'owner' | 'dentist' | 'hygienist' | 'front_desk', string>;
let ownerId: string;
/** Clinic A's patient and treatment type, for the bookings. */
let patientA: string;
let treatmentA: string;
let patientB: string;

let nextAddress = 1;
const freshAddress = () => `10.53.0.${nextAddress++}`;

/** A Monday the calendar shows, far from today, on which the provider has no visit. */
const EMPTY_DAY = '2031-03-17';
/** The next day: the provider's visit ahead is on it, at 10:00 in the clinic's zone (08:00 UTC). */
const VISIT_DAY = '2031-03-18';

const SET_UP_AT = new Date('2026-01-05T08:00:00Z');

interface ProviderRow {
  id: string;
  name: string;
  short_name: string;
  kind: string;
  chair_label: string;
  color_hue: number;
  active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

/** The clinic's providers rows, in the calendar's order, as the migration role reads them. */
async function providersOf(clinicId: string): Promise<ProviderRow[]> {
  const { rows } = await admin.query<ProviderRow>(
    `select id, name, short_name, kind, chair_label, color_hue, active, sort_order, created_at,
            updated_at
       from providers where clinic_id = $1 order by sort_order, name, id`,
    [clinicId],
  );
  return rows;
}

async function providerRow(id: string): Promise<ProviderRow | undefined> {
  const { rows } = await admin.query<ProviderRow>(
    `select id, name, short_name, kind, chair_label, color_hue, active, sort_order, created_at,
            updated_at
       from providers where id = $1`,
    [id],
  );
  return rows[0];
}

/** Writes a provider as the migration role, set up long before any action of this file. */
async function setUpProvider(
  clinicId: string,
  values: { name?: string; sortOrder?: number; active?: boolean; kind?: string } = {},
): Promise<string> {
  const id = newId();
  const name = values.name ?? 'Mira Testova';
  await insertRow(admin, 'providers', {
    ...validRow('providers', { clinicId } as ClinicRefs),
    id,
    name,
    short_name: name.slice(0, 12),
    kind: values.kind ?? 'dentist',
    chair_label: 'Chair 9',
    color_hue: 120,
    active: values.active ?? true,
    sort_order: values.sortOrder ?? 0,
    created_at: SET_UP_AT,
    updated_at: SET_UP_AT,
  });
  return id;
}

/** Writes a visit of clinic A's patient with this provider, as the migration role; gives its id. */
async function setUpVisit(
  providerId: string,
  startsAt: Date,
  endsAt: Date,
  status = 'booked',
  clinicId = clinicA,
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'appointments', {
    id,
    clinic_id: clinicId,
    patient_id: clinicId === clinicA ? patientA : patientB,
    provider_id: providerId,
    treatment_type_id: clinicId === clinicA ? treatmentA : null,
    title: 'Check-up',
    starts_at: startsAt,
    ends_at: endsAt,
    status,
    source: 'staff',
    created_by: ownerId,
  });
  return id;
}

/** The clinic's visits as stored: provider, times, title and status, by start. */
async function visitsOf(clinicId: string) {
  const { rows } = await admin.query(
    `select id, provider_id, title, starts_at, ends_at, status, updated_at
       from appointments where clinic_id = $1 order by starts_at, id`,
    [clinicId],
  );
  return rows;
}

/** Every provider audit row of the clinic, oldest first. */
async function allProviderAudit(clinicId: string) {
  const { rows } = await admin.query(
    `select clinic_id, actor_type, actor_id, action, entity_type, entity_id, metadata
       from audit_log where clinic_id = $1 and action like 'provider.%'
      order by at, id`,
    [clinicId],
  );
  return rows;
}

const auditedBefore = new Map<string, number>();

/** The clinic's provider audit rows written since the test began. */
async function providerAudit(clinicId: string) {
  return (await allProviderAudit(clinicId)).slice(auditedBefore.get(clinicId) ?? 0);
}

/** The edit dialog's data as the browser sends it, with those given in place of these. */
function editForm(providerId: string, fields: Record<string, string> = {}): FormData {
  const all: Record<string, string> = {
    providerId,
    name: 'Ana Probna',
    shortName: 'Dr. Probna',
    kind: 'hygienist',
    chairLabel: 'Hygiene room',
    colorHue: '310',
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) data.append(name, value);
  return data;
}

/** A row's form: the id, hidden. */
function idForm(providerId: string): FormData {
  const data = new FormData();
  data.append('providerId', providerId);
  return data;
}

/** A booking of clinic A's patient with this provider at 11:00 on the day, as the drawer sends it. */
function bookingForm(providerId: string, day: string): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    patientId: patientA,
    providerId,
    treatmentTypeId: treatmentA,
    day,
    start: '11:00',
    length: '30',
  })) {
    data.append(name, value);
  }
  return data;
}

/** The calendar's columns on the day, by provider id, as the page reads them. */
async function columnsOn(day: string) {
  const read = await readCalendarDay(clinicA, { day });
  if (!read.ok) throw new Error(`not read: ${read.error.code}`);
  return read.value.view.columns;
}

function as(role: keyof typeof cookies, clinicId = clinicA): void {
  request.cookie = cookies[role];
  request.clinic = clinicId;
}

async function member(role: string, clinics: string[]): Promise<{ id: string; cookie: string }> {
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Owner', password: PASSWORD });
  for (const clinicId of clinics) await insertMembership(admin, { clinicId, userId: id, role });
  return { id, cookie: await signInCookie(email, PASSWORD, freshAddress()) };
}

/** A login linked to the provider by a membership of the clinic, as the migration role writes it. */
async function linkLogin(
  providerId: string,
  { status = 'active', role = 'dentist', clinicId = clinicA } = {},
): Promise<{ userId: string; membershipId: string }> {
  const { id: userId } = await createStaffUser({
    email: testEmail(),
    name: 'Dentist',
    password: PASSWORD,
  });
  const membershipId = await insertMembership(admin, {
    clinicId,
    userId,
    role,
    status,
    providerId,
  });
  return { userId, membershipId };
}

async function membershipRow(id: string) {
  const { rows } = await admin.query('select * from memberships where id = $1', [id]);
  return rows[0] as Record<string, unknown>;
}

beforeAll(async () => {
  [clinicA, clinicB] = [await insertClinic(admin), await insertClinic(admin)];
  const owner = await member('owner', [clinicA, clinicB]);
  ownerId = owner.id;
  cookies.owner = owner.cookie;
  for (const role of ['dentist', 'hygienist', 'front_desk'] as const) {
    cookies[role] = (await member(role, [clinicA])).cookie;
  }
  const patient = validRow('patients', { clinicId: clinicA } as ClinicRefs);
  await insertRow(admin, 'patients', patient);
  patientA = patient.id as string;
  const otherPatient = validRow('patients', { clinicId: clinicB } as ClinicRefs);
  await insertRow(admin, 'patients', otherPatient);
  patientB = otherPatient.id as string;
  const treatment = validRow('treatment_types', { clinicId: clinicA } as ClinicRefs);
  await insertRow(admin, 'treatment_types', treatment);
  treatmentA = treatment.id as string;
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(async () => {
  cache.refresh.mockClear();
  for (const clinicId of [clinicA, clinicB]) {
    await admin.query('delete from appointments where clinic_id = $1', [clinicId]);
    await admin.query('update memberships set provider_id = null where clinic_id = $1', [clinicId]);
    await admin.query('delete from provider_breaks where clinic_id = $1', [clinicId]);
    await admin.query('delete from providers where clinic_id = $1', [clinicId]);
    auditedBefore.set(clinicId, (await allProviderAudit(clinicId)).length);
  }
});

describe('a provider changed on the tab (acceptance 1)', () => {
  it("name, short name, kind, chair and colour stored, updated_at the action's moment, the rest kept; one provider.updated row of ids; the visit already booked unchanged; the calendar's column and the drawer's choice show it", async () => {
    const id = await setUpProvider(clinicA, { name: 'Mira Testova', sortOrder: 4 });
    const visit = await setUpVisit(
      id,
      new Date('2031-03-18T08:00:00Z'),
      new Date('2031-03-18T08:30:00Z'),
    );
    const visitBefore = await visitsOf(clinicA);
    as('owner');
    const before = new Date();
    const result = await changeProvider(
      clinicA,
      editForm(id, { name: ' Ana Probna ', chairLabel: ' Hygiene room ' }),
    );
    const after = new Date();
    expect(result).toEqual({ ok: true, value: { id } });
    const row = await providerRow(id);
    expect(row).toMatchObject({
      name: 'Ana Probna',
      short_name: 'Dr. Probna',
      kind: 'hygienist',
      chair_label: 'Hygiene room',
      color_hue: 310,
      active: true,
      sort_order: 4,
      created_at: SET_UP_AT,
    });
    expect(row!.updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row!.updated_at.getTime()).toBeLessThanOrEqual(after.getTime());
    const audited = await providerAudit(clinicA);
    expect(audited).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'provider.updated',
        entity_type: 'provider',
        entity_id: id,
        metadata: {},
      },
    ]);
    expect(JSON.stringify(audited)).not.toMatch(/Probna|Hygiene/);
    expect(cache.refresh).toHaveBeenCalledOnce();
    // The visit booked with it as it was: its provider, title, times and status.
    expect(await visitsOf(clinicA)).toEqual(visitBefore);
    expect(visitBefore.map((each) => each.id)).toEqual([visit]);

    const columns = await columnsOn(VISIT_DAY);
    expect(columns.find((column) => column.providerId === id)).toMatchObject({
      name: 'Ana Probna',
      shortName: 'Dr. Probna',
      chairLabel: 'Hygiene room',
      hue: 310,
      active: true,
    });
    expect(bookableProviders(columns)).toEqual([{ id, shortName: 'Dr. Probna' }]);
  });

  it('an inactive provider is changed too, and stays inactive', async () => {
    const id = await setUpProvider(clinicA, { active: false });
    as('owner');
    expect(await changeProvider(clinicA, editForm(id))).toEqual({ ok: true, value: { id } });
    expect(await providerRow(id)).toMatchObject({ name: 'Ana Probna', active: false });
  });

  it('no provider by that id: not_found, nothing written, no audit row', async () => {
    await setUpProvider(clinicA);
    const rows = await providersOf(clinicA);
    as('owner');
    expect(await changeProvider(clinicA, editForm(newId()))).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await providersOf(clinicA)).toEqual(rows);
    expect(await providerAudit(clinicA)).toEqual([]);
  });

  it('the module refuses what the schema would have, with an Error naming no value; nothing written', async () => {
    const id = await setUpProvider(clinicA);
    const rows = await providersOf(clinicA);
    const bad: scheduling.ProviderFields = {
      name: 'MARKER-provider',
      shortName: 'Dr. Testova',
      kind: 'dentist',
      chairLabel: 'Chair 4',
      colorHue: 360,
    };
    const changed = withTenant(clinicA, (tx) =>
      scheduling.changeProvider(tx, id, bad, new Date(), { kindLocked: false }),
    );
    await expect(changed).rejects.toThrow('changeProvider: the provider cannot be stored');
    await expect(changed).rejects.not.toThrow(/MARKER/);
    expect(await providersOf(clinicA)).toEqual(rows);
  });
});

describe('a provider linked to a login keeps its kind (acceptance 2)', () => {
  it.each(['active', 'disabled'])(
    'linked by a membership %s: another kind is refused as provider_linked, nothing written, no audit row; its own kind saves with the other fields',
    async (status) => {
      const id = await setUpProvider(clinicA, { kind: 'dentist' });
      await linkLogin(id, { status });
      const before = await providerRow(id);
      as('owner');
      for (const kind of ['hygienist', 'other']) {
        expect(await changeProvider(clinicA, editForm(id, { kind })), kind).toEqual({
          ok: false,
          error: { code: 'provider_linked' },
        });
      }
      expect(await providerRow(id)).toEqual(before);
      expect(await providerAudit(clinicA)).toEqual([]);
      expect(cache.refresh).not.toHaveBeenCalled();

      expect(await changeProvider(clinicA, editForm(id, { kind: 'dentist' }))).toEqual({
        ok: true,
        value: { id },
      });
      expect(await providerRow(id)).toMatchObject({
        name: 'Ana Probna',
        short_name: 'Dr. Probna',
        kind: 'dentist',
        chair_label: 'Hygiene room',
        color_hue: 310,
      });
      expect((await providerAudit(clinicA)).map((row) => row.action)).toEqual(['provider.updated']);
    },
  );

  it("another provider's link does not lock this one; a link in clinic B does not lock clinic A's", async () => {
    const free = await setUpProvider(clinicA, { name: 'Vera Vzorec', kind: 'dentist' });
    const linked = await setUpProvider(clinicA, { name: 'Ana Probna', kind: 'dentist' });
    await linkLogin(linked);
    const elsewhere = await setUpProvider(clinicB, { kind: 'dentist' });
    await linkLogin(elsewhere, { clinicId: clinicB });
    as('owner');
    expect(await changeProvider(clinicA, editForm(free, { kind: 'other' }))).toMatchObject({
      ok: true,
    });
    expect(await providerRow(free)).toMatchObject({ kind: 'other' });
  });

  it("made inactive and active again, a linked provider's login keeps its access: the membership and clinics_for_user() as they were", async () => {
    const id = await setUpProvider(clinicA, { kind: 'dentist' });
    const { userId, membershipId } = await linkLogin(id, { role: 'owner' });
    const membership = await membershipRow(membershipId);
    const choices = await clinicsForUser(userId);
    expect(choices.map((choice) => [choice.clinicId, choice.providerKind])).toEqual([
      [clinicA, 'dentist'],
    ]);
    as('owner');
    expect(await deactivateProvider(clinicA, idForm(id))).toMatchObject({ ok: true });
    expect(await providerRow(id)).toMatchObject({ active: false });
    expect(await membershipRow(membershipId)).toEqual(membership);
    expect(await clinicsForUser(userId)).toEqual(choices);
    expect(await activateProvider(clinicA, idForm(id))).toMatchObject({ ok: true });
    expect(await membershipRow(membershipId)).toEqual(membership);
    expect(await clinicsForUser(userId)).toEqual(choices);
  });

  it("the tab's read of the links: clinic A's linked providers, each once, a disabled membership's too; none of clinic B's; ids alone", async () => {
    const one = await setUpProvider(clinicA, { name: 'Ana Probna' });
    const two = await setUpProvider(clinicA, { name: 'Vera Vzorec' });
    await setUpProvider(clinicA, { name: 'Boris Bliznak' });
    await linkLogin(one);
    await linkLogin(one, { role: 'owner' });
    await linkLogin(two, { status: 'disabled', role: 'hygienist' });
    const elsewhere = await setUpProvider(clinicB);
    await linkLogin(elsewhere, { clinicId: clinicB });
    as('owner');
    const read = await readLinkedProviders.forPage({});
    if (!read.ok) throw new Error('not read');
    expect([...read.value].sort()).toEqual([one, two].sort());
  });
});

describe('made inactive, and active again (acceptance 3)', () => {
  it("made inactive: one provider.deactivated row; the visits ahead counted and still booked, a cancelled, no-show, completed or past one not counted; not a column on a day without their visits, not a choice, a booking refused; a column on their visit's day", async () => {
    const other = await setUpProvider(clinicA, { name: 'Vera Vzorec', sortOrder: 0 });
    const id = await setUpProvider(clinicA, { name: 'Ana Probna', sortOrder: 1 });
    const now = Date.now();
    const minutes = (n: number) => new Date(now + n * 60_000);
    // Ahead: booked, confirmed, arrived on its visit day; and one under way now.
    await setUpVisit(id, new Date('2031-03-18T08:00:00Z'), new Date('2031-03-18T08:30:00Z'));
    await setUpVisit(
      id,
      new Date('2031-03-18T09:00:00Z'),
      new Date('2031-03-18T09:30:00Z'),
      'confirmed',
    );
    await setUpVisit(
      id,
      new Date('2031-03-19T09:00:00Z'),
      new Date('2031-03-19T09:30:00Z'),
      'arrived',
    );
    await setUpVisit(id, minutes(-20), minutes(40));
    // Not ahead: cancelled, no-show and completed ones to come, a past one, and another's.
    await setUpVisit(
      id,
      new Date('2031-03-20T09:00:00Z'),
      new Date('2031-03-20T09:30:00Z'),
      'cancelled',
    );
    await setUpVisit(
      id,
      new Date('2031-03-20T10:00:00Z'),
      new Date('2031-03-20T10:30:00Z'),
      'no_show',
    );
    await setUpVisit(
      id,
      new Date('2031-03-20T11:00:00Z'),
      new Date('2031-03-20T11:30:00Z'),
      'completed',
    );
    await setUpVisit(id, minutes(-90), minutes(-30));
    await setUpVisit(other, new Date('2031-03-21T09:00:00Z'), new Date('2031-03-21T09:30:00Z'));
    const visitsBefore = await visitsOf(clinicA);
    as('owner');
    const before = new Date();
    expect(await deactivateProvider(clinicA, idForm(id))).toEqual({
      ok: true,
      value: { id, visitsAhead: 4 },
    });
    const row = await providerRow(id);
    expect(row).toMatchObject({ active: false, name: 'Ana Probna', sort_order: 1 });
    expect(row!.updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(await providerAudit(clinicA)).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'provider.deactivated',
        entity_type: 'provider',
        entity_id: id,
        metadata: {},
      },
    ]);
    // Every appointment kept as it was.
    expect(await visitsOf(clinicA)).toEqual(visitsBefore);

    const empty = await columnsOn(EMPTY_DAY);
    expect(empty.map((column) => column.providerId)).toEqual([other]);
    expect(bookableProviders(empty)).toEqual([{ id: other, shortName: 'Vera Vzorec' }]);
    const visitDay = await columnsOn(VISIT_DAY);
    expect(visitDay.map((column) => [column.providerId, column.active])).toEqual([
      [other, true],
      [id, false],
    ]);
    expect(bookableProviders(visitDay).map((provider) => provider.id)).toEqual([other]);
    expect(await bookAppointment(clinicA, bookingForm(id, EMPTY_DAY))).toEqual({
      ok: false,
      error: { code: 'provider_not_bookable' },
    });
    expect(await visitsOf(clinicA)).toEqual(visitsBefore);
  });

  it('none ahead: the count is 0', async () => {
    const id = await setUpProvider(clinicA);
    await setUpVisit(id, new Date('2020-03-18T08:00:00Z'), new Date('2020-03-18T08:30:00Z'));
    as('owner');
    expect(await deactivateProvider(clinicA, idForm(id))).toEqual({
      ok: true,
      value: { id, visitsAhead: 0 },
    });
  });

  it("only this clinic's visits are counted, as Row-Level Security limits the count", async () => {
    const id = await setUpProvider(clinicA);
    await setUpVisit(id, new Date('2031-03-18T08:00:00Z'), new Date('2031-03-18T08:30:00Z'));
    const count = await withTenant(clinicB, (tx) =>
      scheduling.visitsAhead(tx, id, new Date('2026-01-01T00:00:00Z')),
    );
    expect(count).toBe(0);
  });

  it('made active again: one provider.activated row; a column on a day without their visits, a choice, and a booking with them books', async () => {
    const id = await setUpProvider(clinicA, { active: false });
    as('owner');
    expect(bookableProviders(await columnsOn(EMPTY_DAY))).toEqual([]);
    expect(await activateProvider(clinicA, idForm(id))).toEqual({ ok: true, value: { id } });
    expect(await providerRow(id)).toMatchObject({ active: true });
    expect((await providerAudit(clinicA)).map((row) => [row.action, row.entity_id])).toEqual([
      ['provider.activated', id],
    ]);
    const columns = await columnsOn(EMPTY_DAY);
    expect(columns.map((column) => column.providerId)).toEqual([id]);
    expect(bookableProviders(columns).map((provider) => provider.id)).toEqual([id]);
    expect(await bookAppointment(clinicA, bookingForm(id, EMPTY_DAY))).toMatchObject({
      ok: true,
      value: { providerId: id },
    });
  });

  it("a second press on a provider's state: already_inactive, already_active; nothing written, no audit row", async () => {
    const inactive = await setUpProvider(clinicA, { name: 'Ana Probna', active: false });
    const active = await setUpProvider(clinicA, { name: 'Vera Vzorec' });
    const rows = await providersOf(clinicA);
    as('owner');
    expect(await deactivateProvider(clinicA, idForm(inactive))).toEqual({
      ok: false,
      error: { code: 'already_inactive' },
    });
    expect(await activateProvider(clinicA, idForm(active))).toEqual({
      ok: false,
      error: { code: 'already_active' },
    });
    expect(await providersOf(clinicA)).toEqual(rows);
    expect(await providerAudit(clinicA)).toEqual([]);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it('two presses of Make inactive at once: the state changes once, one is already_inactive, one audit row', async () => {
    const id = await setUpProvider(clinicA);
    as('owner');
    const answers = await Promise.all([
      deactivateProvider(clinicA, idForm(id)),
      deactivateProvider(clinicA, idForm(id)),
    ]);
    expect(answers.map((answer) => answer.ok).sort()).toEqual([false, true]);
    expect(answers.find((answer) => !answer.ok)).toEqual({
      ok: false,
      error: { code: 'already_inactive' },
    });
    expect((await providerAudit(clinicA)).map((row) => row.action)).toEqual([
      'provider.deactivated',
    ]);
  });
});

describe('only settings.manage, and only its own clinic (acceptance 5)', () => {
  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, for the links read, the edit, Make inactive and Make active; the rows and the audit log as they were',
    async (role) => {
      const active = await setUpProvider(clinicA, { name: 'Ana Probna' });
      const inactive = await setUpProvider(clinicA, { name: 'Vera Vzorec', active: false });
      const rows = await providersOf(clinicA);
      as(role);
      const forbidden = { ok: false, error: { code: 'forbidden' } };
      expect(await readLinkedProviders(clinicA, {})).toEqual(forbidden);
      expect(await readLinkedProviders.forPage({})).toEqual(forbidden);
      expect(await changeProvider(clinicA, editForm(active))).toEqual(forbidden);
      expect(await deactivateProvider(clinicA, idForm(active))).toEqual(forbidden);
      expect(await activateProvider(clinicA, idForm(inactive))).toEqual(forbidden);
      expect(await providersOf(clinicA)).toEqual(rows);
      expect(await providerAudit(clinicA)).toEqual([]);
    },
  );

  it("clinic B's provider by its id, sent in clinic A: not_found for the edit, Make inactive and Make active; nothing written in either clinic, no audit row", async () => {
    const activeB = await setUpProvider(clinicB, { name: 'Ana Probna' });
    const inactiveB = await setUpProvider(clinicB, { name: 'Vera Vzorec', active: false });
    await setUpVisit(
      activeB,
      new Date('2031-03-18T08:00:00Z'),
      new Date('2031-03-18T08:30:00Z'),
      'booked',
      clinicB,
    );
    const rowsB = await providersOf(clinicB);
    as('owner', clinicA);
    const notFound = { ok: false, error: { code: 'not_found' } };
    expect(await changeProvider(clinicA, editForm(activeB))).toEqual(notFound);
    expect(await deactivateProvider(clinicA, idForm(activeB))).toEqual(notFound);
    expect(await activateProvider(clinicA, idForm(inactiveB))).toEqual(notFound);
    expect(await providersOf(clinicB)).toEqual(rowsB);
    expect(await providerAudit(clinicA)).toEqual([]);
    expect(await providerAudit(clinicB)).toEqual([]);
  });

  it("an owner of clinic A only, sending clinic B's id as the clinic: refused, nothing written in B", async () => {
    const providerB = await setUpProvider(clinicB);
    const rowsB = await providersOf(clinicB);
    const onlyA = await member('owner', [clinicA]);
    request.cookie = onlyA.cookie;
    request.clinic = clinicA;
    for (const answer of [
      await changeProvider(clinicB, editForm(providerB)),
      await deactivateProvider(clinicB, idForm(providerB)),
      await activateProvider(clinicB, idForm(providerB)),
    ]) {
      expect(answer.ok).toBe(false);
    }
    expect(await providersOf(clinicB)).toEqual(rowsB);
    expect(await providerAudit(clinicB)).toEqual([]);
  });
});

// E01-T09d, the tester's cases: the edges of the count, a crafted request, and presses at once.
describe("the tester's edges (E01-T09d)", () => {
  it('the visits ahead at a fixed now: one ending at now is not ahead, one ending a millisecond after it is, one starting at it is; of the statuses, booked, confirmed and arrived count, completed, cancelled and no-show do not', async () => {
    const id = await setUpProvider(clinicA);
    const at = (time: string) => new Date(`2031-03-18T${time}Z`);
    // One visit at 08:00-08:30; then one of each status, an hour apart from 10:00 (booked first).
    await setUpVisit(id, at('08:00:00'), at('08:30:00'));
    for (const [index, status] of scheduling.APPOINTMENT_STATUSES.entries()) {
      const hour = String(10 + index).padStart(2, '0');
      await setUpVisit(id, at(`${hour}:00:00`), at(`${hour}:30:00`), status);
    }
    const ahead = (now: Date) => withTenant(clinicA, (tx) => scheduling.visitsAhead(tx, id, now));
    // A millisecond before the first visit ends: it is ahead, with booked, confirmed and arrived.
    expect(await ahead(at('08:29:59.999'))).toBe(4);
    // At its end: no longer ahead.
    expect(await ahead(at('08:30:00'))).toBe(3);
    // At the booked visit's start it still counts; at its end it does not.
    expect(await ahead(at('10:00:00'))).toBe(3);
    expect(await ahead(at('10:30:00'))).toBe(2);
  });

  it('a crafted edit that also sends active and sortOrder: those ignored, the provider still active at its place, the fields changed', async () => {
    const id = await setUpProvider(clinicA, { sortOrder: 4 });
    as('owner');
    expect(
      await changeProvider(clinicA, editForm(id, { active: 'false', sortOrder: '0' })),
    ).toEqual({ ok: true, value: { id } });
    expect(await providerRow(id)).toMatchObject({
      name: 'Ana Probna',
      kind: 'hygienist',
      active: true,
      sort_order: 4,
    });
  });

  it("a linked provider's kind sent twice, its own and another, in either order: never another kind stored", async () => {
    const id = await setUpProvider(clinicA, { kind: 'dentist' });
    await linkLogin(id);
    as('owner');
    for (const kinds of [
      ['dentist', 'other'],
      ['other', 'dentist'],
    ]) {
      const data = editForm(id);
      data.delete('kind');
      for (const kind of kinds) data.append('kind', kind);
      const answer = await changeProvider(clinicA, data);
      if (!answer.ok) expect(['provider_linked', 'invalid_input']).toContain(answer.error.code);
      expect(await providerRow(id), kinds.join(',')).toMatchObject({ kind: 'dentist' });
    }
  });

  it('two presses of Make active at once: the state changes once, one is already_active, one audit row', async () => {
    const id = await setUpProvider(clinicA, { active: false });
    as('owner');
    const answers = await Promise.all([
      activateProvider(clinicA, idForm(id)),
      activateProvider(clinicA, idForm(id)),
    ]);
    expect(answers.map((answer) => answer.ok).sort()).toEqual([false, true]);
    expect(answers.find((answer) => !answer.ok)).toEqual({
      ok: false,
      error: { code: 'already_active' },
    });
    expect(await providerRow(id)).toMatchObject({ active: true });
    expect((await providerAudit(clinicA)).map((row) => row.action)).toEqual(['provider.activated']);
  });

  it('an edit and a Make inactive at once (two tabs): both land, the provider inactive with the new fields, two audit rows', async () => {
    const id = await setUpProvider(clinicA);
    as('owner');
    const [edited, deactivated] = await Promise.all([
      changeProvider(clinicA, editForm(id)),
      deactivateProvider(clinicA, idForm(id)),
    ]);
    expect(edited).toEqual({ ok: true, value: { id } });
    expect(deactivated).toEqual({ ok: true, value: { id, visitsAhead: 0 } });
    expect(await providerRow(id)).toMatchObject({
      name: 'Ana Probna',
      kind: 'hygienist',
      active: false,
    });
    expect((await providerAudit(clinicA)).map((row) => row.action).sort()).toEqual([
      'provider.deactivated',
      'provider.updated',
    ]);
  });
});

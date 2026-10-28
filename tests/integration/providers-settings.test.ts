import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookableProviders } from '@/app/(staff)/calendar/booking-choices';
import { bookAppointment, readCalendarDay } from '@/app/(staff)/calendar/actions';
import { addProvider, readProviders } from '@/app/(staff)/settings/provider-actions';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import * as scheduling from '@/modules/scheduling';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertRow, validRow, type ClinicRefs } from './scheduling-fixtures';

// E01-T09b, acceptance 1, 2, 4 and 5: the Providers tab as the app runs it: the real actions with a
// real session, the scheduling module in a tenant transaction, as the app role, under Row-Level
// Security; then the calendar's read, the booking drawer's choices made from it, and the booking
// action (no browser). Only next/headers, next/cache and next-intl's request functions are replaced,
// as there is no running Next.js. Rows are set up and inspected as the migration role. Every value is
// synthetic: role words, invented names.

const PASSWORD = 'MARKER-pw-8e3a-correct';

const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));

// Outside a server action refresh() throws; the add calls it when it is done. The booking action
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
/** Clinic A's patient and treatment type, for the booking. */
let patientA: string;
let treatmentA: string;

let nextAddress = 1;
const freshAddress = () => `10.51.0.${nextAddress++}`;

/** A Monday the calendar shows, far from today: bookings on it are the file's own. */
const DAY = '2031-03-17';

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

/** Writes a provider as the migration role, set up long before any action of this file. */
async function setUpProvider(
  clinicId: string,
  values: {
    name: string;
    sortOrder: number;
    active?: boolean;
    kind?: 'dentist' | 'hygienist' | 'other';
    hue?: number;
  },
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'providers', {
    ...validRow('providers', { clinicId } as ClinicRefs),
    id,
    name: values.name,
    short_name: values.name.slice(0, 12),
    kind: values.kind ?? 'dentist',
    chair_label: 'Chair 9',
    color_hue: values.hue ?? 120,
    active: values.active ?? true,
    sort_order: values.sortOrder,
    created_at: SET_UP_AT,
    updated_at: SET_UP_AT,
  });
  return id;
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

/** The add form's data as the browser sends it, with those given in place of these. */
function providerForm(fields: Record<string, string | undefined> = {}): FormData {
  const all: Record<string, string | undefined> = {
    name: 'Mira Testova',
    shortName: 'Dr. Testova',
    kind: 'dentist',
    chairLabel: 'Chair 4',
    colorHue: '200',
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) {
    if (value !== undefined) data.append(name, value);
  }
  return data;
}

/** A booking of clinic A's patient with this provider on DAY at 10:00, as the drawer sends it. */
function bookingForm(providerId: string): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    patientId: patientA,
    providerId,
    treatmentTypeId: treatmentA,
    day: DAY,
    start: '10:00',
    length: '30',
  })) {
    data.append(name, value);
  }
  return data;
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
    await admin.query('delete from provider_breaks where clinic_id = $1', [clinicId]);
    await admin.query('delete from providers where clinic_id = $1', [clinicId]);
    auditedBefore.set(clinicId, (await allProviderAudit(clinicId)).length);
  }
});

describe('a provider added on the tab (acceptance 1, 2, 5)', () => {
  it("added: its row, the texts trimmed, active, at the action's moment, sort_order 0 as the clinic's first; one provider.created row of ids, metadata {}; the page refreshed", async () => {
    as('owner');
    const before = new Date();
    const result = await addProvider(
      clinicA,
      providerForm({
        name: '  Mira Testova ',
        shortName: ' Dr. Testova ',
        kind: 'hygienist',
        chairLabel: ' Chair 4  ',
        colorHue: '37',
      }),
    );
    const after = new Date();
    if (!result.ok) throw new Error(`refused: ${result.error.code}`);
    const [row, ...others] = await providersOf(clinicA);
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      id: result.value.id,
      name: 'Mira Testova',
      short_name: 'Dr. Testova',
      kind: 'hygienist',
      chair_label: 'Chair 4',
      color_hue: 37,
      active: true,
      sort_order: 0,
    });
    expect(row!.created_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row!.created_at.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(row!.updated_at).toEqual(row!.created_at);
    const audited = await providerAudit(clinicA);
    expect(audited).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'provider.created',
        entity_type: 'provider',
        entity_id: result.value.id,
        metadata: {},
      },
    ]);
    expect(JSON.stringify(audited)).not.toMatch(/Testova|Chair 4/);
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('the next one goes last: one above the highest, an inactive one counted; then one above that', async () => {
    await setUpProvider(clinicA, { name: 'Ana Probna', sortOrder: 3 });
    await setUpProvider(clinicA, { name: 'Petar Primerov', sortOrder: 7, active: false });
    await setUpProvider(clinicA, { name: 'Vera Vzorec', sortOrder: 5 });
    as('owner');
    const first = await addProvider(clinicA, providerForm({ name: 'Mira Testova' }));
    const second = await addProvider(clinicA, providerForm({ name: 'Ivo Ogledov' }));
    if (!first.ok || !second.ok) throw new Error('not added');
    const rows = await providersOf(clinicA);
    expect(rows.map((row) => [row.name, row.sort_order])).toEqual([
      ['Ana Probna', 3],
      ['Vera Vzorec', 5],
      ['Petar Primerov', 7],
      ['Mira Testova', 8],
      ['Ivo Ogledov', 9],
    ]);
  });

  it("another clinic's order is not counted: clinic A's first is 0 while clinic B has a provider at 40", async () => {
    await setUpProvider(clinicB, { name: 'Ana Probna', sortOrder: 40 });
    as('owner', clinicA);
    expect((await addProvider(clinicA, providerForm())).ok).toBe(true);
    expect((await providersOf(clinicA)).map((row) => row.sort_order)).toEqual([0]);
    expect(await providersOf(clinicB)).toHaveLength(1);
    expect(await providerAudit(clinicB)).toEqual([]);
  });

  it('two adds at once, no lock (D-119): both written, each last at its own read; the calendar orders a tie by name', async () => {
    await setUpProvider(clinicA, { name: 'Ana Probna', sortOrder: 0 });
    const fields = (name: string): scheduling.ProviderFields => ({
      name,
      shortName: name.slice(0, 12),
      kind: 'dentist',
      chairLabel: 'Chair 2',
      colorHue: 90,
    });
    const added = await Promise.all(
      ['Zora Zadnja', 'Boris Bliznak'].map((name) =>
        withTenant(clinicA, (tx) => scheduling.addProvider(tx, fields(name), new Date())),
      ),
    );
    expect(added).toHaveLength(2);
    const rows = await providersOf(clinicA);
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).every((row) => row.sort_order >= 1 && row.sort_order <= 2)).toBe(true);
    // A tie, or one after the other: either way both stand after the first, in a fixed order.
    const shared = rows[1]!.sort_order === rows[2]!.sort_order;
    if (shared)
      expect(rows.slice(1).map((row) => row.name)).toEqual(['Boris Bliznak', 'Zora Zadnja']);
  });

  it('is a column on the calendar and a choice in the booking drawer, and books (acceptance 1)', async () => {
    await setUpProvider(clinicA, { name: 'Ana Probna', sortOrder: 0 });
    as('owner');
    const added = await addProvider(
      clinicA,
      providerForm({ name: 'Mira Testova', shortName: 'Dr. Testova', colorHue: '310' }),
    );
    if (!added.ok) throw new Error('not added');
    const read = await readCalendarDay(clinicA, { day: DAY });
    if (!read.ok) throw new Error('not read');
    const columns = read.value.view.columns;
    expect(columns.map((column) => column.providerId).at(-1)).toBe(added.value.id);
    expect(columns.at(-1)).toMatchObject({
      providerId: added.value.id,
      name: 'Mira Testova',
      shortName: 'Dr. Testova',
      chairLabel: 'Chair 4',
      hue: 310,
      active: true,
    });
    expect(bookableProviders(columns).at(-1)).toEqual({
      id: added.value.id,
      shortName: 'Dr. Testova',
    });
    const booked = await bookAppointment(clinicA, bookingForm(added.value.id));
    expect(booked).toMatchObject({ ok: true, value: { providerId: added.value.id } });
    const { rows } = await admin.query(
      'select provider_id from appointments where clinic_id = $1',
      [clinicA],
    );
    expect(rows).toEqual([{ provider_id: added.value.id }]);
  });
});

describe('what the input alone settles is shown at its field, nothing written (acceptance 2: a crafted request)', () => {
  it.each([
    { what: 'an empty name', fields: { name: '' }, path: 'name' },
    { what: 'a name of blanks', fields: { name: '   ' }, path: 'name' },
    { what: 'a name of 101 characters', fields: { name: 'n'.repeat(101) }, path: 'name' },
    { what: 'an empty short name', fields: { shortName: '' }, path: 'shortName' },
    {
      what: 'a short name of 13 characters',
      fields: { shortName: 's'.repeat(13) },
      path: 'shortName',
    },
    { what: 'an empty chair', fields: { chairLabel: '  ' }, path: 'chairLabel' },
    {
      what: 'a chair of 101 characters',
      fields: { chairLabel: 'c'.repeat(101) },
      path: 'chairLabel',
    },
    { what: 'a kind the table does not allow', fields: { kind: 'surgeon' }, path: 'kind' },
    { what: 'a hue of 360', fields: { colorHue: '360' }, path: 'colorHue' },
    { what: 'a negative hue', fields: { colorHue: '-5' }, path: 'colorHue' },
    { what: 'a hue with decimals', fields: { colorHue: '12.5' }, path: 'colorHue' },
    { what: 'a hue of letters', fields: { colorHue: 'abc' }, path: 'colorHue' },
    { what: 'an empty hue', fields: { colorHue: '' }, path: 'colorHue' },
    { what: 'no hue sent', fields: { colorHue: undefined }, path: 'colorHue' },
  ])('$what: invalid_input at $path; no row, no audit row', async ({ fields, path }) => {
    as('owner');
    const result = await addProvider(clinicA, providerForm(fields));
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const issues = (result as { error: { issues: { path: unknown[] }[] } }).error.issues;
    expect(issues.map((issue) => issue.path)).toEqual([[path]]);
    expect(await providersOf(clinicA)).toEqual([]);
    expect(await providerAudit(clinicA)).toEqual([]);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it('the module refuses what the schema would have, with an Error naming no value; nothing written', async () => {
    const bad: scheduling.ProviderFields = {
      name: 'MARKER-provider',
      shortName: 'Dr. Testova',
      kind: 'dentist',
      chairLabel: 'Chair 4',
      colorHue: 360,
    };
    const added = withTenant(clinicA, (tx) => scheduling.addProvider(tx, bad, new Date()));
    await expect(added).rejects.toThrow('addProvider: the provider cannot be stored');
    await expect(added).rejects.not.toThrow(/MARKER/);
    expect(await providersOf(clinicA)).toEqual([]);
  });
});

describe("the tab's read (acceptance 4)", () => {
  it("every provider of the clinic with kind, chair and hue, in the calendar's order (sort_order, name, id), an inactive one among them", async () => {
    const c = await setUpProvider(clinicA, { name: 'Vera Vzorec', sortOrder: 2, kind: 'other' });
    const a = await setUpProvider(clinicA, { name: 'Ana Probna', sortOrder: 1, hue: 300 });
    const gone = await setUpProvider(clinicA, {
      name: 'Boris Bliznak',
      sortOrder: 2,
      active: false,
      kind: 'hygienist',
      hue: 25,
    });
    as('owner');
    const read = await readProviders.forPage({});
    if (!read.ok) throw new Error('not read');
    expect(read.value).toEqual([
      {
        id: a,
        name: 'Ana Probna',
        shortName: 'Ana Probna',
        kind: 'dentist',
        chairLabel: 'Chair 9',
        colorHue: 300,
        active: true,
      },
      {
        id: gone,
        name: 'Boris Bliznak',
        shortName: 'Boris Blizna',
        kind: 'hygienist',
        chairLabel: 'Chair 9',
        colorHue: 25,
        active: false,
      },
      {
        id: c,
        name: 'Vera Vzorec',
        shortName: 'Vera Vzorec',
        kind: 'other',
        chairLabel: 'Chair 9',
        colorHue: 120,
        active: true,
      },
    ]);
    // The calendar's own read keeps the same order (listProviders, unchanged).
    const calendarOrder = await withTenant(clinicA, (tx) => scheduling.listProviders(tx));
    expect(calendarOrder.map((provider) => provider.id)).toEqual([a, gone, c]);
  });

  it("clinic A's read lists none of clinic B's providers", async () => {
    await setUpProvider(clinicB, { name: 'Ana Probna', sortOrder: 0 });
    const own = await setUpProvider(clinicA, { name: 'Vera Vzorec', sortOrder: 0 });
    as('owner', clinicA);
    const read = await readProviders.forPage({});
    expect(read.ok && read.value.map((provider) => provider.id)).toEqual([own]);
  });
});

describe('only settings.manage reads or adds (acceptance 5)', () => {
  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, for the read and the add; the rows and the audit log as they were',
    async (role) => {
      await setUpProvider(clinicA, { name: 'Ana Probna', sortOrder: 0 });
      const rows = await providersOf(clinicA);
      as(role);
      const forbidden = { ok: false, error: { code: 'forbidden' } };
      expect(await readProviders(clinicA, {})).toEqual(forbidden);
      expect(await readProviders.forPage({})).toEqual(forbidden);
      expect(await addProvider(clinicA, providerForm())).toEqual(forbidden);
      expect(await providersOf(clinicA)).toEqual(rows);
      expect(await providerAudit(clinicA)).toEqual([]);
    },
  );

  it("an owner of clinic A only, sending clinic B's id: refused, nothing written in B", async () => {
    const onlyA = await member('owner', [clinicA]);
    request.cookie = onlyA.cookie;
    request.clinic = clinicA;
    const result = await addProvider(clinicB, providerForm());
    expect(result.ok).toBe(false);
    expect(await providersOf(clinicB)).toEqual([]);
    expect(await providerAudit(clinicB)).toEqual([]);
  });
});

// Tester, E01-T09b: cases the builder's file did not have.
describe('tester: a clinic with no provider, and a crafted request with fields the form lacks', () => {
  it('a clinic with no provider at all (as clinic:create leaves it): no column, no choice; its first provider added is the one column and choice, sort_order 0, and books', async () => {
    as('owner');
    const empty = await readCalendarDay(clinicA, { day: DAY });
    if (!empty.ok) throw new Error('not read');
    expect(empty.value.view.columns).toEqual([]);
    expect(bookableProviders(empty.value.view.columns)).toEqual([]);
    const added = await addProvider(clinicA, providerForm({ shortName: 'Dr. Prva' }));
    if (!added.ok) throw new Error('not added');
    expect((await providersOf(clinicA)).map((row) => [row.id, row.sort_order])).toEqual([
      [added.value.id, 0],
    ]);
    const read = await readCalendarDay(clinicA, { day: DAY });
    if (!read.ok) throw new Error('not read');
    expect(read.value.view.columns.map((column) => column.providerId)).toEqual([added.value.id]);
    expect(bookableProviders(read.value.view.columns)).toEqual([
      { id: added.value.id, shortName: 'Dr. Prva' },
    ]);
    const booked = await bookAppointment(clinicA, bookingForm(added.value.id));
    expect(booked).toMatchObject({ ok: true, value: { providerId: added.value.id } });
  });

  it("fields the form does not have, crafted in (an id, clinic B's id, inactive, an order, a moment): ignored; the provider is clinic A's, active, last, a new id", async () => {
    await setUpProvider(clinicA, { name: 'Ana Probna', sortOrder: 4 });
    as('owner', clinicA);
    const craftedId = newId();
    const form = providerForm({ name: 'Mira Testova' });
    for (const [name, value] of Object.entries({
      id: craftedId,
      clinicId: clinicB,
      clinic_id: clinicB,
      active: 'false',
      sortOrder: '-9',
      sort_order: '-9',
      createdAt: '2001-01-01T00:00:00Z',
    })) {
      form.append(name, value);
    }
    const added = await addProvider(clinicA, form);
    if (!added.ok) throw new Error(`refused: ${added.error.code}`);
    expect(added.value.id).not.toBe(craftedId);
    const row = (await providersOf(clinicA)).find((each) => each.name === 'Mira Testova');
    expect(row).toMatchObject({ id: added.value.id, active: true, sort_order: 5 });
    expect(row!.created_at.getFullYear()).toBeGreaterThan(2001);
    expect(await providersOf(clinicB)).toEqual([]);
    expect(await providerAudit(clinicB)).toEqual([]);
  });

  it('a name, short name and chair in Cyrillic at their limits (100, 12, 100 characters): stored as typed', async () => {
    as('owner');
    const fields = {
      name: 'Ж'.repeat(100),
      shortName: 'Њ'.repeat(12),
      chairLabel: 'Ч'.repeat(100),
    };
    const added = await addProvider(clinicA, providerForm(fields));
    if (!added.ok) throw new Error(`refused: ${added.error.code}`);
    expect(await providersOf(clinicA)).toMatchObject([
      { name: fields.name, short_name: fields.shortName, chair_label: fields.chairLabel },
    ]);
    const over = await addProvider(clinicA, providerForm({ shortName: 'Њ'.repeat(13) }));
    expect(over).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await providersOf(clinicA)).toHaveLength(1);
  });
});

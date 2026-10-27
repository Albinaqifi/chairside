import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookAppointment, readCalendarDay } from '@/app/(staff)/calendar/actions';
import {
  activateTreatmentType,
  addTreatmentType,
  changeTreatmentType,
  deactivateTreatmentType,
  readTreatmentTypes,
} from '@/app/(staff)/settings/treatment-type-actions';
import { closeDb } from '@/db/client';
import { withTenant, type TenantTransaction } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import * as scheduling from '@/modules/scheduling';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertProvider, insertRow, validRow, type ClinicRefs } from './scheduling-fixtures';

// E01-T09a, acceptance 1 to 7: the Treatment types tab as the app runs it: the real actions with a
// real session, the scheduling module in a tenant transaction, as the app role, under Row-Level
// Security; then the booking drawer's read and the booking action (no browser). Two at once: two
// tenant transactions, the first held open until the second is seen waiting behind it, as in
// closed-days.test.ts. Only next/headers, next/cache and next-intl's request functions are replaced,
// as there is no running Next.js. Rows are set up and inspected as the migration role. Every value is
// synthetic: role words, invented treatment names.

const PASSWORD = 'MARKER-pw-5d1b-correct';

const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));

// Outside a server action refresh() throws; every change calls it when it is done.
// The booking action revalidates the calendar's path when it is done.
const cache = vi.hoisted(() => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);

vi.mock('next-intl/server', () => ({
  getRequestConfig: (create: unknown) => create,
  getTranslations: () => Promise.resolve((key: string) => key),
}));

const admin = migratorPool();
/** Clinic A and B in MKD (two decimals); clinic Y in JPY (none). */
let clinicA: string;
let clinicB: string;
let clinicY: string;
const cookies = {} as Record<'owner' | 'dentist' | 'hygienist' | 'front_desk', string>;
let ownerId: string;
/** Clinic A's provider and patient, for the bookings. */
let providerA: string;
let patientA: string;

let nextAddress = 1;
const freshAddress = () => `10.49.0.${nextAddress++}`;

/** A day the calendar shows, far from today: bookings on it are the file's own. */
const DAY = '2031-03-10';

const SET_UP_AT = new Date('2026-01-05T08:00:00Z');

interface TypeRow {
  id: string;
  name: string;
  default_duration_min: number;
  default_price: number | null;
  needs_aftercare: boolean;
  aftercare_priority: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** The clinic's treatment_types rows, by name then id, as the migration role reads them. */
async function typesOf(clinicId: string): Promise<TypeRow[]> {
  const { rows } = await admin.query<TypeRow>(
    `select id, name, default_duration_min, default_price, needs_aftercare, aftercare_priority,
            active, created_at, updated_at
       from treatment_types where clinic_id = $1 order by name, id`,
    [clinicId],
  );
  return rows;
}

/** Writes a type as the migration role, set up long before any action of this file. */
async function setUpType(
  clinicId: string,
  values: { name: string; minutes?: number; active?: boolean; price?: number | null },
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'treatment_types', {
    ...validRow('treatment_types', { clinicId } as ClinicRefs),
    id,
    name: values.name,
    default_duration_min: values.minutes ?? 30,
    default_price: values.price ?? null,
    active: values.active ?? true,
    created_at: SET_UP_AT,
    updated_at: SET_UP_AT,
  });
  return id;
}

/** Every treatment-type audit row of the clinic, oldest first. */
async function allTypeAudit(clinicId: string) {
  const { rows } = await admin.query(
    `select clinic_id, actor_type, actor_id, action, entity_type, entity_id, metadata
       from audit_log where clinic_id = $1 and action like 'treatment_type.%'
      order by at, id`,
    [clinicId],
  );
  return rows;
}

const auditedBefore = new Map<string, number>();

/** The clinic's treatment-type audit rows written since the test began. */
async function typeAudit(clinicId: string) {
  return (await allTypeAudit(clinicId)).slice(auditedBefore.get(clinicId) ?? 0);
}

/** The add form's data as the browser sends it: the checkbox's "on" only when ticked. */
function typeForm(fields: {
  name: string;
  minutes?: string;
  price?: string;
  needsAftercare?: boolean;
  id?: string;
}): FormData {
  const data = new FormData();
  if (fields.id !== undefined) data.append('treatmentTypeId', fields.id);
  data.append('name', fields.name);
  data.append('minutes', fields.minutes ?? '30');
  data.append('price', fields.price ?? '');
  if (fields.needsAftercare) data.append('needsAftercare', 'on');
  return data;
}

/** A row's form: the id, hidden. */
function idForm(id: string): FormData {
  const data = new FormData();
  data.append('treatmentTypeId', id);
  return data;
}

/** A booking of clinic A's patient with its provider on DAY at 09:00, with the type, as the drawer sends it. */
function bookingForm(treatmentTypeId: string, start = '09:00'): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    patientId: patientA,
    providerId: providerA,
    treatmentTypeId,
    day: DAY,
    start,
    length: '45',
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

async function backendPid(tx: TenantTransaction): Promise<number> {
  const { rows } = await tx.execute(sql`select pg_backend_pid() as pid`);
  return Number(rows[0]?.pid);
}

/** Waits until a statement waits for a lock the process `pid` holds; fails after four seconds. */
async function waitingBehind(pid: number): Promise<void> {
  for (let waited = 0; ; waited += 20) {
    const { rows } = await admin.query<{ n: number }>(
      'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
      [pid],
    );
    if (rows[0]!.n > 0) return;
    expect(waited, 'the second transaction never waited for the first').toBeLessThan(4000);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The answer's issue paths, for an invalid_input; an Error for any other answer. */
function issuePaths(result: unknown): unknown[] {
  const answer = result as { ok: boolean; error?: { code: string; issues?: { path: unknown }[] } };
  if (answer.ok || answer.error?.code !== 'invalid_input' || !answer.error.issues) {
    throw new Error('expected invalid_input');
  }
  return answer.error.issues.map((issue) => issue.path);
}

beforeAll(async () => {
  [clinicA, clinicB, clinicY] = [
    await insertClinic(admin),
    await insertClinic(admin),
    await insertClinic(admin),
  ];
  await admin.query(`update clinics set currency = 'JPY' where id = $1`, [clinicY]);
  const owner = await member('owner', [clinicA, clinicB, clinicY]);
  ownerId = owner.id;
  cookies.owner = owner.cookie;
  for (const role of ['dentist', 'hygienist', 'front_desk'] as const) {
    cookies[role] = (await member(role, [clinicA])).cookie;
  }
  providerA = await insertProvider(admin, clinicA);
  const patient = validRow('patients', { clinicId: clinicA } as ClinicRefs);
  await insertRow(admin, 'patients', patient);
  patientA = patient.id as string;
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(async () => {
  cache.refresh.mockClear();
  for (const clinicId of [clinicA, clinicB, clinicY]) {
    await admin.query('delete from appointments where clinic_id = $1', [clinicId]);
    await admin.query('delete from treatment_types where clinic_id = $1', [clinicId]);
    auditedBefore.set(clinicId, (await allTypeAudit(clinicId)).length);
  }
});

describe('a type added, then offered to a booking; made inactive, offered no more (acceptance 1, 6)', () => {
  it("added: its row, the name trimmed, active, at the action's moment; one treatment_type.created row of ids; the page refreshed", async () => {
    as('owner');
    const before = new Date();
    const result = await addTreatmentType(
      clinicA,
      typeForm({ name: '  Implant review ', minutes: '45', price: '1500', needsAftercare: true }),
    );
    const after = new Date();
    if (!result.ok) throw new Error(`refused: ${result.error.code}`);
    const [row, ...others] = await typesOf(clinicA);
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      id: result.value.id,
      name: 'Implant review',
      default_duration_min: 45,
      default_price: 150000,
      needs_aftercare: true,
      aftercare_priority: 0,
      active: true,
    });
    expect(row!.created_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row!.created_at.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(row!.updated_at).toEqual(row!.created_at);
    const audited = await typeAudit(clinicA);
    expect(audited).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'treatment_type.created',
        entity_type: 'treatment_type',
        entity_id: result.value.id,
        metadata: {},
      },
    ]);
    expect(JSON.stringify(audited)).not.toMatch(/Implant|1500/);
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it("the drawer's read offers it with its length, and a booking takes it, its name the title", async () => {
    as('owner');
    const added = await addTreatmentType(
      clinicA,
      typeForm({ name: 'Implant review', minutes: '45' }),
    );
    if (!added.ok) throw new Error('not added');
    const read = await readCalendarDay(clinicA, { day: DAY });
    if (!read.ok) throw new Error('not read');
    expect(read.value.treatmentTypes).toEqual([
      { id: added.value.id, name: 'Implant review', minutes: 45 },
    ]);
    const booked = await bookAppointment(clinicA, bookingForm(added.value.id));
    expect(booked.ok).toBe(true);
    const { rows } = await admin.query('select title from appointments where clinic_id = $1', [
      clinicA,
    ]);
    expect(rows).toEqual([{ title: 'Implant review' }]);
  });

  it('made inactive: one treatment_type.deactivated row; not offered; a booking with it refused (treatment_not_bookable); its visit keeps its title', async () => {
    const id = await setUpType(clinicA, { name: 'Whitening', minutes: 60 });
    as('owner');
    expect((await bookAppointment(clinicA, bookingForm(id, '09:00'))).ok).toBe(true);
    const before = new Date();
    expect(await deactivateTreatmentType(clinicA, idForm(id))).toEqual({ ok: true, value: { id } });
    const [row] = await typesOf(clinicA);
    expect(row).toMatchObject({ id, active: false, created_at: SET_UP_AT });
    expect(row!.updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(await typeAudit(clinicA)).toEqual([
      expect.objectContaining({
        action: 'treatment_type.deactivated',
        entity_type: 'treatment_type',
        entity_id: id,
        actor_id: ownerId,
        metadata: {},
      }),
    ]);
    const read = await readCalendarDay(clinicA, { day: DAY });
    if (!read.ok) throw new Error('not read');
    expect(read.value.treatmentTypes).toEqual([]);
    expect(await bookAppointment(clinicA, bookingForm(id, '11:00'))).toEqual({
      ok: false,
      error: { code: 'treatment_not_bookable' },
    });
    const { rows } = await admin.query(
      'select title, treatment_type_id from appointments where clinic_id = $1',
      [clinicA],
    );
    expect(rows).toEqual([{ title: 'Whitening', treatment_type_id: id }]);
  });

  it('made active again: one treatment_type.activated row, and offered again', async () => {
    const id = await setUpType(clinicA, { name: 'Whitening', minutes: 60, active: false });
    as('owner');
    expect(await activateTreatmentType(clinicA, idForm(id))).toEqual({ ok: true, value: { id } });
    expect((await typesOf(clinicA))[0]).toMatchObject({ id, active: true });
    expect((await typeAudit(clinicA)).map((row) => row.action)).toEqual([
      'treatment_type.activated',
    ]);
    const read = await readCalendarDay(clinicA, { day: DAY });
    expect(read.ok && read.value.treatmentTypes.map((type) => type.id)).toEqual([id]);
  });

  it("a second press on a type's state: already_inactive, already_active; nothing written, no audit row", async () => {
    const inactive = await setUpType(clinicA, { name: 'Old', active: false });
    const active = await setUpType(clinicA, { name: 'Current' });
    const rows = await typesOf(clinicA);
    as('owner');
    expect(await deactivateTreatmentType(clinicA, idForm(inactive))).toEqual({
      ok: false,
      error: { code: 'already_inactive' },
    });
    expect(await activateTreatmentType(clinicA, idForm(active))).toEqual({
      ok: false,
      error: { code: 'already_active' },
    });
    expect(await typesOf(clinicA)).toEqual(rows);
    expect(await typeAudit(clinicA)).toEqual([]);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("the page's read: every type, the active ones first, then the inactive, each by name; and the currency", async () => {
    const b = await setUpType(clinicA, { name: 'Bleaching', active: false });
    const c = await setUpType(clinicA, { name: 'Checkup', minutes: 30, price: 1250 });
    const a = await setUpType(clinicA, { name: 'Abscess', minutes: 45 });
    as('owner');
    const read = await readTreatmentTypes.forPage({});
    if (!read.ok) throw new Error('not read');
    expect(read.value.currency).toBe('MKD');
    expect(read.value.types).toEqual([
      { id: a, name: 'Abscess', minutes: 45, price: null, needsAftercare: false, active: true },
      { id: c, name: 'Checkup', minutes: 30, price: 1250, needsAftercare: false, active: true },
      { id: b, name: 'Bleaching', minutes: 30, price: null, needsAftercare: false, active: false },
    ]);
  });
});

describe('an edit keeps the appointments already booked as they were (acceptance 3)', () => {
  it('name, length, price and aftercare changed, one treatment_type.updated row; the visit keeps its title and times; the aftercare priority kept', async () => {
    const id = await setUpType(clinicA, { name: 'Filling', minutes: 45, price: 150000 });
    await admin.query('update treatment_types set aftercare_priority = 3 where id = $1', [id]);
    as('owner');
    expect((await bookAppointment(clinicA, bookingForm(id))).ok).toBe(true);
    cache.refresh.mockClear(); // the booking's own
    const visitBefore = await admin.query(
      'select id, title, starts_at, ends_at, updated_at from appointments where clinic_id = $1',
      [clinicA],
    );
    const before = new Date();
    expect(
      await changeTreatmentType(
        clinicA,
        typeForm({ id, name: 'Composite filling', minutes: '60', price: '', needsAftercare: true }),
      ),
    ).toEqual({ ok: true, value: { id } });
    const [row] = await typesOf(clinicA);
    expect(row).toMatchObject({
      id,
      name: 'Composite filling',
      default_duration_min: 60,
      default_price: null,
      needs_aftercare: true,
      aftercare_priority: 3,
      active: true,
      created_at: SET_UP_AT,
    });
    expect(row!.updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    const visitAfter = await admin.query(
      'select id, title, starts_at, ends_at, updated_at from appointments where clinic_id = $1',
      [clinicA],
    );
    expect(visitAfter.rows).toEqual(visitBefore.rows);
    expect(visitAfter.rows[0]).toMatchObject({ title: 'Filling' });
    expect(await typeAudit(clinicA)).toEqual([
      expect.objectContaining({
        action: 'treatment_type.updated',
        entity_type: 'treatment_type',
        entity_id: id,
        metadata: {},
      }),
    ]);
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it("a type's own length outside the select's steps is kept when it is saved again", async () => {
    const id = await setUpType(clinicA, { name: 'Quick look', minutes: 7 });
    as('owner');
    expect(
      (await changeTreatmentType(clinicA, typeForm({ id, name: 'Quick look', minutes: '7' }))).ok,
    ).toBe(true);
    expect((await typesOf(clinicA))[0]?.default_duration_min).toBe(7);
  });
});

describe('a price in the clinic currency (acceptance 4)', () => {
  it.each([
    { price: '12.50', minor: 1250 },
    { price: '1500', minor: 150000 },
    { price: '12.5', minor: 1250 },
    { price: '12,50', minor: 1250 },
    { price: '', minor: null },
    { price: '   ', minor: null },
  ])('"$price" in MKD is stored as $minor', async ({ price, minor }) => {
    as('owner');
    expect((await addTreatmentType(clinicA, typeForm({ name: 'Priced', price }))).ok).toBe(true);
    expect((await typesOf(clinicA))[0]?.default_price).toBe(minor);
  });

  it('"1500" in JPY is 1500; "12.50" refused as price_decimals, nothing written, no audit row; the edit too', async () => {
    as('owner', clinicY);
    expect((await addTreatmentType(clinicY, typeForm({ name: 'Whole', price: '1500' }))).ok).toBe(
      true,
    );
    expect((await typesOf(clinicY))[0]?.default_price).toBe(1500);
    const rows = await typesOf(clinicY);
    const audited = (await typeAudit(clinicY)).length;
    cache.refresh.mockClear();
    expect(await addTreatmentType(clinicY, typeForm({ name: 'Decimal', price: '12.50' }))).toEqual({
      ok: false,
      error: { code: 'price_decimals' },
    });
    expect(
      await changeTreatmentType(
        clinicY,
        typeForm({ id: rows[0]!.id, name: 'Whole', price: '12.5' }),
      ),
    ).toEqual({ ok: false, error: { code: 'price_decimals' } });
    expect(await typesOf(clinicY)).toEqual(rows);
    expect(await typeAudit(clinicY)).toHaveLength(audited);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it('a price above what the column holds: price_too_high, nothing written', async () => {
    as('owner');
    expect(await addTreatmentType(clinicA, typeForm({ name: 'Dear', price: '999999999' }))).toEqual(
      { ok: false, error: { code: 'price_too_high' } },
    );
    expect(await typesOf(clinicA)).toEqual([]);
  });

  it.each(['12.345', '-5', 'abc', '1 500', '1,000.50'])(
    '"%s": invalid_input at the price, nothing written, no audit row',
    async (price) => {
      as('owner');
      expect(issuePaths(await addTreatmentType(clinicA, typeForm({ name: 'Bad', price })))).toEqual(
        [['price']],
      );
      expect(await typesOf(clinicA)).toEqual([]);
      expect(await typeAudit(clinicA)).toEqual([]);
    },
  );

  it('a name empty or of 101 characters, a length of 0 or no number: invalid_input at its field', async () => {
    as('owner');
    for (const [fields, field] of [
      [{ name: '   ' }, 'name'],
      [{ name: 'N'.repeat(101) }, 'name'],
      [{ name: 'Fine', minutes: '0' }, 'minutes'],
      [{ name: 'Fine', minutes: 'half an hour' }, 'minutes'],
      [{ name: 'Fine', minutes: '1441' }, 'minutes'],
    ] as const) {
      expect(issuePaths(await addTreatmentType(clinicA, typeForm(fields))), field).toEqual([
        [field],
      ]);
    }
    expect((await addTreatmentType(clinicA, typeForm({ name: 'N'.repeat(100) }))).ok).toBe(true);
    expect(await typeAudit(clinicA)).toHaveLength(1);
  });
});

describe('one active type per name, trimmed and in any case (acceptance 5)', () => {
  it('an add of a name an active type has, any case: name_taken; one an inactive type has: added', async () => {
    await setUpType(clinicA, { name: 'Filling' });
    await setUpType(clinicA, { name: 'Пломба' });
    await setUpType(clinicA, { name: 'Bleaching', active: false });
    as('owner');
    for (const name of ['Filling', ' filling ', 'FILLING', 'ПЛОМБА']) {
      expect(await addTreatmentType(clinicA, typeForm({ name })), name).toEqual({
        ok: false,
        error: { code: 'name_taken' },
      });
    }
    expect((await addTreatmentType(clinicA, typeForm({ name: 'bleaching' }))).ok).toBe(true);
    // In any order: the database's collation places "bleaching" and "Bleaching" as it likes.
    const rows = (await typesOf(clinicA)).map((row) => `${row.name} ${row.active}`);
    expect(rows.sort()).toEqual([
      'Bleaching false',
      'Filling true',
      'bleaching true',
      'Пломба true',
    ]);
    expect(await typeAudit(clinicA)).toHaveLength(1);
  });

  it("an edit of an active type to another active one's name: name_taken; its own name in another case: saved; an inactive one: saved", async () => {
    await setUpType(clinicA, { name: 'Filling' });
    const crown = await setUpType(clinicA, { name: 'Crown' });
    const old = await setUpType(clinicA, { name: 'Old filling', active: false });
    as('owner');
    expect(await changeTreatmentType(clinicA, typeForm({ id: crown, name: 'filling' }))).toEqual({
      ok: false,
      error: { code: 'name_taken' },
    });
    expect((await changeTreatmentType(clinicA, typeForm({ id: crown, name: 'CROWN' }))).ok).toBe(
      true,
    );
    expect((await changeTreatmentType(clinicA, typeForm({ id: old, name: 'Filling' }))).ok).toBe(
      true,
    );
  });

  it('an inactive type made active again while an active one has its name: name_taken, it stays inactive', async () => {
    await setUpType(clinicA, { name: 'Filling' });
    const old = await setUpType(clinicA, { name: 'filling', active: false });
    as('owner');
    expect(await activateTreatmentType(clinicA, idForm(old))).toEqual({
      ok: false,
      error: { code: 'name_taken' },
    });
    expect((await typesOf(clinicA)).find((row) => row.id === old)?.active).toBe(false);
    expect(await typeAudit(clinicA)).toEqual([]);
  });

  // The clinic has no type at all: no row to lock, the case a row lock would miss. The first add is
  // held open until the second is seen waiting behind it.
  it.each([
    { what: 'two adds of one name at once', first: 'Filling', second: 'filling' },
    { what: 'two adds of one name in Cyrillic at once', first: 'Пломба', second: 'ПЛОМБА' },
  ])(
    '$what, in a clinic with no type: the second waits for the first, then is name_taken',
    async ({ first, second }) => {
      const fields = (name: string) => ({ name, minutes: 30, price: null, needsAftercare: false });
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      let firstPid = 0;
      let firstWritten = () => {};
      const written = new Promise<void>((resolve) => (firstWritten = resolve));
      const one = withTenant(clinicA, async (tx) => {
        firstPid = await backendPid(tx);
        const result = await scheduling.addTreatmentType(tx, fields(first), new Date());
        firstWritten();
        await held;
        return result;
      });
      await Promise.race([written, one]);
      const two = withTenant(clinicA, (tx) =>
        scheduling.addTreatmentType(tx, fields(second), new Date()),
      );
      try {
        await waitingBehind(firstPid);
      } finally {
        release();
      }
      expect(await one).toMatchObject({ ok: true });
      expect(await two).toEqual({ ok: false, code: 'name_taken' });
      expect((await typesOf(clinicA)).map((row) => row.name)).toEqual([first]);
    },
  );

  it('an add and an activation of one name at once: the activation waits, then is name_taken', async () => {
    const old = await setUpType(clinicA, { name: 'Filling', active: false });
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let firstPid = 0;
    let firstWritten = () => {};
    const written = new Promise<void>((resolve) => (firstWritten = resolve));
    const one = withTenant(clinicA, async (tx) => {
      firstPid = await backendPid(tx);
      const result = await scheduling.addTreatmentType(
        tx,
        { name: 'FILLING', minutes: 30, price: null, needsAftercare: false },
        new Date(),
      );
      firstWritten();
      await held;
      return result;
    });
    await Promise.race([written, one]);
    const two = withTenant(clinicA, (tx) =>
      scheduling.setTreatmentTypeActive(tx, old, true, new Date()),
    );
    try {
      await waitingBehind(firstPid);
    } finally {
      release();
    }
    expect(await one).toMatchObject({ ok: true });
    expect(await two).toEqual({ ok: false, code: 'name_taken' });
    expect((await typesOf(clinicA)).filter((row) => row.active).map((row) => row.name)).toEqual([
      'FILLING',
    ]);
  });

  // E01-T09a tester: the edit takes the same lock. An active type renamed to a name while another
  // change takes that name: the second waits for the first, then is name_taken.
  it.each([
    { what: 'a rename, then an add of the new name', second: 'add' },
    { what: 'two renames of two types to one name', second: 'rename' },
  ] as const)('$what, at once: the second waits, then is name_taken', async ({ second }) => {
    const crown = await setUpType(clinicA, { name: 'Crown' });
    const bridge = await setUpType(clinicA, { name: 'Bridge' });
    const fields = (name: string) => ({ name, minutes: 30, price: null, needsAftercare: false });
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let firstPid = 0;
    let firstWritten = () => {};
    const written = new Promise<void>((resolve) => (firstWritten = resolve));
    const one = withTenant(clinicA, async (tx) => {
      firstPid = await backendPid(tx);
      const result = await scheduling.changeTreatmentType(tx, crown, fields('Inlay'), new Date());
      firstWritten();
      await held;
      return result;
    });
    await Promise.race([written, one]);
    const two = withTenant(clinicA, (tx) =>
      second === 'add'
        ? scheduling.addTreatmentType(tx, fields('INLAY'), new Date())
        : scheduling.changeTreatmentType(tx, bridge, fields(' inlay '), new Date()),
    );
    try {
      await waitingBehind(firstPid);
    } finally {
      release();
    }
    expect(await one).toEqual({ ok: true });
    expect(await two).toEqual({ ok: false, code: 'name_taken' });
    expect((await typesOf(clinicA)).map((row) => `${row.name} ${row.active}`).sort()).toEqual([
      'Bridge true',
      'Inlay true',
    ]);
  });

  it('two clinics may each have an active type of one name, and wait on nothing of the other', async () => {
    await setUpType(clinicB, { name: 'Filling' });
    as('owner');
    expect((await addTreatmentType(clinicA, typeForm({ name: 'Filling' }))).ok).toBe(true);
  });
});

describe('only settings.manage may read or change the types (acceptance 6)', () => {
  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, for the read and every change; the rows and the audit log as they were',
    async (role) => {
      const active = await setUpType(clinicA, { name: 'Filling' });
      const inactive = await setUpType(clinicA, { name: 'Old', active: false });
      const rows = await typesOf(clinicA);
      as(role);
      const forbidden = { ok: false, error: { code: 'forbidden' } };
      expect(await readTreatmentTypes(clinicA, {})).toEqual(forbidden);
      expect(await readTreatmentTypes.forPage({})).toEqual(forbidden);
      expect(await addTreatmentType(clinicA, typeForm({ name: 'New' }))).toEqual(forbidden);
      expect(await changeTreatmentType(clinicA, typeForm({ id: active, name: 'Renamed' }))).toEqual(
        forbidden,
      );
      expect(await deactivateTreatmentType(clinicA, idForm(active))).toEqual(forbidden);
      expect(await activateTreatmentType(clinicA, idForm(inactive))).toEqual(forbidden);
      expect(await typesOf(clinicA)).toEqual(rows);
      expect(await typeAudit(clinicA)).toEqual([]);
    },
  );
});

describe("a user of clinic A cannot change clinic B's type by its id (acceptance 7)", () => {
  it("the edit, Make inactive and Make active with B's ids from A: not_found, nothing written in either clinic, no audit row", async () => {
    const activeB = await setUpType(clinicB, { name: 'Filling' });
    const inactiveB = await setUpType(clinicB, { name: 'Old', active: false });
    const rowsB = await typesOf(clinicB);
    as('owner', clinicA);
    const notFound = { ok: false, error: { code: 'not_found' } };
    expect(
      await changeTreatmentType(clinicA, typeForm({ id: activeB, name: 'Taken over' })),
    ).toEqual(notFound);
    expect(await deactivateTreatmentType(clinicA, idForm(activeB))).toEqual(notFound);
    expect(await activateTreatmentType(clinicA, idForm(inactiveB))).toEqual(notFound);
    expect(await typesOf(clinicB)).toEqual(rowsB);
    expect(await typesOf(clinicA)).toEqual([]);
    expect(await typeAudit(clinicA)).toEqual([]);
    expect(await typeAudit(clinicB)).toEqual([]);
  });

  it("the page's read in clinic A lists none of B's types", async () => {
    await setUpType(clinicB, { name: 'Filling' });
    const own = await setUpType(clinicA, { name: 'Crown' });
    as('owner', clinicA);
    const read = await readTreatmentTypes.forPage({});
    expect(read.ok && read.value.types.map((type) => type.id)).toEqual([own]);
  });

  it("an id that is no id: invalid_input at it; a type id among the add form's fields is no input", async () => {
    const activeB = await setUpType(clinicB, { name: 'Filling' });
    as('owner', clinicA);
    expect(issuePaths(await deactivateTreatmentType(clinicA, idForm('not-an-id')))).toEqual([
      ['treatmentTypeId'],
    ]);
    // The add form's schema has no id: a sent one is dropped, and a new type is added in clinic A.
    const added = await addTreatmentType(clinicA, typeForm({ id: activeB, name: 'Crown' }));
    expect(added.ok && added.value.id).not.toBe(activeB);
    expect(await typesOf(clinicB)).toHaveLength(1);
  });
});

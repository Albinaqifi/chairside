import { sql } from 'drizzle-orm';
import { isValidElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import StaffLayout from '@/app/(staff)/layout';
import { readClinicSettings, saveClinicDetails } from '@/app/(staff)/settings/actions';
import { Sidebar } from '@/app/(staff)/sidebar';
import type { Staff } from '@/app/_lib/auth';
import { closeDb } from '@/db/client';
import { withTenant, type TenantTransaction } from '@/db/tenant';
import { requestTimeZone } from '@/i18n/request';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { createStaffUser } from '@/modules/auth';
import * as tenancy from '@/modules/tenancy';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertClinicRefs, insertRow, validRow } from './scheduling-fixtures';

// E01-T08a, acceptance 1 to 6: the Settings page's save, as the app runs it: the real actions with a
// real session, the tenancy module in a tenant transaction, as the app role, under Row-Level
// Security, and pg_timezone_names as the `postgres:18` image has it. Only next/headers, next/cache
// and next-intl's request functions are replaced, as there is no running Next.js. Rows are set up and
// inspected as the migration role. Every value is synthetic: role words, the seed's made-up phone
// block (+389 70 00x xxx), example.test.

const PASSWORD = 'MARKER-pw-8e3a-correct';

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

// Outside a server action refresh() throws; the save calls it when it is done.
const cache = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/cache', () => cache);

// next-intl's request configuration, read as a function (src/i18n/request.ts), and the texts.
vi.mock('next-intl/server', () => ({
  getRequestConfig: (create: unknown) => create,
  getTranslations: () => Promise.resolve((key: string) => key),
}));

const admin = migratorPool();
/** Paused, with a key in its settings: a save must keep both. */
let clinicA: string;
let clinicB: string;
/** Cookies: an owner of both clinics, and a dentist, a hygienist and a front desk of clinic A. */
const cookies = {} as Record<'owner' | 'dentist' | 'hygienist' | 'front_desk', string>;
let ownerId: string;

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.42.0.${nextAddress++}`;

/** The Clinic tab's data, as the browser sends it: every field, these in place of the others. */
function form(fields: Record<string, string> = {}): FormData {
  const all: Record<string, string> = {
    name: 'Lakeside Dental',
    phone: '070 001 401',
    address: 'Ulica 1, Skopje',
    email: 'desk@example.test',
    timeZone: 'Europe/Skopje',
    locale: 'en',
    currency: 'MKD',
    country: 'MK',
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) data.append(name, value);
  return data;
}

/** The action as `role` of clinic A (the owner: of the clinic `clinicId`, picked). */
function as(role: keyof typeof cookies, clinicId = clinicA): void {
  request.cookie = cookies[role];
  request.clinic = clinicId;
}

/** The clinic's whole row, as the migration role reads it. */
async function rowOf(clinicId: string): Promise<Record<string, unknown>> {
  const { rows } = await admin.query('select * from clinics where id = $1', [clinicId]);
  if (!rows[0]) throw new Error('no such clinic');
  return rows[0] as Record<string, unknown>;
}

/** The clinic's clinic.updated rows, oldest first. */
async function updatedRows(clinicId: string) {
  const { rows } = await admin.query(
    `select clinic_id, actor_type, actor_id, action, entity_type, entity_id, metadata
       from audit_log where clinic_id = $1 and action = 'clinic.updated' order by at, id`,
    [clinicId],
  );
  return rows;
}

/** Saves as the owner of clinic A; fails the test when the save was not done. */
async function saved(fields: Record<string, string> = {}) {
  as('owner');
  const result = await saveClinicDetails(clinicA, form(fields));
  if (!result.ok) throw new Error(`not saved: ${result.error.code}`);
  return result.value;
}

async function member(role: string, clinics: string[]): Promise<{ id: string; cookie: string }> {
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Owner', password: PASSWORD });
  for (const clinicId of clinics) await insertMembership(admin, { clinicId, userId: id, role });
  return { id, cookie: await signInCookie(email, PASSWORD, freshAddress()) };
}

beforeAll(async () => {
  [clinicA, clinicB] = [await insertClinic(admin), await insertClinic(admin)];
  await admin.query(
    `update clinics set status = 'paused', settings = '{"marker": "kept"}' where id = $1`,
    [clinicA],
  );
  const owner = await member('owner', [clinicA, clinicB]);
  ownerId = owner.id;
  cookies.owner = owner.cookie;
  for (const role of ['dentist', 'hygienist', 'front_desk'] as const) {
    cookies[role] = (await member(role, [clinicA])).cookie;
  }
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => {
  cache.refresh.mockClear();
});

describe("the owner's changes are saved and audited, one row per save (acceptance 1)", () => {
  it('stores each detail as the clinic writes it, updated_at the save’s moment, and answers the fields changed', async () => {
    const before = new Date();
    const value = await saved({
      name: '  Lakeside Dental  ',
      phone: '+389 70 001 401',
      address: '  Ulica 1, Skopje ',
      email: ' Desk@Example.TEST ',
    });
    const after = new Date();
    const row = await rowOf(clinicA);
    expect(row).toMatchObject({
      name: 'Lakeside Dental',
      phone: '+38970001401',
      address: 'Ulica 1, Skopje',
      email: 'desk@example.test',
      timezone: 'Europe/Skopje',
      locale: 'en',
      currency: 'MKD',
      default_country: 'MK',
    });
    const updatedAt = (row.updated_at as Date).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before.getTime());
    expect(updatedAt).toBeLessThanOrEqual(after.getTime());
    expect(value.changes.fields).toEqual(expect.arrayContaining(['name', 'phone', 'email']));
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('each save writes one clinic.updated row, by the owner, about the clinic, naming the fields changed and no value', async () => {
    await saved();
    const earlier = (await updatedRows(clinicA)).length;
    await saved({ name: 'Harbour Lake Dental', email: 'front@example.test' });
    await saved({ name: 'Harbour Lake Dental', email: 'front@example.test' });
    const rows = await updatedRows(clinicA);
    expect(rows.slice(earlier)).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'clinic.updated',
        entity_type: 'clinic',
        entity_id: clinicA,
        metadata: { fields: ['name', 'email'] },
      },
      expect.objectContaining({ action: 'clinic.updated', metadata: { fields: [] } }),
    ]);
    const written = JSON.stringify(rows);
    for (const value of ['Harbour Lake', 'front@', 'desk@', '38970001401', 'Ulica']) {
      expect(written).not.toContain(value);
    }
  });

  // E01-T08a tester (the builder's known gap): the row is locked while a save reads it, so of two
  // saves at once the second waits for the first and names only what it changed itself. Without the
  // lock it reads the row as it was before the first commits, and its audit row names the first's
  // change as well. The first is held open until the second is seen waiting behind it.
  it('two saves at once: the second waits for the first, then names only its own change', async () => {
    const start: tenancy.ClinicDetails = {
      name: 'Lakeside Dental',
      phone: null,
      address: null,
      email: 'desk@example.test',
      timeZone: 'Europe/Skopje',
      locale: 'en',
      currency: 'MKD',
      country: 'MK',
    };
    await withTenant(clinicA, (tx) =>
      tenancy.saveClinicDetails(tx, start, new Date('2026-10-12T08:00:00Z')),
    );
    // The first renames the clinic; the second, from a page that shows the new name, changes the
    // email alone.
    const first = { ...start, name: 'Harbour Lake Dental' };
    const second = { ...first, email: 'front@example.test' };

    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let firstPid = 0;
    let firstWritten = () => {};
    const written = new Promise<void>((resolve) => (firstWritten = resolve));
    const one = withTenant(clinicA, async (tx) => {
      firstPid = await backendPid(tx);
      const result = await tenancy.saveClinicDetails(tx, first, new Date('2026-10-12T09:00:00Z'));
      firstWritten();
      await held; // its transaction, and so the row's lock, stay open
      return result;
    });
    await Promise.race([written, one]);
    const two = withTenant(clinicA, (tx) =>
      tenancy.saveClinicDetails(tx, second, new Date('2026-10-12T09:00:01Z')),
    );
    try {
      for (let waited = 0; ; waited += 20) {
        const { rows } = await admin.query<{ n: number }>(
          'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
          [firstPid],
        );
        if (rows[0]!.n > 0) break;
        expect(waited, 'the second save never waited for the first').toBeLessThan(4000);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      release();
    }
    expect(await one).toEqual({ ok: true, changed: ['name'] });
    expect(await two).toEqual({ ok: true, changed: ['email'] });
    expect(await rowOf(clinicA)).toMatchObject({
      name: 'Harbour Lake Dental',
      email: 'front@example.test',
    });
  });
});

/** The id of the PostgreSQL server process behind the transaction's connection. */
async function backendPid(tx: TenantTransaction): Promise<number> {
  const { rows } = await tx.execute(sql`select pg_backend_pid() as pid`);
  return Number(rows[0]?.pid);
}

describe('what the checks refuse is shown at its field, with nothing saved (acceptance 1)', () => {
  it.each<{ what: string; fields: Record<string, string>; path: string }>([
    { what: 'an empty name', fields: { name: '' }, path: 'name' },
    { what: 'an impossible phone', fields: { phone: '070 001 23' }, path: 'phone' },
    { what: 'an email that is no email', fields: { email: 'desk.example.test' }, path: 'email' },
    { what: 'a currency the check refuses', fields: { currency: 'mkd' }, path: 'currency' },
    { what: 'a language the check refuses', fields: { locale: 'mk' }, path: 'locale' },
    { what: 'a phone country the check refuses', fields: { country: 'UK' }, path: 'country' },
  ])(
    '$what: invalid_input at $path, the row and the audit log as they were',
    async ({ fields, path }) => {
      await saved();
      const [row, audited] = [await rowOf(clinicA), (await updatedRows(clinicA)).length];
      as('owner');
      const result = await saveClinicDetails(clinicA, form({ name: 'Another Name', ...fields }));
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      if (result.ok || !('issues' in result.error)) throw new Error('expected invalid_input');
      expect(result.error.issues.map((issue) => issue.path)).toEqual([[path]]);
      expect(await rowOf(clinicA)).toEqual(row);
      expect(await updatedRows(clinicA)).toHaveLength(audited);
    },
  );
});

describe('the zone: a name both the database and Intl know, never an offset (acceptance 2)', () => {
  it.each(['+01:00', 'Etc/GMT-1'])('%s: invalid_input at the zone, nothing saved', async (zone) => {
    await saved();
    const row = await rowOf(clinicA);
    as('owner');
    expect(await saveClinicDetails(clinicA, form({ timeZone: zone }))).toEqual({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: ['timeZone'], code: 'custom' }] },
    });
    expect(await rowOf(clinicA)).toEqual(row);
  });

  it('Europe/Kiev, which Intl knows and the database does not: refused above the button, nothing saved', async () => {
    const { rows: known } = await admin.query(
      `select 1 from pg_timezone_names where name = 'Europe/Kiev'`,
    );
    expect(
      known,
      'the postgres:18 image knows Europe/Kiev again: this case needs a name it lacks (D-110, "Revisit if")',
    ).toEqual([]);
    await saved();
    const [row, audited] = [await rowOf(clinicA), (await updatedRows(clinicA)).length];
    as('owner');
    expect(
      await saveClinicDetails(clinicA, form({ name: 'Kiev Dental', timeZone: 'Europe/Kiev' })),
    ).toEqual({
      ok: false,
      error: { code: 'time_zone_unknown' },
    });
    expect(await rowOf(clinicA)).toEqual(row);
    expect(await updatedRows(clinicA)).toHaveLength(audited);
    expect(cache.refresh).toHaveBeenCalledTimes(1); // the first save's alone
  });

  it.each([
    { sent: 'europe/skopje', stored: 'Europe/Skopje' },
    { sent: 'EUROPE/LONDON', stored: 'Europe/London' },
    { sent: 'UTC', stored: 'UTC' },
    { sent: 'utc', stored: 'UTC' },
    { sent: 'Europe/Kyiv', stored: 'Europe/Kyiv' },
  ])('$sent: stored as $stored, as PostgreSQL spells it', async ({ sent, stored }) => {
    await saved({ timeZone: sent });
    expect((await rowOf(clinicA)).timezone).toBe(stored);
  });

  it('the zones the form offers: the database’s region names and UTC, none under Etc/, each one the save takes', async () => {
    as('owner');
    const read = await readClinicSettings.forPage({});
    if (!read.ok) throw new Error(`not read: ${read.error.code}`);
    const zones = read.value.timeZones;
    expect(zones).toEqual(
      expect.arrayContaining([
        'UTC',
        'Europe/Kyiv',
        'Europe/Skopje',
        'America/Argentina/Buenos_Aires',
      ]),
    );
    expect(zones).not.toContain('Europe/Kiev');
    expect(zones.length).toBeGreaterThan(400);
    expect(zones.filter((zone) => !tenancy.isClinicTimeZoneName(zone))).toEqual([]);
    expect(zones.filter((zone) => zone.startsWith('Etc/') || zone === 'GMT')).toEqual([]);
    const spelt = await withTenant(clinicA, async (tx) => {
      const found: (string | null)[] = [];
      for (const zone of ['UTC', 'Europe/Kyiv', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata']) {
        found.push(await tenancy.knownTimeZone(tx, zone.toLowerCase()));
      }
      return found;
    });
    expect(spelt).toEqual(['UTC', 'Europe/Kyiv', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata']);
  });
});

describe('a dentist, a hygienist and the front desk cannot change anything (acceptance 3)', () => {
  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, for the read and the save; the row and the audit log as they were',
    async (role) => {
      const [row, audited] = [await rowOf(clinicA), (await updatedRows(clinicA)).length];
      as(role);
      const forbidden = { ok: false, error: { code: 'forbidden' } };
      expect(await saveClinicDetails(clinicA, form({ name: 'Taken Over' }))).toEqual(forbidden);
      expect(await readClinicSettings(clinicA, {})).toEqual(forbidden);
      expect(await readClinicSettings.forPage({})).toEqual(forbidden);
      expect(await rowOf(clinicA)).toEqual(row);
      expect(await updatedRows(clinicA)).toHaveLength(audited);
    },
  );
});

describe('a save changes its own clinic only, and of it only the eight details and updated_at (acceptance 4)', () => {
  it('status and settings stay as they were; the other clinic of the same owner is unchanged', async () => {
    const [a, b] = [await rowOf(clinicA), await rowOf(clinicB)];
    await saved({
      name: 'Only Clinic A',
      // With + and its calling code: the seed's block, whatever the phone country (here RS).
      phone: '+389 70 001 402',
      address: 'Ulica 2, Skopje',
      email: 'only-a@example.test',
      timeZone: 'Europe/Belgrade',
      currency: 'EUR',
      country: 'RS',
    });
    const after = await rowOf(clinicA);
    expect(after).toEqual({
      ...a,
      name: 'Only Clinic A',
      phone: '+38970001402',
      address: 'Ulica 2, Skopje',
      email: 'only-a@example.test',
      timezone: 'Europe/Belgrade',
      currency: 'EUR',
      default_country: 'RS',
      updated_at: after.updated_at,
    });
    expect(after).toMatchObject({ status: 'paused', settings: { marker: 'kept' } });
    expect(after.created_at).toEqual(a.created_at);
    expect(await rowOf(clinicB)).toEqual(b);
    expect(await updatedRows(clinicB)).toEqual([]);
  });

  it("a clinic id among the form's fields is no input: the request's clinic is saved, the other not", async () => {
    const b = await rowOf(clinicB);
    as('owner');
    const data = form({ name: 'Named In The Form' });
    for (const name of ['clinicId', 'clinic_id', 'id']) data.append(name, clinicB);
    expect(await saveClinicDetails(clinicA, data)).toMatchObject({ ok: true });
    expect((await rowOf(clinicA)).name).toBe('Named In The Form');
    expect(await rowOf(clinicB)).toEqual(b);
  });

  it("sent with clinic B's id while the request is in clinic A: clinic_changed, neither changed", async () => {
    const [a, b] = [await rowOf(clinicA), await rowOf(clinicB)];
    as('owner', clinicA);
    expect(await saveClinicDetails(clinicB, form({ name: 'Wrong Frame' }))).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect([await rowOf(clinicA), await rowOf(clinicB)]).toEqual([a, b]);
  });

  it('the same details saved again change nothing but updated_at, and name no field', async () => {
    const details: tenancy.ClinicDetails = {
      name: 'Lakeside Dental',
      phone: '+38970001403',
      address: null,
      email: 'Desk@Example.TEST',
      timeZone: 'europe/skopje',
      locale: 'en',
      currency: 'MKD',
      country: 'MK',
    };
    const first = new Date('2026-10-12T08:00:00Z');
    const second = new Date('2026-10-12T09:00:00Z');
    await withTenant(clinicA, (tx) => tenancy.saveClinicDetails(tx, details, first));
    const row = await rowOf(clinicA);
    expect(row.updated_at).toEqual(first);
    expect(
      await withTenant(clinicA, (tx) => tenancy.saveClinicDetails(tx, details, second)),
    ).toEqual({ ok: true, changed: [] });
    expect(await rowOf(clinicA)).toEqual({ ...row, updated_at: second });
  });
});

describe('after another zone is saved (acceptance 5)', () => {
  it('every appointment keeps its moment, and the next page reads the new zone', async () => {
    await saved({ timeZone: 'Europe/Skopje' });
    const refs = await insertClinicRefs(admin, clinicA, ownerId);
    for (const n of [0, 1, 2])
      await insertRow(admin, 'appointments', validRow('appointments', refs, n));
    const moments = async () =>
      (
        await admin.query(
          `select id, starts_at, ends_at from appointments where clinic_id = $1 order by id`,
          [clinicA],
        )
      ).rows;
    const before = await moments();
    expect(before).toHaveLength(3);

    await saved({ timeZone: 'Pacific/Auckland' });

    expect(await moments()).toEqual(before);
    as('owner');
    expect(await requestTimeZone()).toBe('Pacific/Auckland');
    expect(await withTenant(clinicA, (tx) => tenancy.clinicPlace(tx))).toMatchObject({
      timeZone: 'Pacific/Auckland',
    });
    expect(await readClinicSettings.forPage({})).toMatchObject({
      ok: true,
      value: { details: { timeZone: 'Pacific/Auckland' } },
    });
  });
});

describe('the clinic’s new name in the sidebar on the next page (acceptance 6)', () => {
  /** The staff the layout hands its sidebar, as a page rendered after the save gets it. */
  async function sidebarStaff(): Promise<Staff> {
    const found: Staff[] = [];
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) {
        for (const child of node as ReactNode[]) walk(child);
        return;
      }
      if (!isValidElement<{ children?: ReactNode; staff?: Staff }>(node)) return;
      if (node.type === Sidebar && node.props.staff) found.push(node.props.staff);
      walk(node.props.children);
    };
    walk(await StaffLayout({ children: null }));
    expect(found).toHaveLength(1);
    return found[0]!;
  }

  it('the name saved is the name the frame shows', async () => {
    await saved({ name: 'Lakeside Dental' });
    as('owner');
    expect((await sidebarStaff()).clinic.clinicName).toBe('Lakeside Dental');
    await saved({ name: '  Забна клиника Езеро ' });
    as('owner');
    expect((await sidebarStaff()).clinic).toMatchObject({
      clinicId: clinicA,
      clinicName: 'Забна клиника Езеро',
    });
  });
});

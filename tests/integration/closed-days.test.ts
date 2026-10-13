import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDay } from '@/app/(staff)/calendar/read-day';
import { addClosedDay, readClosedDays, removeClosedDay } from '@/app/(staff)/settings/actions';
import { closeDb } from '@/db/client';
import { withTenant, type TenantTransaction } from '@/db/tenant';
import { addDays, dayInZone } from '@/lib/calendar-day';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import * as tenancy from '@/modules/tenancy';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertRow } from './scheduling-fixtures';

// E01-T08c, acceptance 1 to 5: the closed days on the Opening hours tab, as the app runs them: the
// real actions with a real session, the tenancy module in a tenant transaction, as the app role,
// under Row-Level Security; then the calendar's read of the day (no browser). The actions read the
// real clock, so their days are counted from the clinic's today with two days' margin; a moment of
// its own (22:00 in New York) goes to the module with its `now`. Only next/headers, next/cache and
// next-intl's request functions are replaced, as there is no running Next.js. Rows are set up and
// inspected as the migration role. Every value is synthetic: role words, invented labels.

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

// Outside a server action refresh() throws; the add and the Remove call it when they are done.
const cache = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/cache', () => cache);

vi.mock('next-intl/server', () => ({
  getRequestConfig: (create: unknown) => create,
  getTranslations: () => Promise.resolve((key: string) => key),
}));

const admin = migratorPool();
let clinicA: string;
let clinicB: string;
/** Cookies: an owner of both clinics, and a dentist, a hygienist and a front desk of clinic A. */
const cookies = {} as Record<'owner' | 'dentist' | 'hygienist' | 'front_desk', string>;
let ownerId: string;

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.48.0.${nextAddress++}`;

/** The zone insertClinic gives a clinic. */
const SKOPJE = 'Europe/Skopje';
/** The clinics' today when the file starts; the days below keep two days from it, either way. */
let today: string;
const ahead = (days: number) => addDays(today, days);

interface ClosedRow {
  date: string;
  label: string;
  created_at: Date;
  updated_at: Date;
}

/** The clinic's closed_days rows, by date, as the migration role reads them. */
async function closedRowsOf(clinicId: string): Promise<ClosedRow[]> {
  const { rows } = await admin.query<ClosedRow>(
    `select date::text as date, label, created_at, updated_at
       from closed_days where clinic_id = $1 order by date`,
    [clinicId],
  );
  return rows;
}

/** When a row was set up: long before any action of this file. */
const SET_UP_AT = new Date('2026-01-05T08:00:00Z');

/** Sets the clinic's closed days as the migration role: these dates and labels, no other row. */
async function setClosedDays(clinicId: string, days: Record<string, string>): Promise<void> {
  await admin.query('delete from closed_days where clinic_id = $1', [clinicId]);
  for (const [date, label] of Object.entries(days)) {
    await insertRow(admin, 'closed_days', {
      id: newId(),
      clinic_id: clinicId,
      date,
      label,
      created_at: SET_UP_AT,
      updated_at: SET_UP_AT,
    });
  }
}

/** Every closed-day audit row of the clinic, oldest first. */
async function allClosedDayAudit(clinicId: string) {
  const { rows } = await admin.query(
    `select clinic_id, actor_type, actor_id, action, entity_type, entity_id, metadata
       from audit_log
      where clinic_id = $1 and action in ('clinic.closed_day_added', 'clinic.closed_day_removed')
      order by at, id`,
    [clinicId],
  );
  return rows;
}

/** How many closed-day audit rows each clinic had when the test began: the log is only added to. */
const auditedBefore = new Map<string, number>();

/** The clinic's closed-day audit rows written since the test began, oldest first. */
async function closedDayAudit(clinicId: string) {
  return (await allClosedDayAudit(clinicId)).slice(auditedBefore.get(clinicId) ?? 0);
}

/** The add form's data as the browser sends it. */
function addForm(date: string, label: string): FormData {
  const data = new FormData();
  data.append('date', date);
  data.append('label', label);
  return data;
}

/** A Remove's data as the browser sends it: the date, hidden. */
function removeForm(date: string): FormData {
  const data = new FormData();
  data.append('date', date);
  return data;
}

/** The action as `role` of clinic A (the owner: of the clinic `clinicId`, picked). */
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

/** The id of the PostgreSQL server process behind the transaction's connection. */
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

beforeAll(async () => {
  today = dayInZone(new Date(), SKOPJE);
  [clinicA, clinicB] = [await insertClinic(admin), await insertClinic(admin)];
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

beforeEach(async () => {
  cache.refresh.mockClear();
  for (const clinicId of [clinicA, clinicB]) {
    await setClosedDays(clinicId, {});
    auditedBefore.set(clinicId, (await allClosedDayAudit(clinicId)).length);
  }
});

describe('a closed day added and removed, one audit row each, naming the date and never the label (acceptance 1)', () => {
  it("added: its row, the label trimmed, at the action's moment; one clinic.closed_day_added row by the owner about the clinic; the page refreshed", async () => {
    const date = ahead(10);
    as('owner');
    const before = new Date();
    expect(await addClosedDay(clinicA, addForm(date, '  Closed for training '))).toEqual({
      ok: true,
      value: { date },
    });
    const after = new Date();
    const [row, ...others] = await closedRowsOf(clinicA);
    expect(others).toEqual([]);
    expect(row).toMatchObject({ date, label: 'Closed for training' });
    expect(row!.created_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row!.created_at.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(row!.updated_at).toEqual(row!.created_at);
    const audited = await closedDayAudit(clinicA);
    expect(audited).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'clinic.closed_day_added',
        entity_type: 'clinic',
        entity_id: clinicA,
        metadata: { date },
      },
    ]);
    expect(JSON.stringify(audited)).not.toContain('training');
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('removed: its row gone; one clinic.closed_day_removed row naming the date and never the label; the page refreshed', async () => {
    const [kept, removed] = [ahead(12), ahead(13)];
    await setClosedDays(clinicA, { [kept]: 'Staff day', [removed]: 'Closed for training' });
    as('owner');
    expect(await removeClosedDay(clinicA, removeForm(removed))).toEqual({
      ok: true,
      value: { date: removed },
    });
    expect((await closedRowsOf(clinicA)).map((row) => row.date)).toEqual([kept]);
    const audited = await closedDayAudit(clinicA);
    expect(audited).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'clinic.closed_day_removed',
        entity_type: 'clinic',
        entity_id: clinicA,
        metadata: { date: removed },
      },
    ]);
    expect(JSON.stringify(audited)).not.toContain('training');
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it("the page's read: the days from the clinic's today on, by date, each with its label; a past one not", async () => {
    await setClosedDays(clinicA, {
      [ahead(30)]: 'Later',
      [ahead(-2)]: 'Past',
      [ahead(3)]: 'Sooner',
    });
    as('owner');
    const expected = [
      { date: ahead(3), label: 'Sooner' },
      { date: ahead(30), label: 'Later' },
    ];
    expect(await readClosedDays.forPage({})).toEqual({ ok: true, value: expected });
    expect(await readClosedDays(clinicA, {})).toEqual({ ok: true, value: expected });
  });

  it.each([
    { what: 'an empty date', date: '', label: 'Staff day', field: 'date' },
    { what: 'a day the month lacks', date: '2031-02-30', label: 'Staff day', field: 'date' },
    { what: 'an empty label', date: 'ahead', label: '', field: 'label' },
    { what: 'a label of blanks', date: 'ahead', label: '   ', field: 'label' },
    { what: 'a label of 101 characters', date: 'ahead', label: 'L'.repeat(101), field: 'label' },
  ])(
    '$what: invalid_input at $field, with nothing saved and no audit row',
    async ({ date, label, field }) => {
      as('owner');
      const result = await addClosedDay(
        clinicA,
        addForm(date === 'ahead' ? ahead(10) : date, label),
      );
      if (result.ok || !('issues' in result.error)) throw new Error('expected invalid_input');
      expect(result.error.issues.map((issue) => issue.path)).toEqual([[field]]);
      expect(await closedRowsOf(clinicA)).toEqual([]);
      expect(await closedDayAudit(clinicA)).toEqual([]);
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it('a date already closed: already_closed, the first label kept, with no audit row and no refresh', async () => {
    const date = ahead(10);
    await setClosedDays(clinicA, { [date]: 'Staff day' });
    const rows = await closedRowsOf(clinicA);
    as('owner');
    expect(await addClosedDay(clinicA, addForm(date, 'Closed for training'))).toEqual({
      ok: false,
      error: { code: 'already_closed' },
    });
    expect(await closedRowsOf(clinicA)).toEqual(rows);
    expect(await closedDayAudit(clinicA)).toEqual([]);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("a date before the clinic's today: in_the_past, nothing saved; 0000-01-01, which PostgreSQL takes no year of, too, never internal", async () => {
    as('owner');
    for (const date of [ahead(-2), '1999-12-31', '0000-01-01']) {
      expect(await addClosedDay(clinicA, addForm(date, 'Staff day')), date).toEqual({
        ok: false,
        error: { code: 'in_the_past' },
      });
    }
    expect(await closedRowsOf(clinicA)).toEqual([]);
    expect(await closedDayAudit(clinicA)).toEqual([]);
  });

  it("a Remove of a day no longer closed: not_closed; of one before the clinic's today: in_the_past, its row kept", async () => {
    const past = ahead(-2);
    await setClosedDays(clinicA, { [past]: 'Staff day' });
    const rows = await closedRowsOf(clinicA);
    as('owner');
    expect(await removeClosedDay(clinicA, removeForm(ahead(10)))).toEqual({
      ok: false,
      error: { code: 'not_closed' },
    });
    for (const date of [past, '0000-01-01']) {
      expect(await removeClosedDay(clinicA, removeForm(date)), date).toEqual({
        ok: false,
        error: { code: 'in_the_past' },
      });
    }
    expect(await closedRowsOf(clinicA)).toEqual(rows);
    expect(await closedDayAudit(clinicA)).toEqual([]);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("today itself may be added and removed: the clinic's today, at the module's now", async () => {
    const now = new Date();
    const date = dayInZone(now, SKOPJE);
    expect(
      await withTenant(clinicA, (tx) => tenancy.addClosedDay(tx, { date, label: 'Today' }, now)),
    ).toEqual({ ok: true });
    expect(await withTenant(clinicA, (tx) => tenancy.closedDaysAhead(tx, now))).toEqual([
      { date, label: 'Today' },
    ]);
    expect(await withTenant(clinicA, (tx) => tenancy.removeClosedDay(tx, date, now))).toEqual({
      ok: true,
    });
    expect(await closedRowsOf(clinicA)).toEqual([]);
  });

  it('a day the schema should have refused is an Error from the module, with nothing written', async () => {
    const now = new Date();
    for (const day of [
      { date: '2031-02-30', label: 'Staff day' },
      { date: '31.12.2031', label: 'Staff day' },
      { date: ahead(10), label: '' },
      { date: ahead(10), label: '   ' },
      { date: ahead(10), label: 'L'.repeat(101) },
    ]) {
      await expect(
        withTenant(clinicA, (tx) => tenancy.addClosedDay(tx, day, now)),
        JSON.stringify(day),
      ).rejects.toThrow(Error);
    }
    await expect(
      withTenant(clinicA, (tx) => tenancy.removeClosedDay(tx, '2031-02-30', now)),
    ).rejects.toThrow(Error);
    expect(await closedRowsOf(clinicA)).toEqual([]);
  });

  // The date's unique key settles two adds at once, with no lock on the clinic's row: the second
  // insert waits for the first's transaction, then does nothing, answered already_closed; never the
  // key's violation, which would be internal. The first is held open until the second is seen
  // waiting behind it, as in opening-hours.test.ts.
  it('two adds of one date at once: the second waits for the first, then is already_closed, never a failure', async () => {
    const date = ahead(20);
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let firstPid = 0;
    let firstWritten = () => {};
    const written = new Promise<void>((resolve) => (firstWritten = resolve));
    const one = withTenant(clinicA, async (tx) => {
      firstPid = await backendPid(tx);
      const result = await tenancy.addClosedDay(tx, { date, label: 'First tab' }, new Date());
      firstWritten();
      await held; // its transaction, and so its new row, stay uncommitted
      return result;
    });
    await Promise.race([written, one]);
    const two = withTenant(clinicA, (tx) =>
      tenancy.addClosedDay(tx, { date, label: 'Second tab' }, new Date()),
    );
    try {
      await waitingBehind(firstPid);
    } finally {
      release();
    }
    expect(await one).toEqual({ ok: true });
    expect(await two).toEqual({ ok: false, code: 'already_closed' });
    expect(await closedRowsOf(clinicA)).toMatchObject([{ date, label: 'First tab' }]);
  });

  it('two Removes of one date at once: the second waits for the first, then finds none, not_closed', async () => {
    const date = ahead(20);
    await setClosedDays(clinicA, { [date]: 'Staff day' });
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let firstPid = 0;
    let firstRemoved = () => {};
    const removed = new Promise<void>((resolve) => (firstRemoved = resolve));
    const one = withTenant(clinicA, async (tx) => {
      firstPid = await backendPid(tx);
      const result = await tenancy.removeClosedDay(tx, date, new Date());
      firstRemoved();
      await held;
      return result;
    });
    await Promise.race([removed, one]);
    const two = withTenant(clinicA, (tx) => tenancy.removeClosedDay(tx, date, new Date()));
    try {
      await waitingBehind(firstPid);
    } finally {
      release();
    }
    expect(await one).toEqual({ ok: true });
    expect(await two).toEqual({ ok: false, code: 'not_closed' });
    expect(await closedRowsOf(clinicA)).toEqual([]);
  });
});

describe('a dentist, a hygienist and the front desk can neither read, add nor remove closed days (acceptance 2)', () => {
  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden, for the read, the add and the Remove; the rows and the audit log as they were',
    async (role) => {
      const date = ahead(10);
      await setClosedDays(clinicA, { [date]: 'Staff day' });
      const rows = await closedRowsOf(clinicA);
      as(role);
      const forbidden = { ok: false, error: { code: 'forbidden' } };
      expect(await readClosedDays(clinicA, {})).toEqual(forbidden);
      expect(await readClosedDays.forPage({})).toEqual(forbidden);
      expect(await addClosedDay(clinicA, addForm(ahead(11), 'Staff day'))).toEqual(forbidden);
      expect(await removeClosedDay(clinicA, removeForm(date))).toEqual(forbidden);
      expect(await closedRowsOf(clinicA)).toEqual(rows);
      expect(await closedDayAudit(clinicA)).toEqual([]);
    },
  );
});

describe("a change touches its own clinic's closed days only (acceptance 3)", () => {
  it("the other clinic's row for the same date is no conflict, and stays through an add and a Remove", async () => {
    const date = ahead(10);
    await setClosedDays(clinicB, { [date]: 'Closed in B' });
    const b = await closedRowsOf(clinicB);
    as('owner');
    expect(await addClosedDay(clinicA, addForm(date, 'Closed in A'))).toMatchObject({ ok: true });
    expect(await closedRowsOf(clinicA)).toMatchObject([{ date, label: 'Closed in A' }]);
    expect(await closedRowsOf(clinicB)).toEqual(b);
    expect(await removeClosedDay(clinicA, removeForm(date))).toMatchObject({ ok: true });
    expect(await closedRowsOf(clinicA)).toEqual([]);
    expect(await closedRowsOf(clinicB)).toEqual(b);
    expect(await closedDayAudit(clinicB)).toEqual([]);
    // A Remove in A of a date only B is closed on: none of A's, so not_closed; B's row stays.
    expect(await removeClosedDay(clinicA, removeForm(date))).toEqual({
      ok: false,
      error: { code: 'not_closed' },
    });
    expect(await closedRowsOf(clinicB)).toEqual(b);
  });

  it("a clinic id among the form's fields is no input; sent with clinic B's id from clinic A: clinic_changed", async () => {
    const date = ahead(10);
    as('owner');
    const data = addForm(date, 'Staff day');
    for (const name of ['clinicId', 'clinic_id', 'id']) data.append(name, clinicB);
    expect(await addClosedDay(clinicA, data)).toMatchObject({ ok: true });
    expect((await closedRowsOf(clinicA)).map((row) => row.date)).toEqual([date]);
    expect(await closedRowsOf(clinicB)).toEqual([]);

    as('owner', clinicA);
    expect(await addClosedDay(clinicB, addForm(ahead(11), 'Staff day'))).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect(await removeClosedDay(clinicB, removeForm(date))).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect((await closedRowsOf(clinicA)).map((row) => row.date)).toEqual([date]);
    expect(await closedRowsOf(clinicB)).toEqual([]);
  });
});

describe("Settings and the calendar together: the calendar's next read of the day (acceptance 4)", () => {
  beforeAll(async () => {
    // Open every weekday, so whatever weekday the day falls on, only a closed day closes it.
    await admin.query('delete from clinic_hours where clinic_id = $1', [clinicA]);
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
      await insertRow(admin, 'clinic_hours', {
        id: newId(),
        clinic_id: clinicA,
        weekday,
        opens: '08:00',
        closes: '18:00',
      });
    }
  });

  function closedOn(date: string) {
    return withTenant(clinicA, async (tx) => (await readDay(tx, date, new Date())).closed);
  }

  it('a closed day added in Settings shows on its day, closed with its label; removed, the day opens again', async () => {
    const date = ahead(15);
    expect(await closedOn(date)).toBeNull();
    as('owner');
    expect(await addClosedDay(clinicA, addForm(date, 'Closed for training'))).toMatchObject({
      ok: true,
    });
    expect(await closedOn(date)).toEqual({ why: 'closed_day', label: 'Closed for training' });
    expect(await closedOn(addDays(date, -1))).toBeNull();
    expect(await closedOn(addDays(date, 1))).toBeNull();
    expect(await removeClosedDay(clinicA, removeForm(date))).toMatchObject({ ok: true });
    expect(await closedOn(date)).toBeNull();
  });
});

describe("the clinic's today in its own zone, never UTC's (acceptance 5)", () => {
  /** 22:00 on Wednesday 14 October 2026 in New York (UTC−4): already the 15th in UTC. */
  const NEW_YORK_EVENING = new Date('2026-10-15T02:00:00Z');
  /** 09:00 on Thursday 15 October 2026 in Auckland (UTC+13): still the 14th in UTC. */
  const AUCKLAND_MORNING = new Date('2026-10-14T20:00:00Z');
  let newYork: string;
  let auckland: string;

  beforeAll(async () => {
    [newYork, auckland] = [await insertClinic(admin), await insertClinic(admin)];
    await admin.query(`update clinics set timezone = 'America/New_York' where id = $1`, [newYork]);
    await admin.query(`update clinics set timezone = 'Pacific/Auckland' where id = $1`, [auckland]);
  });

  beforeEach(async () => {
    await setClosedDays(newYork, {});
    await setClosedDays(auckland, {});
  });

  it('at 22:00 on the 14th in New York (the 15th in UTC), the 14th is still its today: listed and accepted, the 13th refused', async () => {
    await setClosedDays(newYork, {
      '2026-10-13': 'Day before',
      '2026-10-14': 'Its today',
      '2026-10-16': 'Ahead',
    });
    expect(
      await withTenant(newYork, (tx) => tenancy.closedDaysAhead(tx, NEW_YORK_EVENING)),
    ).toEqual([
      { date: '2026-10-14', label: 'Its today' },
      { date: '2026-10-16', label: 'Ahead' },
    ]);
    await setClosedDays(newYork, {});
    const add = (date: string) =>
      withTenant(newYork, (tx) =>
        tenancy.addClosedDay(tx, { date, label: 'Staff day' }, NEW_YORK_EVENING),
      );
    expect(await add('2026-10-14')).toEqual({ ok: true });
    expect(await add('2026-10-13')).toEqual({ ok: false, code: 'in_the_past' });
    expect((await closedRowsOf(newYork)).map((row) => row.date)).toEqual(['2026-10-14']);
  });

  it('and removed that evening: the 14th; the 13th refused, its row kept', async () => {
    await setClosedDays(newYork, { '2026-10-13': 'Day before', '2026-10-14': 'Its today' });
    const remove = (date: string) =>
      withTenant(newYork, (tx) => tenancy.removeClosedDay(tx, date, NEW_YORK_EVENING));
    expect(await remove('2026-10-14')).toEqual({ ok: true });
    expect(await remove('2026-10-13')).toEqual({ ok: false, code: 'in_the_past' });
    expect((await closedRowsOf(newYork)).map((row) => row.date)).toEqual(['2026-10-13']);
  });

  it("a closed day shows on the calendar's own date, never the day before", async () => {
    expect(
      await withTenant(newYork, (tx) =>
        tenancy.addClosedDay(tx, { date: '2026-10-14', label: 'Its today' }, NEW_YORK_EVENING),
      ),
    ).toEqual({ ok: true });
    const closedOn = (date: string) =>
      withTenant(newYork, async (tx) => (await readDay(tx, date, NEW_YORK_EVENING)).closed);
    expect(await closedOn('2026-10-14')).toEqual({ why: 'closed_day', label: 'Its today' });
    // The clinic has no hours: a day without a closed day is closed for that reason alone.
    expect(await closedOn('2026-10-13')).toEqual({ why: 'no_hours' });
    expect(await closedOn('2026-10-15')).toEqual({ why: 'no_hours' });
  });

  it('the other way, in a zone ahead of UTC: at 09:00 on the 15th in Auckland (the 14th in UTC), the 14th is past', async () => {
    const add = (date: string) =>
      withTenant(auckland, (tx) =>
        tenancy.addClosedDay(tx, { date, label: 'Staff day' }, AUCKLAND_MORNING),
      );
    expect(await add('2026-10-14')).toEqual({ ok: false, code: 'in_the_past' });
    expect(await add('2026-10-15')).toEqual({ ok: true });
    expect(
      await withTenant(auckland, (tx) => tenancy.closedDaysAhead(tx, AUCKLAND_MORNING)),
    ).toEqual([{ date: '2026-10-15', label: 'Staff day' }]);
  });
});

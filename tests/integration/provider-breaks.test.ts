import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookingWarnings } from '@/app/(staff)/calendar/booking-warnings';
import { readCalendarDay } from '@/app/(staff)/calendar/actions';
import { addBreak, readBreaks, removeBreak } from '@/app/(staff)/settings/provider-actions';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import * as scheduling from '@/modules/scheduling';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertRow, validRow, type ClinicRefs } from './scheduling-fixtures';

// E01-T09e, acceptance 1, 2, 3 and 5: the providers' weekly breaks as the app runs them: the real
// actions with a real session, the scheduling module in a tenant transaction, as the app role, under
// Row-Level Security; then the Settings read and the calendar's read, the booking drawer's warning
// made from it (no browser). Two adds at once are concurrent transactions on the pool. Only
// next/headers, next/cache and next-intl's request functions are replaced, as there is no running
// Next.js. Rows are set up and inspected as the migration role. Every value is synthetic: role words,
// invented names and labels.

const PASSWORD = 'MARKER-pw-3c8f-correct';

const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));

// Outside a server action refresh() throws; each add and remove calls it when it is done.
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

let nextAddress = 1;
const freshAddress = () => `10.55.0.${nextAddress++}`;

/** A Monday the calendar shows, far from today, and the Wednesday after it. */
const MONDAY = '2031-03-17';
const WEDNESDAY = '2031-03-19';

const SET_UP_AT = new Date('2026-01-05T08:00:00Z');
const H = 60;

interface BreakRow {
  id: string;
  clinic_id: string;
  provider_id: string;
  weekday: number;
  starts: string;
  ends: string;
  label: string;
  created_at: Date;
  updated_at: Date;
}

/** The clinic's break rows by weekday, start and id, as the migration role reads them. */
async function breaksOf(clinicId: string): Promise<BreakRow[]> {
  const { rows } = await admin.query<BreakRow>(
    `select id, clinic_id, provider_id, weekday, starts::text, ends::text, label, created_at, updated_at
       from provider_breaks where clinic_id = $1 order by weekday, starts, id`,
    [clinicId],
  );
  return rows;
}

/** A provider's breaks as [weekday, starts, ends, label], for short comparisons. */
async function breaksSummary(providerId: string) {
  return (await breaksOf(clinicA))
    .filter((row) => row.provider_id === providerId)
    .map((row) => [row.weekday, row.starts.slice(0, 5), row.ends.slice(0, 5), row.label]);
}

async function everythingOf(clinicId: string) {
  const { rows } = await admin.query(
    'select * from provider_breaks where clinic_id = $1 order by id',
    [clinicId],
  );
  return rows;
}

/** Writes a provider as the migration role, set up long before any action of this file. */
async function setUpProvider(
  clinicId: string,
  name: string,
  values: { sortOrder?: number; active?: boolean } = {},
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'providers', {
    ...validRow('providers', { clinicId } as ClinicRefs),
    id,
    name,
    short_name: name.slice(0, 12),
    kind: 'dentist',
    chair_label: 'Chair 9',
    color_hue: 120,
    active: values.active ?? true,
    sort_order: values.sortOrder ?? 0,
    created_at: SET_UP_AT,
    updated_at: SET_UP_AT,
  });
  return id;
}

/** Writes a break as the migration role. */
async function setUpBreak(
  clinicId: string,
  providerId: string,
  weekday: number,
  starts: string,
  ends: string,
  label = 'Lunch',
): Promise<string> {
  const id = newId();
  await insertRow(admin, 'provider_breaks', {
    id,
    clinic_id: clinicId,
    provider_id: providerId,
    weekday,
    starts,
    ends,
    label,
    created_at: SET_UP_AT,
    updated_at: SET_UP_AT,
  });
  return id;
}

async function breakAudit(clinicId: string) {
  const { rows } = await admin.query(
    `select clinic_id, actor_type, actor_id, action, entity_type, entity_id, metadata
       from audit_log where clinic_id = $1 and action like 'provider.break_%'
      order by at, id`,
    [clinicId],
  );
  return rows;
}

/** The add form's fields, with those given in place of these. */
function addForm(providerId: string, fields: Record<string, string> = {}): FormData {
  const all: Record<string, string> = {
    providerId,
    weekday: '1',
    starts: '12:00',
    ends: '13:00',
    label: 'Lunch',
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all)) data.append(name, value);
  return data;
}

function removeForm(breakId: string): FormData {
  const data = new FormData();
  data.append('breakId', breakId);
  return data;
}

/** The calendar's columns on the day, by provider id, as the page reads them. */
async function columnsOn(day: string) {
  const read = await readCalendarDay(clinicA, { day });
  if (!read.ok) throw new Error(`not read: ${read.error.code}`);
  return read.value.view;
}

/** The breaks the calendar draws in the provider's column on the day: [from, to, label]. */
async function hatchedOn(day: string, providerId: string) {
  const view = await columnsOn(day);
  const column = view.columns.find((each) => each.providerId === providerId);
  return (column?.blocks ?? [])
    .filter((block) => block.kind === 'break')
    .map((block) => [block.from, block.to, block.label]);
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

let ana: string;
let boris: string;

beforeAll(async () => {
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
    await admin.query('delete from appointments where clinic_id = $1', [clinicId]);
    await admin.query('update memberships set provider_id = null where clinic_id = $1', [clinicId]);
    await admin.query('delete from provider_breaks where clinic_id = $1', [clinicId]);
    await admin.query('delete from clinic_hours where clinic_id = $1', [clinicId]);
    await admin.query('delete from providers where clinic_id = $1', [clinicId]);
    await admin.query(
      `delete from audit_log where clinic_id = $1 and action like 'provider.break_%'`,
      [clinicId],
    );
  }
  // The calendar draws no break on a day without opening hours: Monday to Friday, 08:00 to 18:00.
  for (const weekday of [1, 2, 3, 4, 5]) {
    await insertRow(admin, 'clinic_hours', {
      id: newId(),
      clinic_id: clinicA,
      weekday,
      opens: '08:00',
      closes: '18:00',
    });
  }
  ana = await setUpProvider(clinicA, 'Ana Probna', { sortOrder: 0 });
  boris = await setUpProvider(clinicA, 'Boris Bliznak', { sortOrder: 1 });
});

describe('an add and a remove (acceptance 1)', () => {
  it('an added break is stored for its provider and weekday with the times, the trimmed label and the moment of the action; one provider.break_added row of ids and the weekday; the page refreshed; the Settings read lists it', async () => {
    as('owner');
    const before = new Date();
    const answer = await addBreak(
      clinicA,
      addForm(ana, { weekday: '3', label: '  Tea  ', starts: '15:30', ends: '15:45' }),
    );
    const after = new Date();
    if (!answer.ok) throw new Error(`not added: ${answer.error.code}`);
    const rows = await breaksOf(clinicA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: answer.value.id,
      clinic_id: clinicA,
      provider_id: ana,
      weekday: 3,
      starts: '15:30:00',
      ends: '15:45:00',
      label: 'Tea',
    });
    for (const moment of [rows[0]!.created_at, rows[0]!.updated_at]) {
      expect(moment.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(moment.getTime()).toBeLessThanOrEqual(after.getTime());
    }
    expect(cache.refresh).toHaveBeenCalledOnce();
    expect(await breakAudit(clinicA)).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'provider.break_added',
        entity_type: 'provider_break',
        entity_id: answer.value.id,
        metadata: { providerId: ana, weekday: 3 },
      },
    ]);
    const read = await readBreaks.forPage({});
    expect(read.ok && read.value).toEqual([
      {
        id: answer.value.id,
        providerId: ana,
        weekday: 3,
        starts: '15:30',
        ends: '15:45',
        label: 'Tea',
      },
    ]);
  });

  it("the Settings read lists the clinic's breaks of every provider, active or not, by weekday, start and id, times as HH:MM and HH:MM:SS when a stored time has seconds", async () => {
    const gone = await setUpProvider(clinicA, 'Vera Vzorec', { sortOrder: 2, active: false });
    const wednesday = await setUpBreak(clinicA, ana, 3, '09:00', '09:30', 'Meeting');
    const lunchBoris = await setUpBreak(clinicA, boris, 1, '12:00', '13:00', 'Lunch');
    const lunchAna = await setUpBreak(clinicA, ana, 1, '12:00', '13:00', 'Lunch');
    const early = await setUpBreak(clinicA, gone, 1, '08:00', '08:10:30', 'Setup');
    await setUpBreak(
      clinicB,
      await setUpProvider(clinicB, 'Zora Zdravkova'),
      1,
      '10:00',
      '11:00',
      'B',
    );
    as('owner');
    const read = await readBreaks.forPage({});
    if (!read.ok) throw new Error('not read');
    const lunches = [lunchAna, lunchBoris].sort(); // the same weekday and start: by id
    expect(read.value.map((each) => [each.id, each.weekday, each.starts, each.ends])).toEqual([
      [early, 1, '08:00', '08:10:30'],
      [lunches[0], 1, '12:00', '13:00'],
      [lunches[1], 1, '12:00', '13:00'],
      [wednesday, 3, '09:00', '09:30'],
    ]);
  });

  it("an added break is hatched in the provider's column on its weekday and in no other's or other day's, and the drawer warns of it for a time inside it; a removed one is gone from both", async () => {
    as('owner');
    const added = await addBreak(clinicA, addForm(ana));
    if (!added.ok) throw new Error('not added');
    expect(await hatchedOn(MONDAY, ana)).toEqual([[12 * H, 13 * H, 'Lunch']]);
    expect(await hatchedOn(MONDAY, boris)).toEqual([]);
    expect(await hatchedOn(WEDNESDAY, ana)).toEqual([]);

    const view = await columnsOn(MONDAY);
    const warned = (start: number, length: number, providerId = ana) =>
      bookingWarnings(view, { providerId, start, length }).breaks.map((block) => block.label);
    expect(warned(12 * H + 15, 30)).toEqual(['Lunch']);
    expect(warned(11 * H + 30, 45)).toEqual(['Lunch']);
    expect(warned(11 * H, 60)).toEqual([]); // ends as the break starts: no overlap
    expect(warned(13 * H, 30)).toEqual([]);
    expect(warned(12 * H + 15, 30, boris)).toEqual([]);

    const removed = await removeBreak(clinicA, removeForm(added.value.id));
    expect(removed).toEqual({ ok: true, value: { id: added.value.id } });
    expect(await breaksOf(clinicA)).toEqual([]);
    expect(await hatchedOn(MONDAY, ana)).toEqual([]);
    const after = await columnsOn(MONDAY);
    expect(
      bookingWarnings(after, { providerId: ana, start: 12 * H + 15, length: 30 }).breaks,
    ).toEqual([]);
  });

  it('a remove deletes the row and writes one provider.break_removed row about the break; the others stay; the page refreshed', async () => {
    const keep = await setUpBreak(clinicA, ana, 1, '12:00', '13:00');
    const drop = await setUpBreak(clinicA, ana, 2, '12:00', '13:00');
    as('owner');
    expect(await removeBreak(clinicA, removeForm(drop))).toEqual({ ok: true, value: { id: drop } });
    expect((await breaksOf(clinicA)).map((row) => row.id)).toEqual([keep]);
    expect(await breakAudit(clinicA)).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'provider.break_removed',
        entity_type: 'provider_break',
        entity_id: drop,
        metadata: {},
      },
    ]);
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('a second remove of a break already gone is not_found: nothing written, no audit row, nothing refreshed again', async () => {
    const id = await setUpBreak(clinicA, ana, 1, '12:00', '13:00');
    as('owner');
    expect(await removeBreak(clinicA, removeForm(id))).toMatchObject({ ok: true });
    expect(await removeBreak(clinicA, removeForm(id))).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await removeBreak(clinicA, removeForm(newId()))).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await breakAudit(clinicA)).toHaveLength(1);
    expect(cache.refresh).toHaveBeenCalledOnce();
  });

  it('two removes of one break at once: one removes it, the other is not_found, one audit row', async () => {
    const id = await setUpBreak(clinicA, ana, 1, '12:00', '13:00');
    as('owner');
    const answers = await Promise.all([
      removeBreak(clinicA, removeForm(id)),
      removeBreak(clinicA, removeForm(id)),
    ]);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok)).toEqual([
      { ok: false, error: { code: 'not_found' } },
    ]);
    expect(await breaksOf(clinicA)).toEqual([]);
    expect(await breakAudit(clinicA)).toHaveLength(1);
  });

  it('an inactive provider has breaks as an active one has', async () => {
    const gone = await setUpProvider(clinicA, 'Vera Vzorec', { sortOrder: 2, active: false });
    as('owner');
    expect(await addBreak(clinicA, addForm(gone))).toMatchObject({ ok: true });
    expect(await breaksSummary(gone)).toEqual([[1, '12:00', '13:00', 'Lunch']]);
  });

  it('every weekday 1 to 7 takes a break, and an all-day break to 23:45 and one to 24:00 are stored', async () => {
    as('owner');
    for (const weekday of ['1', '2', '3', '4', '5', '6', '7']) {
      expect(await addBreak(clinicA, addForm(ana, { weekday }))).toMatchObject({ ok: true });
    }
    expect(
      await addBreak(clinicA, addForm(boris, { starts: '00:00', ends: '23:45' })),
    ).toMatchObject({
      ok: true,
    });
    expect(
      await addBreak(clinicA, addForm(boris, { weekday: '2', starts: '22:00', ends: '24:00' })),
    ).toMatchObject({ ok: true });
    expect(await breaksOf(clinicA)).toHaveLength(9);
  });
});

describe('overlap (acceptance 2)', () => {
  beforeEach(async () => {
    await setUpBreak(clinicA, ana, 1, '12:00', '13:00', 'Lunch');
  });

  it.each([
    ['the same times', '12:00', '13:00'],
    ['inside it', '12:15', '12:45'],
    ['round it', '11:00', '14:00'],
    ['across its start', '11:30', '12:15'],
    ['across its end', '12:45', '13:30'],
    ['from its start to later', '12:00', '12:30'],
    ['from earlier to its end', '12:30', '13:00'],
    ['one minute into it from before', '11:00', '12:01'],
    ['one minute into it from after', '12:59', '14:00'],
  ])(
    '%s: break_overlaps, nothing written, no audit row, nothing refreshed',
    async (_what, starts, ends) => {
      const rows = await everythingOf(clinicA);
      as('owner');
      expect(await addBreak(clinicA, addForm(ana, { starts, ends, label: 'Other' }))).toEqual({
        ok: false,
        error: { code: 'break_overlaps' },
      });
      expect(await everythingOf(clinicA)).toEqual(rows);
      expect(await breakAudit(clinicA)).toEqual([]);
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it('back to back is no overlap: one that ends as it starts and one that starts as it ends are both added', async () => {
    as('owner');
    expect(
      await addBreak(clinicA, addForm(ana, { starts: '11:00', ends: '12:00', label: 'Before' })),
    ).toMatchObject({ ok: true });
    expect(
      await addBreak(clinicA, addForm(ana, { starts: '13:00', ends: '14:00', label: 'After' })),
    ).toMatchObject({ ok: true });
    expect(await breaksSummary(ana)).toEqual([
      [1, '11:00', '12:00', 'Before'],
      [1, '12:00', '13:00', 'Lunch'],
      [1, '13:00', '14:00', 'After'],
    ]);
  });

  it("another weekday of the same provider, and the same times of another provider, are no overlap; neither is another clinic's provider's", async () => {
    as('owner');
    expect(await addBreak(clinicA, addForm(ana, { weekday: '2' }))).toMatchObject({ ok: true });
    expect(await addBreak(clinicA, addForm(boris))).toMatchObject({ ok: true });
    const providerB = await setUpProvider(clinicB, 'Zora Zdravkova');
    await setUpBreak(clinicB, providerB, 1, '12:00', '13:00');
    expect(await breaksOf(clinicA)).toHaveLength(3);
  });

  it('a refusal leaves the provider free for a time that does not overlap, and after a remove the same times are free again', async () => {
    as('owner');
    expect(await addBreak(clinicA, addForm(ana, { label: 'Other' }))).toMatchObject({ ok: false });
    const [stored] = await breaksOf(clinicA);
    expect(await removeBreak(clinicA, removeForm(stored!.id))).toMatchObject({ ok: true });
    expect(await addBreak(clinicA, addForm(ana, { label: 'Other' }))).toMatchObject({ ok: true });
    expect(await breaksSummary(ana)).toEqual([[1, '12:00', '13:00', 'Other']]);
  });

  it('two adds of overlapping breaks at once keep one; the other is break_overlaps', async () => {
    as('owner');
    const answers = await Promise.all([
      addBreak(clinicA, addForm(boris, { starts: '09:00', ends: '10:00', label: 'First' })),
      addBreak(clinicA, addForm(boris, { starts: '09:30', ends: '10:30', label: 'Second' })),
    ]);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(
      answers.filter((answer) => !answer.ok).map((answer) => !answer.ok && answer.error.code),
    ).toEqual(['break_overlaps']);
    expect(await breaksSummary(boris)).toHaveLength(1);
    expect(await breakAudit(clinicA)).toHaveLength(1);
  });

  it('many adds of the same times at once keep one', async () => {
    as('owner');
    const answers = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        addBreak(clinicA, addForm(boris, { weekday: '4', label: `Try ${index}` })),
      ),
    );
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(await breaksSummary(boris)).toHaveLength(1);
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it('two adds at once that do not overlap both land; two providers at once each keep their own', async () => {
    as('owner');
    const answers = await Promise.all([
      addBreak(clinicA, addForm(boris, { starts: '09:00', ends: '10:00' })),
      addBreak(clinicA, addForm(boris, { starts: '10:00', ends: '11:00' })),
      addBreak(clinicA, addForm(ana, { starts: '09:00', ends: '10:00' })),
      addBreak(clinicA, addForm(ana, { starts: '09:30', ends: '10:30' })),
    ]);
    // Ana's two overlap: one of them is refused; the others land.
    expect(answers.filter((answer) => answer.ok)).toHaveLength(3);
    expect(await breaksSummary(boris)).toHaveLength(2);
    expect((await breaksSummary(ana)).length).toBe(2); // her lunch and the one that won
  });

  it('an add waits for a transaction that holds the provider, then reads what it left', async () => {
    as('owner');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const first = withTenant(clinicA, async (tx) => {
      const result = await scheduling.addProviderBreak(
        tx,
        { providerId: boris, weekday: 5, starts: '09:00', ends: '10:00', label: 'Held' },
        new Date(),
      );
      locked();
      await held;
      return result;
    });
    await lockTaken;
    let finished = false;
    const second = addBreak(
      clinicA,
      addForm(boris, { weekday: '5', starts: '09:30', ends: '10:30' }),
    ).then((answer) => {
      finished = true;
      return answer;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const waited = !finished;
    // Released either way, so a failure here never leaves the first transaction open.
    release();
    expect(waited).toBe(true);
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toEqual({ ok: false, error: { code: 'break_overlaps' } });
    expect(await breaksSummary(boris)).toEqual([[5, '09:00', '10:00', 'Held']]);
  });
});

describe('what the schema and the module refuse (acceptance 3)', () => {
  it.each([
    ['an empty label', { label: '' }],
    ['a label of blanks', { label: '   ' }],
    ['a label of 41 characters', { label: 'x'.repeat(41) }],
    ['an end equal to the start', { starts: '12:00', ends: '12:00' }],
    ['an end before the start', { starts: '13:00', ends: '12:00' }],
    ['weekday 0', { weekday: '0' }],
    ['weekday 8', { weekday: '8' }],
    ['a weekday that is no number', { weekday: 'mon' }],
    ['a start that is no time', { starts: '25:00' }],
    ['an end that is no time', { ends: 'late' }],
  ])('%s: invalid_input, nothing written, no audit row', async (_what, fields) => {
    as('owner');
    expect(await addBreak(clinicA, addForm(ana, fields))).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(await breaksOf(clinicA)).toEqual([]);
    expect(await breakAudit(clinicA)).toEqual([]);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it('a label of exactly 40 characters is stored whole', async () => {
    as('owner');
    const label = 'ж'.repeat(40);
    expect(await addBreak(clinicA, addForm(ana, { label }))).toMatchObject({ ok: true });
    expect((await breaksOf(clinicA))[0]?.label).toBe(label);
  });

  it.each([
    ['an empty label', { label: ' ' }],
    ['a label of 41 characters', { label: 'x'.repeat(41) }],
    ['an end not after the start', { starts: '10:00', ends: '10:00' }],
    ['weekday 0', { weekday: 0 }],
    ['weekday 8', { weekday: 8 }],
    ['a weekday of 1.5', { weekday: 1.5 }],
    ['a start that is no time', { starts: '9am' }],
    ['an end of 24:01', { ends: '24:01' }],
  ])(
    'the module itself, called with %s that the schema would have refused: an Error, nothing written, and nothing of the value in its message',
    async (_what, fields) => {
      const values = {
        providerId: ana,
        weekday: 1,
        starts: '09:00',
        ends: '10:00',
        label: 'MARKER-label-c41d',
        ...fields,
      };
      const failure = await withTenant(clinicA, (tx) =>
        scheduling.addProviderBreak(tx, values, new Date()),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toMatch(/MARKER|9am|24:01/);
      expect(await breaksOf(clinicA)).toEqual([]);
    },
  );

  it("the table's own checks stay: a break from the migration role with an end not after its start, or weekday 8, is refused", async () => {
    await expect(setUpBreak(clinicA, ana, 1, '13:00', '12:00')).rejects.toThrow();
    await expect(setUpBreak(clinicA, ana, 8, '12:00', '13:00')).rejects.toThrow();
    expect(await breaksOf(clinicA)).toEqual([]);
  });
});

describe('only settings.manage, and only its own clinic (acceptance 5)', () => {
  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: add and remove are forbidden; the rows and the audit log as they were',
    async (role) => {
      const id = await setUpBreak(clinicA, ana, 1, '12:00', '13:00');
      const rows = await everythingOf(clinicA);
      as(role);
      expect(await addBreak(clinicA, addForm(ana, { weekday: '2' }))).toEqual({
        ok: false,
        error: { code: 'forbidden' },
      });
      expect(await removeBreak(clinicA, removeForm(id))).toEqual({
        ok: false,
        error: { code: 'forbidden' },
      });
      expect(await readBreaks.forPage({})).toMatchObject({ ok: false });
      expect(await everythingOf(clinicA)).toEqual(rows);
      expect(await breakAudit(clinicA)).toEqual([]);
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it("clinic B's provider by its id, sent in clinic A, and an unknown id, are not_found: nothing written in either clinic, no audit row", async () => {
    const providerB = await setUpProvider(clinicB, 'Zora Zdravkova');
    as('owner', clinicA);
    for (const providerId of [providerB, newId()]) {
      expect(await addBreak(clinicA, addForm(providerId))).toEqual({
        ok: false,
        error: { code: 'not_found' },
      });
    }
    expect(await breaksOf(clinicA)).toEqual([]);
    expect(await breaksOf(clinicB)).toEqual([]);
    expect(await breakAudit(clinicA)).toEqual([]);
    expect(await breakAudit(clinicB)).toEqual([]);
  });

  it("clinic B's break by its id, sent in clinic A, is not_found: it stays; the Settings read of A lists none of B's", async () => {
    const providerB = await setUpProvider(clinicB, 'Zora Zdravkova');
    const inB = await setUpBreak(clinicB, providerB, 1, '12:00', '13:00', 'Only B');
    const rowsB = await everythingOf(clinicB);
    await setUpBreak(clinicA, ana, 1, '09:00', '09:30', 'Only A');
    as('owner', clinicA);
    expect(await removeBreak(clinicA, removeForm(inB))).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await everythingOf(clinicB)).toEqual(rowsB);
    const read = await readBreaks.forPage({});
    expect(read.ok && read.value.map((each) => each.label)).toEqual(['Only A']);
    as('owner', clinicB);
    const readB = await readBreaks.forPage({});
    expect(readB.ok && readB.value.map((each) => each.label)).toEqual(['Only B']);
  });

  it('the module under Row-Level Security alone: another clinic sees no provider or break of this one', async () => {
    const id = await setUpBreak(clinicA, ana, 1, '12:00', '13:00');
    const rows = await everythingOf(clinicA);
    const added = await withTenant(clinicB, (tx) =>
      scheduling.addProviderBreak(
        tx,
        { providerId: ana, weekday: 2, starts: '12:00', ends: '13:00', label: 'Lunch' },
        new Date(),
      ),
    );
    expect(added).toEqual({ ok: false, code: 'not_found' });
    const removed = await withTenant(clinicB, (tx) => scheduling.removeProviderBreak(tx, id));
    expect(removed).toEqual({ ok: false, code: 'not_found' });
    expect(await withTenant(clinicB, (tx) => scheduling.clinicBreaks(tx))).toEqual([]);
    expect(await everythingOf(clinicA)).toEqual(rows);
  });

  it("an owner of clinic A only, sending clinic B's id as the clinic: refused, nothing written in B", async () => {
    const providerB = await setUpProvider(clinicB, 'Zora Zdravkova');
    const inB = await setUpBreak(clinicB, providerB, 1, '12:00', '13:00');
    const rowsB = await everythingOf(clinicB);
    const onlyA = await member('owner', [clinicA]);
    request.cookie = onlyA.cookie;
    request.clinic = clinicA;
    expect((await addBreak(clinicB, addForm(providerB, { weekday: '2' }))).ok).toBe(false);
    expect((await removeBreak(clinicB, removeForm(inB))).ok).toBe(false);
    expect(await everythingOf(clinicB)).toEqual(rowsB);
    expect(await breakAudit(clinicB)).toEqual([]);
  });
});

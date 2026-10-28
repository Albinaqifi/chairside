import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookableProviders } from '@/app/(staff)/calendar/booking-choices';
import { readCalendarDay } from '@/app/(staff)/calendar/actions';
import { moveProvider, readProviders } from '@/app/(staff)/settings/provider-actions';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import * as scheduling from '@/modules/scheduling';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertRow, validRow, type ClinicRefs } from './scheduling-fixtures';

// E01-T09c, acceptance 1, 2, 3, 4 and 6: the providers' order as the app runs it: the real action with
// a real session, the scheduling module in a tenant transaction, as the app role, under Row-Level
// Security; then the Settings tab's read and the calendar's read, the booking drawer's choices made
// from it (no browser). Two moves at once are concurrent transactions on the pool. Only next/headers,
// next/cache and next-intl's request functions are replaced, as there is no running Next.js. Rows are
// set up and inspected as the migration role. Every value is synthetic: role words, invented names.

const PASSWORD = 'MARKER-pw-2b7e-correct';

const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));

// Outside a server action refresh() throws; each move calls it when it is done.
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
let patientA: string;
let treatmentA: string;

let nextAddress = 1;
const freshAddress = () => `10.54.0.${nextAddress++}`;

/** A Monday the calendar shows, far from today. */
const DAY = '2031-03-17';

const SET_UP_AT = new Date('2026-01-05T08:00:00Z');

interface ProviderRow {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  updated_at: Date;
}

/** The clinic's providers rows, in the calendar's order, as the migration role reads them. */
async function providersOf(clinicId: string): Promise<ProviderRow[]> {
  const { rows } = await admin.query<ProviderRow>(
    `select id, name, active, sort_order, updated_at
       from providers where clinic_id = $1 order by sort_order, name, id`,
    [clinicId],
  );
  return rows;
}

/** Every column of every provider row, for "nothing written": the rows before and after are equal. */
async function everythingOf(clinicId: string) {
  const { rows } = await admin.query('select * from providers where clinic_id = $1 order by id', [
    clinicId,
  ]);
  return rows;
}

/** The names of the clinic's providers, in the calendar's order. */
async function orderOf(clinicId: string): Promise<string[]> {
  return (await providersOf(clinicId)).map((row) => row.name);
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

/** Writes providers of these names at the places 0, 1, 2 ... gives the ids by name. */
async function setUpOrder(
  clinicId: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [place, name] of names.entries()) {
    ids.set(name, await setUpProvider(clinicId, name, { sortOrder: place }));
  }
  return ids;
}

/** Writes a visit of clinic A's patient with this provider, as the migration role. */
async function setUpVisit(providerId: string, startsAt: Date, endsAt: Date): Promise<void> {
  await insertRow(admin, 'appointments', {
    id: newId(),
    clinic_id: clinicA,
    patient_id: patientA,
    provider_id: providerId,
    treatment_type_id: treatmentA,
    title: 'Check-up',
    starts_at: startsAt,
    ends_at: endsAt,
    status: 'booked',
    source: 'staff',
    created_by: ownerId,
  });
}

async function visitsOf(clinicId: string) {
  const { rows } = await admin.query(
    `select id, provider_id, title, starts_at, ends_at, status, updated_at
       from appointments where clinic_id = $1 order by starts_at, id`,
    [clinicId],
  );
  return rows;
}

async function allMoveAudit(clinicId: string) {
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
  return (await allMoveAudit(clinicId)).slice(auditedBefore.get(clinicId) ?? 0);
}

/** A row's form: the id and the direction, hidden. */
function moveForm(providerId: string, direction: string): FormData {
  const data = new FormData();
  data.append('providerId', providerId);
  data.append('direction', direction);
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
    await admin.query('update memberships set provider_id = null where clinic_id = $1', [clinicId]);
    await admin.query('delete from provider_breaks where clinic_id = $1', [clinicId]);
    await admin.query('delete from providers where clinic_id = $1', [clinicId]);
    auditedBefore.set(clinicId, (await allMoveAudit(clinicId)).length);
  }
});

describe('Up and Down change the order (acceptance 1)', () => {
  it("Up swaps a provider with the one before it and Down with the one after; the places stay 0, 1, 2 ...; one provider.moved row of ids and the direction each; the page refreshed; the tab's read, the calendar's columns and the drawer's choices follow; no appointment changes", async () => {
    const ids = await setUpOrder(clinicA, ['Ana Probna', 'Boris Bliznak', 'Vera Vzorec']);
    const ana = ids.get('Ana Probna')!;
    const vera = ids.get('Vera Vzorec')!;
    await setUpVisit(ana, new Date('2031-03-17T08:00:00Z'), new Date('2031-03-17T08:30:00Z'));
    await setUpVisit(vera, new Date('2031-03-17T09:00:00Z'), new Date('2031-03-17T09:30:00Z'));
    const visitsBefore = await visitsOf(clinicA);
    as('owner');

    expect(await moveProvider(clinicA, moveForm(vera, 'up'))).toEqual({
      ok: true,
      value: { id: vera },
    });
    expect(await orderOf(clinicA)).toEqual(['Ana Probna', 'Vera Vzorec', 'Boris Bliznak']);
    expect((await providersOf(clinicA)).map((row) => row.sort_order)).toEqual([0, 1, 2]);
    expect(cache.refresh).toHaveBeenCalledOnce();

    // The tab's read, the calendar's columns and the drawer's select are in that order.
    const read = await readProviders.forPage({});
    if (!read.ok) throw new Error('not read');
    expect(read.value.map((provider) => provider.name)).toEqual([
      'Ana Probna',
      'Vera Vzorec',
      'Boris Bliznak',
    ]);
    const columns = await columnsOn(DAY);
    expect(columns.map((column) => column.providerId)).toEqual([
      ana,
      vera,
      ids.get('Boris Bliznak'),
    ]);
    expect(bookableProviders(columns).map((provider) => provider.id)).toEqual([
      ana,
      vera,
      ids.get('Boris Bliznak'),
    ]);

    expect(await moveProvider(clinicA, moveForm(ana, 'down'))).toMatchObject({ ok: true });
    expect(await orderOf(clinicA)).toEqual(['Vera Vzorec', 'Ana Probna', 'Boris Bliznak']);
    expect((await columnsOn(DAY)).map((column) => column.providerId)).toEqual([
      vera,
      ana,
      ids.get('Boris Bliznak'),
    ]);

    // One audit row each, of ids and the direction alone: no name in it.
    const audited = await providerAudit(clinicA);
    expect(audited).toEqual([
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'provider.moved',
        entity_type: 'provider',
        entity_id: vera,
        metadata: { direction: 'up' },
      },
      {
        clinic_id: clinicA,
        actor_type: 'user',
        actor_id: ownerId,
        action: 'provider.moved',
        entity_type: 'provider',
        entity_id: ana,
        metadata: { direction: 'down' },
      },
    ]);
    expect(JSON.stringify(audited)).not.toMatch(/Probna|Vzorec|Bliznak/);
    expect(await visitsOf(clinicA)).toEqual(visitsBefore);
  });

  it("only the providers whose place changed are written, with updated_at the action's moment; the others' rows as they were", async () => {
    const ids = await setUpOrder(clinicA, ['Ana Probna', 'Boris Bliznak', 'Vera Vzorec']);
    const rowsBefore = await providersOf(clinicA);
    as('owner');
    const before = new Date();
    expect(await moveProvider(clinicA, moveForm(ids.get('Boris Bliznak')!, 'down'))).toMatchObject({
      ok: true,
    });
    const after = new Date();
    const rows = await providersOf(clinicA);
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get('Ana Probna')).toEqual(rowsBefore.find((row) => row.name === 'Ana Probna'));
    for (const name of ['Boris Bliznak', 'Vera Vzorec']) {
      const updated = byName.get(name)!.updated_at.getTime();
      expect(updated, name).toBeGreaterThanOrEqual(before.getTime());
      expect(updated, name).toBeLessThanOrEqual(after.getTime());
    }
    expect(rows.map((row) => [row.name, row.sort_order])).toEqual([
      ['Ana Probna', 0],
      ['Vera Vzorec', 1],
      ['Boris Bliznak', 2],
    ]);
  });

  it('a move writes nothing of the provider but its place: name, kind, active, chair, colour and creation as they were', async () => {
    const ids = await setUpOrder(clinicA, ['Ana Probna', 'Vera Vzorec']);
    const before = await everythingOf(clinicA);
    as('owner');
    expect(await moveProvider(clinicA, moveForm(ids.get('Vera Vzorec')!, 'up'))).toMatchObject({
      ok: true,
    });
    const strip = (row: Record<string, unknown>) => {
      const rest = { ...row };
      delete rest.sort_order;
      delete rest.updated_at;
      return rest;
    };
    expect((await everythingOf(clinicA)).map(strip)).toEqual(before.map(strip));
  });

  it("providers sharing a sort_order or leaving gaps are numbered 0 ... n-1 apart by the first move, in the calendar's own order (names by the database's collation, then id)", async () => {
    // Two adds at once (D-119) share a place; names in both cases and with an accent, which the
    // database's collation orders as the calendar does.
    const ids = new Map<string, string>();
    for (const [name, sortOrder] of [
      ['boris Bliznak', 3],
      ['Čedomir Cvetkov', 3],
      ['Ana Probna', 3],
      ['Vera Vzorec', 9],
    ] as const) {
      ids.set(name, await setUpProvider(clinicA, name, { sortOrder }));
    }
    const shown = await orderOf(clinicA);
    expect(shown.at(-1)).toBe('Vera Vzorec');
    as('owner');
    // Vera Vzorec Up: past the third of the ones that shared a place.
    expect(await moveProvider(clinicA, moveForm(ids.get('Vera Vzorec')!, 'up'))).toMatchObject({
      ok: true,
    });
    const rows = await providersOf(clinicA);
    expect(rows.map((row) => row.sort_order)).toEqual([0, 1, 2, 3]);
    expect(rows.map((row) => row.name)).toEqual([...shown.slice(0, 2), 'Vera Vzorec', shown[2]]);
    // The calendar reads the same order.
    expect((await columnsOn(DAY)).map((column) => column.providerId)).toEqual(
      rows.map((row) => row.id),
    );
  });

  it('an inactive provider moves as an active one does, and stays inactive; an active one can pass it', async () => {
    const ids = new Map<string, string>();
    ids.set('Ana Probna', await setUpProvider(clinicA, 'Ana Probna', { sortOrder: 0 }));
    ids.set(
      'Boris Bliznak',
      await setUpProvider(clinicA, 'Boris Bliznak', { sortOrder: 1, active: false }),
    );
    ids.set('Vera Vzorec', await setUpProvider(clinicA, 'Vera Vzorec', { sortOrder: 2 }));
    as('owner');
    expect(await moveProvider(clinicA, moveForm(ids.get('Boris Bliznak')!, 'down'))).toMatchObject({
      ok: true,
    });
    expect(await providersOf(clinicA)).toMatchObject([
      { name: 'Ana Probna', active: true, sort_order: 0 },
      { name: 'Vera Vzorec', active: true, sort_order: 1 },
      { name: 'Boris Bliznak', active: false, sort_order: 2 },
    ]);
    expect(await moveProvider(clinicA, moveForm(ids.get('Vera Vzorec')!, 'down'))).toMatchObject({
      ok: true,
    });
    expect(await orderOf(clinicA)).toEqual(['Ana Probna', 'Boris Bliznak', 'Vera Vzorec']);
    expect((await providersOf(clinicA)).map((row) => row.active)).toEqual([true, false, true]);
  });

  it('a clinic of two: Up on the second and Down on the first swap them, each way and back', async () => {
    const ids = await setUpOrder(clinicA, ['Ana Probna', 'Vera Vzorec']);
    as('owner');
    await moveProvider(clinicA, moveForm(ids.get('Vera Vzorec')!, 'up'));
    expect(await orderOf(clinicA)).toEqual(['Vera Vzorec', 'Ana Probna']);
    await moveProvider(clinicA, moveForm(ids.get('Vera Vzorec')!, 'down'));
    expect(await orderOf(clinicA)).toEqual(['Ana Probna', 'Vera Vzorec']);
  });

  it("clinic B's order is untouched by a move in clinic A", async () => {
    const idsA = await setUpOrder(clinicA, ['Ana Probna', 'Vera Vzorec']);
    await setUpOrder(clinicB, ['Boris Bliznak', 'Zora Zdravkova', 'Mila Milanova']);
    const rowsB = await everythingOf(clinicB);
    as('owner');
    await moveProvider(clinicA, moveForm(idsA.get('Vera Vzorec')!, 'up'));
    expect(await everythingOf(clinicB)).toEqual(rowsB);
    expect(await providerAudit(clinicB)).toEqual([]);
  });
});

describe('what has no place to go is refused (acceptance 2)', () => {
  it('Up on the first is already_first, Down on the last already_last: nothing written, no audit row, nothing refreshed', async () => {
    const ids = await setUpOrder(clinicA, ['Ana Probna', 'Boris Bliznak', 'Vera Vzorec']);
    const rows = await everythingOf(clinicA);
    as('owner');
    expect(await moveProvider(clinicA, moveForm(ids.get('Ana Probna')!, 'up'))).toEqual({
      ok: false,
      error: { code: 'already_first' },
    });
    expect(await moveProvider(clinicA, moveForm(ids.get('Vera Vzorec')!, 'down'))).toEqual({
      ok: false,
      error: { code: 'already_last' },
    });
    expect(await everythingOf(clinicA)).toEqual(rows);
    expect(await providerAudit(clinicA)).toEqual([]);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it('a clinic of one provider has no place to go either way; its places are not renumbered by the refusal', async () => {
    const id = await setUpProvider(clinicA, 'Ana Probna', { sortOrder: 7 });
    const rows = await everythingOf(clinicA);
    as('owner');
    for (const direction of ['up', 'down']) {
      expect(await moveProvider(clinicA, moveForm(id, direction)), direction).toMatchObject({
        ok: false,
      });
    }
    expect(await everythingOf(clinicA)).toEqual(rows);
  });

  it('a provider that shares a place and is first in the calendar cannot go up, whatever its sort_order says', async () => {
    // Two at place 0: by name, Ana is first; Boris, though his place is the same, is not.
    const ana = await setUpProvider(clinicA, 'Ana Probna', { sortOrder: 0 });
    const boris = await setUpProvider(clinicA, 'Boris Bliznak', { sortOrder: 0 });
    const rows = await everythingOf(clinicA);
    as('owner');
    expect(await moveProvider(clinicA, moveForm(ana, 'up'))).toEqual({
      ok: false,
      error: { code: 'already_first' },
    });
    expect(await moveProvider(clinicA, moveForm(boris, 'down'))).toEqual({
      ok: false,
      error: { code: 'already_last' },
    });
    expect(await everythingOf(clinicA)).toEqual(rows);
    expect(await moveProvider(clinicA, moveForm(boris, 'up'))).toMatchObject({ ok: true });
    expect(await providersOf(clinicA)).toMatchObject([
      { name: 'Boris Bliznak', sort_order: 0 },
      { name: 'Ana Probna', sort_order: 1 },
    ]);
  });

  it("an unknown id and clinic B's provider by its id, sent in clinic A, are not_found: nothing written in either clinic, no audit row", async () => {
    await setUpOrder(clinicA, ['Ana Probna', 'Vera Vzorec']);
    const idsB = await setUpOrder(clinicB, ['Boris Bliznak', 'Zora Zdravkova']);
    const rowsA = await everythingOf(clinicA);
    const rowsB = await everythingOf(clinicB);
    as('owner', clinicA);
    for (const id of [newId(), idsB.get('Zora Zdravkova')!]) {
      for (const direction of ['up', 'down']) {
        expect(await moveProvider(clinicA, moveForm(id, direction)), direction).toEqual({
          ok: false,
          error: { code: 'not_found' },
        });
      }
    }
    expect(await everythingOf(clinicA)).toEqual(rowsA);
    expect(await everythingOf(clinicB)).toEqual(rowsB);
    expect(await providerAudit(clinicA)).toEqual([]);
    expect(await providerAudit(clinicB)).toEqual([]);
  });

  it('the module under Row-Level Security alone: another clinic sees no provider of this one, so a move is not_found there', async () => {
    const ids = await setUpOrder(clinicA, ['Ana Probna', 'Vera Vzorec']);
    const rows = await everythingOf(clinicA);
    const moved = await withTenant(clinicB, (tx) =>
      scheduling.moveProvider(
        tx,
        { providerId: ids.get('Vera Vzorec')!, direction: 'up' },
        new Date(),
      ),
    );
    expect(moved).toEqual({ ok: false, code: 'not_found' });
    expect(await everythingOf(clinicA)).toEqual(rows);
  });

  it('a direction the form should not send is invalid_input: nothing written', async () => {
    const ids = await setUpOrder(clinicA, ['Ana Probna', 'Vera Vzorec']);
    const rows = await everythingOf(clinicA);
    as('owner');
    for (const direction of ['sideways', '', 'UP']) {
      expect(
        await moveProvider(clinicA, moveForm(ids.get('Vera Vzorec')!, direction)),
      ).toMatchObject({
        ok: false,
        error: { code: 'invalid_input' },
      });
    }
    expect(await everythingOf(clinicA)).toEqual(rows);
    expect(await providerAudit(clinicA)).toEqual([]);
  });
});

describe('moves at once (acceptance 3)', () => {
  /** After any run: the places are exactly 0 ... n-1, each once. */
  async function expectPlaces(clinicId: string, count: number): Promise<void> {
    const places = (await providersOf(clinicId)).map((row) => row.sort_order);
    expect([...places].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));
  }

  it('two moves of different providers at once: both land, each provider in exactly one place', async () => {
    const ids = await setUpOrder(clinicA, ['Ana', 'Boris', 'Cveta', 'Dime']);
    as('owner');
    const answers = await Promise.all([
      moveProvider(clinicA, moveForm(ids.get('Boris')!, 'up')),
      moveProvider(clinicA, moveForm(ids.get('Dime')!, 'up')),
    ]);
    expect(answers.map((answer) => answer.ok)).toEqual([true, true]);
    // Either order of the two gives the same result: they do not touch each other's neighbours.
    expect(await orderOf(clinicA)).toEqual(['Boris', 'Ana', 'Dime', 'Cveta']);
    await expectPlaces(clinicA, 4);
    expect((await providerAudit(clinicA)).map((row) => row.action)).toEqual([
      'provider.moved',
      'provider.moved',
    ]);
  });

  it('two moves of the same provider at once: the second reads what the first left, so it goes two places, not one twice over', async () => {
    const ids = await setUpOrder(clinicA, ['Ana', 'Boris', 'Cveta', 'Dime']);
    as('owner');
    const answers = await Promise.all([
      moveProvider(clinicA, moveForm(ids.get('Dime')!, 'up')),
      moveProvider(clinicA, moveForm(ids.get('Dime')!, 'up')),
    ]);
    expect(answers.map((answer) => answer.ok)).toEqual([true, true]);
    expect(await orderOf(clinicA)).toEqual(['Ana', 'Dime', 'Boris', 'Cveta']);
    await expectPlaces(clinicA, 4);
  });

  it('a move up and a move down of the same provider at once: it ends where it began, the places 0 ... n-1', async () => {
    const ids = await setUpOrder(clinicA, ['Ana', 'Boris', 'Cveta']);
    as('owner');
    const answers = await Promise.all([
      moveProvider(clinicA, moveForm(ids.get('Boris')!, 'up')),
      moveProvider(clinicA, moveForm(ids.get('Boris')!, 'down')),
    ]);
    // Up first, then Down; or Down first, then Up: both are two steps that undo each other.
    expect(answers.map((answer) => answer.ok)).toEqual([true, true]);
    expect(await orderOf(clinicA)).toEqual(['Ana', 'Boris', 'Cveta']);
    await expectPlaces(clinicA, 3);
  });

  it('many moves at once, of neighbours too, over providers that share places: every provider in exactly one place, 0 ... n-1 each once; one audit row for each move that went through', async () => {
    const ids = new Map<string, string>();
    // Two pairs that share a place, as two adds at once leave them.
    for (const [name, place] of [
      ['Ana', 0],
      ['Boris', 0],
      ['Cveta', 1],
      ['Dime', 1],
      ['Elena', 2],
      ['Filip', 5],
    ] as const) {
      ids.set(name, await setUpProvider(clinicA, name, { sortOrder: place }));
    }
    as('owner');
    const moves = [
      ['Ana', 'down'],
      ['Boris', 'up'],
      ['Cveta', 'down'],
      ['Dime', 'up'],
      ['Elena', 'up'],
      ['Filip', 'up'],
      ['Filip', 'up'],
      ['Ana', 'down'],
    ] as const;
    const answers = await Promise.all(
      moves.map(([name, direction]) => moveProvider(clinicA, moveForm(ids.get(name)!, direction))),
    );
    for (const answer of answers) {
      if (!answer.ok) expect(['already_first', 'already_last']).toContain(answer.error.code);
    }
    await expectPlaces(clinicA, 6);
    expect(new Set((await providersOf(clinicA)).map((row) => row.id)).size).toBe(6);
    const wentThrough = answers.filter((answer) => answer.ok).length;
    expect(wentThrough).toBeGreaterThan(0);
    expect(await providerAudit(clinicA)).toHaveLength(wentThrough);
    expect(cache.refresh).toHaveBeenCalledTimes(wentThrough);
  });

  it('a move and an add at once: both land, and a following move numbers the added provider too', async () => {
    const ids = await setUpOrder(clinicA, ['Ana', 'Boris', 'Cveta']);
    as('owner');
    const added = withTenant(clinicA, (tx) =>
      scheduling.addProvider(
        tx,
        { name: 'Dime', shortName: 'Dime', kind: 'dentist', chairLabel: 'Chair 1', colorHue: 10 },
        new Date(),
      ),
    );
    const [answer] = await Promise.all([
      moveProvider(clinicA, moveForm(ids.get('Cveta')!, 'up')),
      added,
    ]);
    expect(answer).toMatchObject({ ok: true });
    expect(await providersOf(clinicA)).toHaveLength(4);
    expect(await moveProvider(clinicA, moveForm(ids.get('Ana')!, 'down'))).toMatchObject({
      ok: true,
    });
    await expectPlaces(clinicA, 4);
  });

  it('a move waits for the providers locked by a transaction that has not finished, then reads what it left', async () => {
    const ids = await setUpOrder(clinicA, ['Ana', 'Boris', 'Cveta']);
    as('owner');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    // Another move's work, held open: it has locked every provider and swapped Ana with Boris.
    const first = withTenant(clinicA, async (tx) => {
      const result = await scheduling.moveProvider(
        tx,
        { providerId: ids.get('Boris')!, direction: 'up' },
        new Date(),
      );
      locked();
      await held;
      return result;
    });
    await lockTaken;
    let finished = false;
    const second = moveProvider(clinicA, moveForm(ids.get('Cveta')!, 'up')).then((answer) => {
      finished = true;
      return answer;
    });
    // Not finished while the first holds its locks (a moment is enough to see it wait).
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(finished).toBe(false);
    release();
    expect(await first).toEqual({ ok: true });
    expect(await second).toMatchObject({ ok: true });
    // The second read the first's order (Boris, Ana, Cveta) and moved Cveta above Ana.
    expect(await orderOf(clinicA)).toEqual(['Boris', 'Cveta', 'Ana']);
    await expectPlaces(clinicA, 3);
  });
});

describe('only settings.manage, and only its own clinic (acceptance 6)', () => {
  it.each(['dentist', 'hygienist', 'front_desk'] as const)(
    'as a %s: forbidden; the rows and the audit log as they were',
    async (role) => {
      const ids = await setUpOrder(clinicA, ['Ana Probna', 'Vera Vzorec']);
      const rows = await everythingOf(clinicA);
      as(role);
      expect(await moveProvider(clinicA, moveForm(ids.get('Vera Vzorec')!, 'up'))).toEqual({
        ok: false,
        error: { code: 'forbidden' },
      });
      expect(await everythingOf(clinicA)).toEqual(rows);
      expect(await providerAudit(clinicA)).toEqual([]);
      expect(cache.refresh).not.toHaveBeenCalled();
    },
  );

  it("an owner of clinic A only, sending clinic B's id as the clinic: refused, nothing written in B", async () => {
    const idsB = await setUpOrder(clinicB, ['Boris Bliznak', 'Zora Zdravkova']);
    const rowsB = await everythingOf(clinicB);
    const onlyA = await member('owner', [clinicA]);
    request.cookie = onlyA.cookie;
    request.clinic = clinicA;
    const answer = await moveProvider(clinicB, moveForm(idsB.get('Zora Zdravkova')!, 'up'));
    expect(answer.ok).toBe(false);
    expect(await everythingOf(clinicB)).toEqual(rowsB);
    expect(await providerAudit(clinicB)).toEqual([]);
  });
});

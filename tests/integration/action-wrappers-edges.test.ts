import { sql } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import { closeDb } from '@/db/client';
import type { TenantTransaction } from '@/db/tenant';
import { systemClock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import {
  can,
  createStaffUser,
  PERMISSIONS,
  ROLES,
  type ExtraPermission,
  type Role,
} from '@/modules/auth';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';

// Added by the tester (E00-T03): edge cases of staffAction and staffRead that the task's criteria
// and D-069, D-072 promise, beyond action-wrappers.test.ts. Real sessions from the auth library's
// handler; only next/headers is replaced. Each call runs as its own request (a store of its own),
// so calls can run at the same time as different people. Every value is synthetic.

const PASSWORD = 'MARKER-pw-6a2d-correct';

// What each request carries: the session cookie, and the clinic picked earlier (D-062).
const requests = vi.hoisted(() => {
  const { AsyncLocalStorage } = process.getBuiltinModule('node:async_hooks');
  return new AsyncLocalStorage<{ cookie: string; clinic: string | undefined }>();
});
vi.mock('next/headers', () => ({
  headers: () => {
    const cookie = requests.getStore()?.cookie;
    return Promise.resolve(new Headers(cookie ? { cookie } : {}));
  },
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const clinic = requests.getStore()?.clinic;
        return name === 'chairside.clinic' && clinic ? { name, value: clinic } : undefined;
      },
    }),
}));

interface Person {
  id: string;
  cookie: string;
}

/** A member of the permission matrix: one role, with or without both extra permissions. */
interface Member {
  who: string;
  person: Person;
  role: Role;
  extras: ExtraPermission[];
}

const admin = migratorPool();
let clinicA: string;
let clinicB: string;
let clinicC: string; // the permission matrix
let twoClinics: Person; // front desk in A and B
let onlyA: Person; // front desk in A only
let onlyB: Person; // front desk in B only
const members: Member[] = [];

let nextAddress = 1;
const freshAddress = () => `10.32.0.${nextAddress++}`;

async function signedIn(
  memberships: { clinicId: string; role?: Role; extras?: ExtraPermission[] }[],
): Promise<Person> {
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Test Staff', password: PASSWORD });
  for (const { clinicId, role, extras } of memberships) {
    await insertMembership(admin, {
      clinicId,
      userId: id,
      role: role ?? 'front_desk',
      extraPermissions: extras ?? [],
    });
  }
  return { id, cookie: await signInCookie(email, PASSWORD, freshAddress()) };
}

beforeAll(async () => {
  [clinicA, clinicB, clinicC] = await Promise.all([
    insertClinic(admin),
    insertClinic(admin),
    insertClinic(admin),
  ]);
  twoClinics = await signedIn([{ clinicId: clinicA }, { clinicId: clinicB }]);
  onlyA = await signedIn([{ clinicId: clinicA }]);
  onlyB = await signedIn([{ clinicId: clinicB }]);
  const both: ExtraPermission[] = ['import', 'export'];
  for (const role of ROLES) {
    members.push({
      who: role,
      role,
      extras: [],
      person: await signedIn([{ clinicId: clinicC, role }]),
    });
  }
  for (const role of ['front_desk', 'dentist'] as const) {
    const person = await signedIn([{ clinicId: clinicC, role, extras: both }]);
    members.push({ who: `${role} with import and export`, role, extras: both, person });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

/** Runs `call` as one request from this person, with this clinic picked (or none). */
function as<T>(person: Person, picked: string | undefined, call: () => Promise<T>): Promise<T> {
  return requests.run({ cookie: person.cookie, clinic: picked }, call);
}

// ---- Actions made for the tests ----

let handlerRuns = 0;

/** The change the test actions make: a mark on their clinic's row, which a test looks for. */
async function writeMark(tx: TenantTransaction, markId: string): Promise<void> {
  handlerRuns += 1;
  await tx.execute(sql`
    update clinics set settings = jsonb_build_object('mark', ${markId}::text)
     where id = current_clinic_id()`);
}

const markInput = z.object({ markId: z.uuid() });
const markAudit = {
  action: 'test.marked',
  entityType: 'test_mark',
  entityId: ({ input }: { input: { markId: string } }) => input.markId,
};
const viewAudit = { ...markAudit, action: 'test.viewed' };

const mark = staffAction(
  { permission: 'patients.manage', input: markInput, audit: markAudit },
  async ({ input, tx }) => {
    await writeMark(tx, input.markId);
    return input.markId;
  },
);
const markAsOwner = staffAction(
  { permission: 'settings.manage', input: markInput, audit: markAudit },
  async ({ input, tx }) => {
    await writeMark(tx, input.markId);
    return input.markId;
  },
);

// ---- What was kept ----

/** Where this mark was kept: the clinics whose row carries it, and the clinics of its audit rows. */
async function kept(markId: string) {
  const marked = await admin.query<{ id: string }>(
    `select id from clinics where settings->>'mark' = $1`,
    [markId],
  );
  const audit = await admin.query<{ clinic_id: string }>(
    'select clinic_id from audit_log where entity_id = $1',
    [markId],
  );
  return {
    marked: marked.rows.map((row) => row.id),
    audit: audit.rows.map((row) => row.clinic_id),
  };
}

const nothingKept = { marked: [], audit: [] };
const clinicChanged = { ok: false, error: { code: 'clinic_changed' } };
const forbidden = { ok: false, error: { code: 'forbidden' } };
const internal = { ok: false, error: { code: 'internal' } };

// ---- The tests ----

describe('which clinic, and who may (D-069)', () => {
  it('answers for the first step that fails: the clinic, then the permission, then the input', async () => {
    const markId = newId();
    const notAnId = { markId: 'not-a-uuid' } as never;
    const before = handlerRuns;

    // Front desk may not manage settings, and another tab picked B since the page was shown for A.
    expect(await as(twoClinics, clinicB, () => markAsOwner(clinicA, { markId }))).toEqual(
      clinicChanged,
    );
    expect(await as(twoClinics, clinicB, () => markAsOwner(clinicA, notAnId))).toEqual(
      clinicChanged,
    );
    // With the clinic right, the permission answers before the input is read.
    expect(await as(twoClinics, clinicB, () => markAsOwner(clinicB, notAnId))).toEqual(forbidden);
    expect(await as(twoClinics, clinicB, () => mark(clinicB, notAnId))).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });

    expect(handlerRuns).toBe(before);
    expect(await kept(markId)).toEqual(nothingKept);
  });

  it('lets neither the id nor the cookie into a clinic the person does not belong to', async () => {
    // A member of A only, whose request names B in the cookie and B's id in the call: memberships
    // decide, so the request resolves to A, and B's id does not match it.
    const markId = newId();
    expect(await as(onlyA, clinicB, () => mark(clinicB, { markId }))).toEqual(clinicChanged);
    expect(await kept(markId)).toEqual(nothingKept);

    // The id of their own clinic runs there, whatever the cookie says.
    const own = newId();
    expect(await as(onlyA, clinicB, () => mark(clinicA, { markId: own }))).toEqual({
      ok: true,
      value: own,
    });
    expect(await kept(own)).toEqual({ marked: [clinicA], audit: [clinicA] });
  });

  it('refuses the id inside a list, and a form that was not bound to the clinic id', async () => {
    const markId = newId();
    const form = new FormData();
    form.append('markId', markId);
    const unbound = mark as unknown as (input: FormData) => Promise<unknown>;

    expect(await as(twoClinics, clinicA, () => mark([clinicA] as never, { markId }))).toEqual(
      clinicChanged,
    );
    expect(await as(twoClinics, clinicA, () => unbound(form))).toEqual(clinicChanged);
    expect(await kept(markId)).toEqual(nothingKept);
  });
});

describe('a staff handler that calls redirect() or notFound() (D-072)', () => {
  it('is rolled back and answered internal, so a change is never lost on the way elsewhere', async () => {
    const leaves: [string, () => void][] = [
      ['redirect', () => redirect('/elsewhere')],
      ['notFound', () => notFound()],
    ];
    for (const [name, leave] of leaves) {
      const markThenLeave = staffAction(
        { permission: 'patients.manage', input: markInput, audit: markAudit },
        async ({ input, tx }) => {
          await writeMark(tx, input.markId);
          leave();
          return input.markId;
        },
      );
      const markId = newId();
      const logged = vi.spyOn(logger, 'error');

      // A redirect that escaped would reject here; the wrapper answers instead.
      expect(await as(onlyA, clinicA, () => markThenLeave(clinicA, { markId })), name).toEqual(
        internal,
      );

      expect(await kept(markId), name).toEqual(nothingKept);
      expect(logged, name).toHaveBeenCalledTimes(1);
      logged.mockRestore();
    }
  });
});

describe('every role and every permission, through the wrapper', () => {
  it('allows and refuses exactly as can() does, and runs no handler it refuses', async () => {
    const answers = new Map<string, boolean>();
    for (const permission of PERMISSIONS) {
      const act = staffAction(
        { permission, input: markInput, audit: markAudit },
        async ({ input }) => {
          handlerRuns += 1;
          return input.markId;
        },
      );
      for (const { who, person, role, extras } of members) {
        // Memberships are not linked to providers before E01-T01 (D-072).
        const expected = can(role, { extraPermissions: extras, providerKind: null }, permission);
        const before = handlerRuns;

        const result = await as(person, clinicC, () => act(clinicC, { markId: newId() }));

        expect(result.ok, `${who} · ${permission}`).toBe(expected);
        if (!expected) {
          expect(result, `${who} · ${permission}`).toEqual(forbidden);
          expect(handlerRuns, `${who} · ${permission}: handler`).toBe(before);
        }
        answers.set(`${who} · ${permission}`, result.ok);
      }
    }
    // Spot checks against scope-v1.md, so the test does not only repeat can().
    expect(answers.get('owner · settings.manage')).toBe(true);
    expect(answers.get('front_desk · settings.manage')).toBe(false);
    expect(answers.get('hygienist · aftercare.approve')).toBe(false);
    expect(answers.get('dentist · aftercare.approve')).toBe(true);
    expect(answers.get('front_desk · import.run')).toBe(false);
    expect(answers.get('front_desk with import and export · import.run')).toBe(true);
    expect(answers.get('front_desk with import and export · export.run')).toBe(true);
    expect(answers.get('dentist with import and export · import.run')).toBe(false);
    expect(answers.get('dentist with import and export · export.run')).toBe(false);
    expect(answers.size).toBe(PERMISSIONS.length * members.length);
  });
});

describe('actions at the same time', () => {
  it('runs a double submit twice: each run is its own transaction with its own audit row', async () => {
    const markId = newId();

    const [first, second] = await Promise.all([
      as(onlyA, clinicA, () => mark(clinicA, { markId })),
      as(onlyA, clinicA, () => mark(clinicA, { markId })),
    ]);

    expect(first).toEqual({ ok: true, value: markId });
    expect(second).toEqual({ ok: true, value: markId });
    // The wrapper does not make a repeated action harmless: a handler that must not run twice
    // checks for itself.
    expect(await kept(markId)).toEqual({ marked: [clinicA], audit: [clinicA, clinicA] });
  });

  it('keeps two people in two clinics apart when their actions run at the same time', async () => {
    const whoAndWhere = staffAction(
      { permission: 'patients.manage', input: markInput, audit: markAudit },
      async ({ input, staff }) => ({
        markId: input.markId,
        userId: staff.user.id,
        clinicId: staff.clinic.clinicId,
      }),
    );
    const calls = Array.from({ length: 12 }, (_, i) => {
      const [person, clinicId] = i % 2 === 0 ? [onlyA, clinicA] : [onlyB, clinicB];
      const markId = newId();
      return {
        person,
        clinicId,
        markId,
        result: as(person, clinicId, () => whoAndWhere(clinicId, { markId })),
      };
    });

    for (const { person, clinicId, markId, result } of calls) {
      expect(await result).toEqual({ ok: true, value: { markId, userId: person.id, clinicId } });
      const { rows } = await admin.query(
        'select clinic_id, actor_id from audit_log where entity_id = $1',
        [markId],
      );
      expect(rows).toEqual([{ clinic_id: clinicId, actor_id: person.id }]);
    }
  });
});

describe('a read that declares a record view', () => {
  it('writes no audit row when its handler refuses, or when the reader may not read', async () => {
    const viewMissing = staffRead(
      { permission: 'patients.manage', input: markInput, audit: viewAudit },
      async () => refuse('not_found'),
    );
    const viewAsOwner = staffRead(
      { permission: 'settings.manage', input: markInput, audit: viewAudit },
      async ({ input }) => input.markId,
    );
    const [asAction, inPage, notAllowed] = [newId(), newId(), newId()];

    expect(await as(onlyA, clinicA, () => viewMissing(clinicA, { markId: asAction }))).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await as(onlyA, clinicA, () => viewMissing.forPage({ markId: inPage }))).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await as(onlyA, clinicA, () => viewAsOwner.forPage({ markId: notAllowed }))).toEqual(
      forbidden,
    );

    for (const markId of [asAction, inPage, notAllowed]) {
      expect((await kept(markId)).audit).toEqual([]);
    }
  });
});

describe("the action's now", () => {
  it('is stored exactly, also on daylight-saving nights and at midnight in the clinic', async () => {
    const stamp = staffAction(
      { permission: 'patients.manage', input: markInput, audit: markAudit },
      async ({ now }) => now.toISOString(),
    );
    // 00:30 and 01:30 UTC on 25 October 2026 are both 02:30 in Skopje (the clocks go back at
    // 03:00); 01:00 UTC on 29 March 2026 is when they go forward; 23:00 UTC on 31 December is
    // midnight there. Only the wrapper's clock is set: the session check reads the real time.
    const moments = [
      '2026-10-25T00:30:00.123Z',
      '2026-10-25T01:30:00.123Z',
      '2026-03-29T00:59:59.999Z',
      '2026-03-29T01:00:00.000Z',
      '2026-12-31T23:00:00.000Z',
    ];
    for (const moment of moments) {
      const clock = vi.spyOn(systemClock, 'now').mockReturnValue(new Date(moment));
      const markId = newId();

      expect(await as(onlyA, clinicA, () => stamp(clinicA, { markId }))).toEqual({
        ok: true,
        value: moment,
      });

      clock.mockRestore();
      const { rows } = await admin.query<{ at: Date }>(
        'select at from audit_log where entity_id = $1',
        [markId],
      );
      expect(rows.map((row) => row.at.toISOString())).toEqual([moment]);
    }
  });
});

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import { closeDb } from '@/db/client';
import type { TenantTransaction } from '@/db/tenant';
import { newId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { createStaffUser } from '@/modules/auth';
import {
  captureOutput,
  insertClinic,
  insertMembership,
  migratorPool,
  redirectOf,
  signInCookie,
  testEmail,
  withoutGrant,
} from './fixtures';

// The staff action wrappers (E00-T03): staffAction and staffRead, step by step, through actions
// made for these tests. The requests are real sessions from the auth library's handler; only
// next/headers is replaced, as there is no running Next.js. Every value is synthetic; a MARKER in
// an answer or in the output means a leak.

const MARKER = 'MARKER-e19b';
const PASSWORD = 'MARKER-pw-41c7-correct';

// What the request carries: the session cookie, and the clinic picked earlier (D-062).
const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'chairside.clinic' && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));

interface Person {
  id: string;
  cookie: string;
}

const admin = migratorPool();
let clinicA: string;
let clinicB: string;
let frontDesk: Person; // front desk in A and B: has patients.manage, not settings.manage
let switcher: Person; // front desk in A and B; one test disables A

let nextAddress = 1;
const freshAddress = () => `10.30.0.${nextAddress++}`;

async function staffIn(...clinics: string[]): Promise<Person> {
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Test Staff', password: PASSWORD });
  for (const clinicId of clinics) {
    await insertMembership(admin, { clinicId, userId: id, role: 'front_desk' });
  }
  return { id, cookie: await signInCookie(email, PASSWORD, freshAddress()) };
}

beforeAll(async () => {
  [clinicA, clinicB] = await Promise.all([insertClinic(admin), insertClinic(admin)]);
  frontDesk = await staffIn(clinicA, clinicB);
  switcher = await staffIn(clinicA, clinicB);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

/** The next request comes from this person (null: no session), with this clinic picked. */
function requestFrom(person: Person | null, picked?: string): void {
  request.cookie = person?.cookie ?? '';
  request.clinic = picked;
}

// ---- Actions made for the tests ----

let handlerRuns = 0;
let handlerNow: Date | undefined;

/** The change every test action makes: a mark on its clinic's row, which the test looks for. */
async function writeMark(tx: TenantTransaction, markId: string, now: Date): Promise<void> {
  handlerRuns += 1;
  handlerNow = now;
  await tx.execute(sql`
    update clinics set settings = jsonb_build_object('mark', ${markId}::text), updated_at = ${now}
     where id = current_clinic_id()`);
}

const markInput = z.object({ markId: z.uuid() });
type MarkInput = z.output<typeof markInput>;
const markAudit = {
  action: 'test.marked',
  entityType: 'test_mark',
  entityId: ({ input }: { input: MarkInput }) => input.markId,
};
const markHandler = async ({
  input,
  tx,
  now,
}: {
  input: MarkInput;
  tx: TenantTransaction;
  now: Date;
}) => {
  await writeMark(tx, input.markId, now);
  return { markId: input.markId };
};

const mark = staffAction(
  { permission: 'patients.manage', input: markInput, audit: markAudit },
  markHandler,
);
const markAsOwner = staffAction(
  { permission: 'settings.manage', input: markInput, audit: markAudit },
  markHandler,
);
const markByEveryMember = staffAction(
  { permission: 'every_member', input: markInput, audit: markAudit },
  markHandler,
);
const markThenThrow = staffAction(
  { permission: 'patients.manage', input: markInput, audit: markAudit },
  async ({ input, tx, now }) => {
    await writeMark(tx, input.markId, now);
    throw new Error('the handler failed after writing');
  },
);
const markThenFailQuery = staffAction(
  { permission: 'patients.manage', input: markInput, audit: markAudit },
  async ({ input, tx, now }) => {
    await writeMark(tx, input.markId, now);
    // A check violation; the marker is one of the values the query is sent.
    await tx.execute(sql`update clinics set name = ${MARKER}, currency = ${MARKER}
                          where id = current_clinic_id()`);
    return { markId: input.markId };
  },
);
const markThenRefuse = staffAction(
  { permission: 'patients.manage', input: markInput, audit: markAudit },
  async ({ input, tx, now }) => {
    await writeMark(tx, input.markId, now);
    return refuse('not_found');
  },
);
const markWithPersonalMetadata = staffAction(
  {
    permission: 'patients.manage',
    input: markInput,
    audit: { ...markAudit, metadata: () => ({ changes: [{ patientEmail: 'x@example.test' }] }) },
  },
  markHandler,
);
const createMark = staffAction(
  {
    permission: 'patients.manage',
    input: z.object({}),
    audit: { action: 'test.created', entityType: 'test_mark', entityId: { result: 'id' } },
  },
  async ({ tx, now }) => {
    const id = newId();
    await writeMark(tx, id, now);
    return { id, label: 'created' };
  },
);

/** A read of the clinic's mark: every member may. */
const readMark = staffRead(
  { permission: 'every_member', input: z.object({}) },
  async ({ tx, staff }) => {
    handlerRuns += 1;
    const { rows } = await tx.execute(
      sql`select settings->>'mark' as mark from clinics where id = current_clinic_id()`,
    );
    return { clinicId: staff.clinic.clinicId, mark: (rows[0]?.mark as string | null) ?? null };
  },
);
/** A read that shows a record: it declares the view, so each view is audited. */
const viewRecord = staffRead(
  {
    permission: 'patients.manage',
    input: markInput,
    audit: {
      action: 'test.viewed',
      entityType: 'test_mark',
      entityId: ({ input }) => input.markId,
    },
  },
  async ({ input }) => ({ markId: input.markId, shown: true }),
);
const readAsOwner = staffRead({ permission: 'settings.manage', input: z.object({}) }, async () => {
  handlerRuns += 1;
  return 'owner data';
});
const readMissing = staffRead({ permission: 'every_member', input: markInput }, async () =>
  refuse('not_found'),
);

// ---- What was kept ----

/** Where this mark was kept: the clinics whose row carries it, and its audit rows. */
async function kept(markId: string) {
  const marked = await admin.query<{ id: string }>(
    `select id from clinics where settings->>'mark' = $1`,
    [markId],
  );
  const audit = await admin.query(
    `select clinic_id, at, actor_type, actor_id, action, entity_type, entity_id, metadata
       from audit_log where entity_id = $1`,
    [markId],
  );
  return { marked: marked.rows.map((row) => row.id), audit: audit.rows };
}

const nothingKept = { marked: [], audit: [] };

async function auditRowsIn(clinicId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    'select count(*)::int as n from audit_log where clinic_id = $1',
    [clinicId],
  );
  return rows[0]!.n;
}

// ---- The tests ----

describe('making a wrapper', () => {
  it('refuses an action that names no permission, has no schema, or (a change) no audit', () => {
    const run = async () => 'never runs';
    const made = [
      () => staffAction({ input: markInput, audit: markAudit } as never, run),
      () => staffAction({ permission: 'patients.manage', input: markInput } as never, run),
      () =>
        staffAction(
          { permission: 'patients.manage', input: markInput, audit: { action: 'test.x' } } as never,
          run,
        ),
      () => staffRead({ permission: undefined, input: z.object({}) } as never, run),
      () => staffRead({ permission: 'patients.edit', input: z.object({}) } as never, run),
      () => staffRead({ permission: 'every_member', input: { parse: () => 1 } } as never, run),
    ];
    for (const make of made) expect(make).toThrow(TypeError);
    expect(() => staffRead({ permission: 'every_member', input: z.object({}) }, run)).not.toThrow();
  });

  it('lets a handler refuse only with a code of its own', () => {
    expect(() => refuse('forbidden' as never)).toThrow(TypeError);
    expect(() => refuse('Not Found' as never)).toThrow(TypeError);
    expect(() => refuse('not_found')).not.toThrow();
  });

  it('makes the same mistakes type errors, so they fail `pnpm typecheck` first', () => {
    // Each @ts-expect-error fails the type check if the line below it ever stops being an error.
    const run = async () => ({ id: newId(), count: 1 });
    const input = z.object({});
    const made = [
      () =>
        // @ts-expect-error the permission is required: there is no default
        staffAction({ input, audit: { ...markAudit, entityId: { result: 'id' } } }, run),
      () =>
        staffRead(
          // @ts-expect-error not a permission from the table
          { permission: 'patients.edit', input },
          run,
        ),
      () =>
        staffAction(
          {
            permission: 'patients.manage',
            input,
            audit: {
              action: 'test.created',
              entityType: 'test_mark',
              // @ts-expect-error `count` holds a number, not an id
              entityId: { result: 'count' },
            },
          },
          run,
        ),
      // @ts-expect-error the wrappers' own codes are not a handler's to use
      () => refuse('forbidden'),
    ];
    expect(made).toHaveLength(4);
  });
});

describe('step 1: who', () => {
  it('sends a request without a session to the login page, running nothing', async () => {
    requestFrom(null, clinicA);
    const before = handlerRuns;
    expect(await redirectOf(mark(clinicA, { markId: newId() }))).toBe('/login');
    expect(await redirectOf(readMark.forPage({}))).toBe('/login');
    expect(handlerRuns).toBe(before);
  });

  it('sends a person with several clinics and none picked to the clinic picker', async () => {
    requestFrom(frontDesk, undefined);
    const markId = newId();
    expect(await redirectOf(mark(clinicA, { markId }))).toBe('/choose-clinic');
    expect(await kept(markId)).toEqual(nothingKept);
  });
});

describe('step 2: which clinic (D-069)', () => {
  it('refuses an action for clinic A after another tab picked clinic B, writing in neither', async () => {
    requestFrom(frontDesk, clinicB);
    const markId = newId();
    const before = handlerRuns;

    expect(await mark(clinicA, { markId })).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });

    expect(handlerRuns).toBe(before);
    expect(await kept(markId)).toEqual(nothingKept);
  });

  it("refuses it when the person's membership in clinic A was disabled since", async () => {
    requestFrom(switcher, clinicA);
    const markId = newId();
    await admin.query(
      `update memberships set status = 'disabled' where user_id = $1 and clinic_id = $2`,
      [switcher.id, clinicA],
    );
    try {
      // The request now resolves to B, the only clinic left.
      expect(await mark(clinicA, { markId })).toEqual({
        ok: false,
        error: { code: 'clinic_changed' },
      });
    } finally {
      await admin.query(
        `update memberships set status = 'active' where user_id = $1 and clinic_id = $2`,
        [switcher.id, clinicA],
      );
    }
    expect(await kept(markId)).toEqual(nothingKept);
  });

  it('refuses a call without the clinic id, or with anything but that exact id', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();
    for (const clinicId of [
      undefined,
      null,
      '',
      clinicA.toUpperCase(),
      { toString: () => clinicA },
    ]) {
      expect(await mark(clinicId as never, { markId }), String(clinicId)).toEqual({
        ok: false,
        error: { code: 'clinic_changed' },
      });
    }
    expect(await kept(markId)).toEqual(nothingKept);
  });

  it('runs the action when the id is the clinic the request resolves to', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();
    expect(await mark(clinicA, { markId })).toEqual({ ok: true, value: { markId } });
    expect((await kept(markId)).marked).toEqual([clinicA]);
  });
});

describe('step 3: allowed', () => {
  it('answers forbidden without the permission: the handler does not run, nothing is written', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();
    const before = handlerRuns;

    expect(await markAsOwner(clinicA, { markId })).toEqual({
      ok: false,
      error: { code: 'forbidden' },
    });

    expect(handlerRuns).toBe(before);
    expect(await kept(markId)).toEqual(nothingKept);
  });

  it('runs an action that every active member may do, when it says so', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();
    expect(await markByEveryMember(clinicA, { markId })).toEqual({ ok: true, value: { markId } });
  });
});

describe('step 4: valid', () => {
  it('answers invalid_input with paths and codes, before the handler, and never repeats a value', async () => {
    requestFrom(frontDesk, clinicA);
    const before = handlerRuns;
    const form = new FormData();
    form.append('markId', `${MARKER}-in-a-form`);

    for (const sent of [{ markId: MARKER, extra: MARKER }, { markId: 42 }, form, MARKER]) {
      const { output, result } = await captureOutput(() => mark(clinicA, sent as never));
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(JSON.stringify(result)).not.toContain(MARKER);
      expect(output).not.toContain(MARKER);
    }
    expect(await mark(clinicA, { markId: MARKER } as never)).toEqual({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: ['markId'], code: 'invalid_format' }] },
    });
    expect(handlerRuns).toBe(before);
  });

  it("takes a form's fields, as a form bound to the clinic id sends them", async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();
    const form = new FormData();
    form.append('markId', markId);
    expect(await mark.bind(null, clinicA)(form)).toEqual({ ok: true, value: { markId } });
  });
});

describe('steps 5 to 7: the handler and its audit row, in one transaction', () => {
  it('writes exactly one audit row with actor, action and entity, at the action’s now', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();
    // The clock, read once by the wrapper: a minute ago, with milliseconds, so nothing else matches.
    const now = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000 + 789);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);

    const result = await mark(clinicA, { markId });

    vi.useRealTimers();
    expect(result).toEqual({ ok: true, value: { markId } });
    expect(handlerNow).toEqual(now);
    expect(await kept(markId)).toEqual({
      marked: [clinicA],
      audit: [
        {
          clinic_id: clinicA,
          at: now,
          actor_type: 'user',
          actor_id: frontDesk.id,
          action: 'test.marked',
          entity_type: 'test_mark',
          entity_id: markId,
          metadata: {},
        },
      ],
    });
  });

  it("takes the entity id from the handler's result when the declaration says so", async () => {
    requestFrom(frontDesk, clinicB);
    const result = await createMark(clinicB, {});
    expect(result).toMatchObject({ ok: true, value: { label: 'created' } });
    const { id } = (result as { value: { id: string } }).value;
    expect(await kept(id)).toMatchObject({
      marked: [clinicB],
      audit: [{ clinic_id: clinicB, action: 'test.created', entity_id: id }],
    });
  });

  it('keeps nothing when the handler throws, answers internal without detail, and logs it once', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();
    const logged = vi.spyOn(logger, 'error');

    expect(await markThenThrow(clinicA, { markId })).toEqual({
      ok: false,
      error: { code: 'internal' },
    });

    expect(await kept(markId)).toEqual(nothingKept);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'the handler failed after writing' }),
        userId: frontDesk.id,
        clinicId: clinicA,
        action: 'test.marked',
      }),
      expect.any(String),
    );
  });

  it('keeps nothing when a query fails, and neither the answer nor the output holds its values', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();

    const { output, result } = await captureOutput(() => markThenFailQuery(clinicA, { markId }));

    expect(result).toEqual({ ok: false, error: { code: 'internal' } });
    expect(output).toContain('23514'); // the failure was logged, with its PostgreSQL code
    expect(output).not.toContain(MARKER);
    expect(await kept(markId)).toEqual(nothingKept);
  });

  it("answers a handler's own refusal with its code, keeping nothing", async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();
    const logged = vi.spyOn(logger, 'error');

    expect(await markThenRefuse(clinicA, { markId })).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });

    expect(await kept(markId)).toEqual(nothingKept);
    expect(logged).not.toHaveBeenCalled();
  });

  it('rolls the action back when audit.record() refuses its metadata (a personal field)', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();
    const before = handlerRuns;

    expect(await markWithPersonalMetadata(clinicA, { markId })).toEqual({
      ok: false,
      error: { code: 'internal' },
    });

    expect(handlerRuns, 'the handler ran and wrote').toBe(before + 1);
    expect(await kept(markId)).toEqual(nothingKept);
  });

  it('rolls the action back when the database refuses its audit row', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();

    const result = await withoutGrant(admin, 'insert', 'audit_log', () =>
      mark(clinicA, { markId }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'internal' } });
    expect(await kept(markId)).toEqual(nothingKept);
  });
});

describe('the read helper', () => {
  it('writes no audit row for a read', async () => {
    requestFrom(frontDesk, clinicA);
    const before = await auditRowsIn(clinicA);

    expect(await readMark(clinicA, {})).toMatchObject({ ok: true, value: { clinicId: clinicA } });
    expect(await readMark.forPage({})).toMatchObject({ ok: true, value: { clinicId: clinicA } });

    expect(await auditRowsIn(clinicA)).toBe(before);
  });

  it('writes exactly one audit row for a read that declares a record view', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();

    expect(await viewRecord(clinicA, { markId })).toEqual({
      ok: true,
      value: { markId, shown: true },
    });

    expect((await kept(markId)).audit).toMatchObject([
      { clinic_id: clinicA, actor_id: frontDesk.id, action: 'test.viewed', entity_id: markId },
    ]);
  });

  it('shows no record when its view cannot be audited', async () => {
    requestFrom(frontDesk, clinicA);
    const markId = newId();
    const result = await withoutGrant(admin, 'insert', 'audit_log', () =>
      viewRecord.forPage({ markId }),
    );
    expect(result).toEqual({ ok: false, error: { code: 'internal' } });
  });

  it('checks the clinic as an action, and renders for the resolved clinic in a page', async () => {
    requestFrom(frontDesk, clinicB); // another tab picked B
    expect(await readMark(clinicA, {})).toEqual({ ok: false, error: { code: 'clinic_changed' } });
    expect(await readMark.forPage({})).toMatchObject({ ok: true, value: { clinicId: clinicB } });
  });

  it('still checks the permission and the input in a page', async () => {
    requestFrom(frontDesk, clinicA);
    const before = handlerRuns;
    expect(await readAsOwner.forPage({})).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(await viewRecord.forPage({ markId: MARKER } as never)).toMatchObject({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: ['markId'], code: 'invalid_format' }] },
    });
    expect(handlerRuns).toBe(before);
  });

  it("answers a read's own refusal with its code", async () => {
    requestFrom(frontDesk, clinicA);
    expect(await readMissing(clinicA, { markId: newId() })).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await readMissing.forPage({ markId: newId() })).toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});

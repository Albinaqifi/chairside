import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createClinicWithOwner, runClinicCreate, type ClinicCreateInput } from '@/db/clinic-create';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { newId } from '@/lib/ids';
import { clinicsForUser, createStaffUser, getAuth } from '@/modules/auth';
import {
  appPool,
  captureOutput,
  expectPgError,
  insertClinic,
  migratorPool,
  ORIGIN,
  PG,
  testEmail,
  withoutGrant,
} from './fixtures';

// E00-T05b: `pnpm clinic:create` against the integration tests' database, as the app runs: the
// script's own function and command, which write as the app role (DATABASE_URL, vitest.config.ts),
// and the owner's setup link used through the auth library's own routes, as the page and the login
// form use them. Rows are inspected as the migration role. Emails are synthetic (example.test),
// names are role words with a marker, passwords are markers.

const admin = migratorPool();

afterAll(async () => {
  await closeDb();
  await admin.end();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = 'MARKER-pw-41c7-chosen';
const OTHER_PASSWORD = 'MARKER-pw-41c7-other';

/** A new clinic's details, with a fresh owner email: North Macedonia's settings. */
function newClinic(overrides: Partial<ClinicCreateInput> = {}): ClinicCreateInput {
  return {
    name: `Lakeside Dental ${newId().slice(-6)}`,
    ownerEmail: testEmail(),
    ownerName: 'Owner',
    timeZone: 'Europe/Skopje',
    country: 'MK',
    currency: 'MKD',
    locale: 'en',
    ...overrides,
  };
}

/** The same clinic as a command line. */
function commandLine(clinic: ClinicCreateInput): string[] {
  return [
    '--name',
    clinic.name,
    '--owner-email',
    clinic.ownerEmail,
    '--owner-name',
    clinic.ownerName,
  ];
}

/** Makes the clinic now; fails the test when the run refused. */
async function made(clinic: ClinicCreateInput, now = new Date()) {
  const result = await createClinicWithOwner(clinic, now);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result;
}

/** The token a setup link carries: what follows `#`. */
const tokenOf = (link: string) => new URL(link).hash.slice(1);

/**
 * The setup link a run printed, from captureOutput()'s text, which quotes what console.log was
 * given: the link's own characters only (a token is base64url).
 */
function printedLink(output: string): string {
  const [link] = output.match(/http:\/\/localhost:3000\/login\/set-password#[\w-]+/) ?? [];
  if (!link) throw new Error('no setup link was printed');
  return link;
}

let nextAddress = 1;
/** A client address no other test uses: the auth library's rate limits count per address. */
const freshAddress = () => `10.41.0.${nextAddress++}`;

/** A request to the auth library, as the browser sends it. */
function authRequest(path: string, body?: unknown, cookie?: string): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN, 'x-forwarded-for': freshAddress() });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  return getAuth().handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** What the page sends: the new password and the link's token (the token left out when undefined). */
const setPassword = (token: string | undefined, newPassword: string) =>
  authRequest('/reset-password', token === undefined ? { newPassword } : { newPassword, token });

const signIn = (email: string, password: string) =>
  authRequest('/sign-in/email', { email, password });

/** The cookies a response sets, as the browser would send them back. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .join('; ');
}

async function userIdOf(email: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>('select id from users where email = $1', [
    email,
  ]);
  expect(rows, 'one person with this email').toHaveLength(1);
  return rows[0]!.id;
}

/** Everything the person has in the auth tables and in clinics, as it is now. */
async function personState(userId: string) {
  const query = async (sql: string) => (await admin.query(sql, [userId])).rows;
  return {
    users: await query('select * from users where id = $1'),
    accounts: await query('select * from accounts where user_id = $1 order by id'),
    sessions: await query('select * from sessions where user_id = $1 order by id'),
    verifications: await query('select * from verifications where value = $1::text order by id'),
    memberships: await query('select * from memberships where user_id = $1 order by id'),
  };
}

/** Rows in the tables a run writes, in all clinics. */
async function rowCounts() {
  const { rows } = await admin.query<Record<string, string>>(
    `select (select count(*) from users) as users, (select count(*) from accounts) as accounts,
            (select count(*) from verifications) as verifications,
            (select count(*) from clinics) as clinics, (select count(*) from memberships) as memberships,
            (select count(*) from audit_log) as audit_log`,
  );
  return rows[0];
}

/** The library's own refusal of a token, as `/reset-password` answers it. */
async function answerOf(response: Response) {
  return { status: response.status, body: (await response.json()) as unknown };
}
const INVALID_TOKEN = { status: 400, body: { code: 'INVALID_TOKEN', message: 'Invalid token' } };

describe('clinic:create makes a clinic and its owner (acceptance 1)', () => {
  it('nobody can sign in as the owner until they choose a password through the link; then they can', async () => {
    const clinic = newClinic({ name: '  Lakeside Dental  ' });
    const now = new Date();
    const { clinicId, link } = await made(clinic, now);
    const userId = await userIdOf(clinic.ownerEmail);

    const { rows: clinics } = await admin.query(
      `select name, timezone, default_country, currency, locale, status, created_at, updated_at
         from clinics where id = $1`,
      [clinicId],
    );
    expect(clinics).toEqual([
      {
        name: 'Lakeside Dental',
        timezone: 'Europe/Skopje',
        default_country: 'MK',
        currency: 'MKD',
        locale: 'en',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ]);
    expect(await clinicsForUser(userId)).toEqual([
      expect.objectContaining({ clinicId, clinicName: 'Lakeside Dental', role: 'owner' }),
    ]);

    // No password login until the link is used: no credential account, and every try is refused.
    expect((await personState(userId)).accounts).toEqual([]);
    for (const password of [PASSWORD, OTHER_PASSWORD, '']) {
      expect((await signIn(clinic.ownerEmail, password)).status).toBe(401);
    }

    expect(link).toMatch(/^http:\/\/localhost:3000\/login\/set-password#[A-Za-z0-9_-]{43}$/);
    expect(await answerOf(await setPassword(tokenOf(link), PASSWORD))).toEqual({
      status: 200,
      body: { status: true },
    });

    const signedIn = await signIn(clinic.ownerEmail, PASSWORD);
    expect(signedIn.status).toBe(200);
    const session = (await (
      await authRequest('/get-session', undefined, cookiesOf(signedIn))
    ).json()) as { user: { id: string } };
    expect(session.user.id).toBe(userId);
    expect((await signIn(clinic.ownerEmail, OTHER_PASSWORD)).status).toBe(401);
  });
});

describe('the link works once and for 3 days (acceptance 2)', () => {
  it('a used link is refused, and changes nothing: the password chosen first stays, the session too', async () => {
    const clinic = newClinic();
    const { link } = await made(clinic);
    expect((await setPassword(tokenOf(link), PASSWORD)).status).toBe(200);
    const signedIn = await signIn(clinic.ownerEmail, PASSWORD);
    const userId = await userIdOf(clinic.ownerEmail);
    const before = await personState(userId);

    expect(await answerOf(await setPassword(tokenOf(link), OTHER_PASSWORD))).toEqual(INVALID_TOKEN);

    expect(await personState(userId)).toEqual(before);
    expect((await signIn(clinic.ownerEmail, OTHER_PASSWORD)).status).toBe(401);
    const session = await authRequest('/get-session', undefined, cookiesOf(signedIn));
    expect(await session.json(), 'the session it ended nothing of').not.toBeNull();
  });

  it('works until 3 days have passed, and not after: an expired link sets no password', async () => {
    const almost = newClinic();
    const { link: almostLink } = await made(almost, new Date(Date.now() - 3 * DAY_MS + 60_000));
    expect((await setPassword(tokenOf(almostLink), PASSWORD)).status).toBe(200);

    const expired = newClinic();
    const { link } = await made(expired, new Date(Date.now() - 3 * DAY_MS - 60_000));
    const userId = await userIdOf(expired.ownerEmail);
    expect(await answerOf(await setPassword(tokenOf(link), PASSWORD))).toEqual(INVALID_TOKEN);
    const after = await personState(userId);
    expect(after.accounts, 'no password login was made').toEqual([]);
    expect((await signIn(expired.ownerEmail, PASSWORD)).status).toBe(401);
  });

  it("stores the link's end as 3 days from the run's moment", async () => {
    const clinic = newClinic();
    const now = new Date(Date.now() - 60_000);
    await made(clinic, now);
    const { verifications } = await personState(await userIdOf(clinic.ownerEmail));
    expect(verifications.map((row) => row.expires_at)).toEqual([
      new Date(now.getTime() + 3 * DAY_MS),
    ]);
  });

  it('a wrong or a missing token is refused, and changes nothing: the real link still works', async () => {
    const clinic = newClinic();
    const { link } = await made(clinic);
    const userId = await userIdOf(clinic.ownerEmail);
    const before = await personState(userId);

    const wrong = randomBytes(32).toString('base64url'); // the shape of a token, no link's
    for (const token of [wrong, `${tokenOf(link)}x`, tokenOf(link).slice(0, -1), '', undefined]) {
      expect(await answerOf(await setPassword(token, PASSWORD)), String(token)).toEqual(
        INVALID_TOKEN,
      );
    }
    expect(await personState(userId)).toEqual(before);
    expect((await setPassword(tokenOf(link), PASSWORD)).status).toBe(200);
  });

  it('answers a used, an expired, a wrong and a missing token alike', async () => {
    const used = (await made(newClinic())).link;
    expect((await setPassword(tokenOf(used), PASSWORD)).status).toBe(200);
    const expired = (await made(newClinic(), new Date(Date.now() - 4 * DAY_MS))).link;
    const answers = [
      await setPassword(tokenOf(used), PASSWORD),
      await setPassword(tokenOf(expired), PASSWORD),
      await setPassword('wrong-token', PASSWORD),
      await setPassword(undefined, PASSWORD),
    ];
    const read = await Promise.all(
      answers.map(async (answer) => ({
        ...(await answerOf(answer)),
        headers: answer.headers.get('content-type'),
      })),
    );
    expect(new Set(read.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(read[0]).toMatchObject(INVALID_TOKEN);
  });

  // E00-T05b test: a double click, or the link open in two tabs, sends it twice at once.
  it('used twice at once: one use sets its password, the other is refused as a used link', async () => {
    const clinic = newClinic();
    const { link } = await made(clinic);
    const userId = await userIdOf(clinic.ownerEmail);

    const answers = await Promise.all(
      [PASSWORD, OTHER_PASSWORD].map(async (password) => ({
        password,
        ...(await answerOf(await setPassword(tokenOf(link), password))),
      })),
    );

    const [set, ...refused] = [...answers].sort((a, b) => a.status - b.status);
    expect(set, 'one use set its password').toMatchObject({ status: 200, body: { status: true } });
    expect(refused).toEqual([expect.objectContaining(INVALID_TOKEN)]);
    const { accounts, verifications } = await personState(userId);
    expect([accounts.length, verifications.length], 'one password login, no live link').toEqual([
      1, 0,
    ]);
    expect((await signIn(clinic.ownerEmail, set!.password)).status).toBe(200);
    expect((await signIn(clinic.ownerEmail, refused[0]!.password)).status).toBe(401);
  });

  // E00-T05b test: the library checks the length before it spends the token, so a password it
  // refuses leaves the link working (the page checks the length too, before it sends).
  it('a password too short or too long changes nothing: the link still works', async () => {
    const clinic = newClinic();
    const { link } = await made(clinic);
    const userId = await userIdOf(clinic.ownerEmail);
    const before = await personState(userId);

    for (const [password, code] of [
      ['x'.repeat(7), 'PASSWORD_TOO_SHORT'],
      ['x'.repeat(129), 'PASSWORD_TOO_LONG'],
    ] as const) {
      expect(await answerOf(await setPassword(tokenOf(link), password)), code).toMatchObject({
        status: 400,
        body: { code },
      });
    }
    expect(await personState(userId)).toEqual(before);
    expect((await setPassword(tokenOf(link), PASSWORD)).status).toBe(200);
  });
});

describe('only the token’s SHA-256 hash is stored; the link reaches the terminal and nothing else (acceptance 3)', () => {
  it('the verification row holds the hash, and no table, log line or audit row holds the token', async () => {
    const clinic = newClinic();
    const { output, result } = await captureOutput(() => runClinicCreate(commandLine(clinic)));
    expect(result).toBe(0);
    const link = printedLink(output);
    const token = tokenOf(link);
    expect(token).toHaveLength(43);
    const userId = await userIdOf(clinic.ownerEmail);

    const { verifications } = await personState(userId);
    const hash = createHash('sha256').update(`reset-password:${token}`).digest('base64url');
    expect(verifications).toEqual([expect.objectContaining({ identifier: hash, value: userId })]);
    for (const table of [
      'verifications',
      'users',
      'accounts',
      'audit_log',
      'clinics',
      'memberships',
    ]) {
      const { rows } = await admin.query(`select * from ${table}`);
      expect(JSON.stringify(rows), table).not.toContain(token);
    }

    // The terminal: the token in the printed link alone, on its own line, and in no log line.
    const lines = output.split('\n').filter((line) => line.includes(token));
    expect(lines.map((line) => line.trim().replace(/^'(.*)'$/, '$1'))).toEqual([link]);
  });
});

describe("the app role's grants, migration 0004 (acceptance 4)", () => {
  it('0004 grants INSERT on clinics and on memberships, and nothing else', () => {
    const sql = readFileSync(
      new URL('../../src/db/migrations/0004_clinic_create_grants.sql', import.meta.url),
      'utf8',
    );
    const statements = sql
      .split('--> statement-breakpoint')
      .map((part) =>
        part
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('--'))
          .join(' ')
          .trim(),
      )
      .filter(Boolean);
    expect(statements).toEqual([
      'GRANT INSERT ON "clinics" TO chairside_app;',
      'GRANT INSERT ON "memberships" TO chairside_app;',
    ]);
  });

  it('the app role may now read and add clinics and memberships, change clinics only, delete neither', async () => {
    const privileges = [
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
    ];
    const { rows } = await admin.query<{ table_name: string; privilege: string }>(
      `select t.table_name, p.privilege
         from unnest($1::text[]) as p(privilege), unnest(array['clinics', 'memberships']) as t(table_name)
        where has_table_privilege('chairside_app', t.table_name, p.privilege)
        order by 1, 2`,
      [privileges],
    );
    expect(rows).toEqual([
      { table_name: 'clinics', privilege: 'INSERT' },
      { table_name: 'clinics', privilege: 'SELECT' },
      { table_name: 'clinics', privilege: 'UPDATE' },
      { table_name: 'memberships', privilege: 'INSERT' },
      { table_name: 'memberships', privilege: 'SELECT' },
    ]);
  });

  it("the policies bind the grant: a page's transaction adds no clinic, and no member to another clinic", async () => {
    const existing = await insertClinic(admin);
    const other = newId();
    const userId = (await createStaffUser({ email: testEmail(), name: 'Owner' })).id;
    const addClinic = (id: string) => sql`
      insert into clinics (id, name, timezone, locale, currency, default_country)
      values (${id}, 'Lakeside Dental', 'Europe/Skopje', 'en', 'MKD', 'MK')`;
    const addMember = (clinicId: string) => sql`
      insert into memberships (id, clinic_id, user_id, role)
      values (${newId()}, ${clinicId}, ${userId}, 'owner')`;
    // As a page or an action would: inside withTenant for a clinic that exists.
    for (const [statement, code] of [
      [addClinic(existing), PG.uniqueViolation], // its own clinic is there already
      [addClinic(other), PG.insufficientPrivilege], // any other id: the policy
      [addMember(other), PG.insufficientPrivilege],
    ] as const) {
      await withTenant(existing, async (tx) => {
        await expectPgError(tx.execute(statement), code);
      });
    }
    // With no clinic set at all.
    const app = appPool();
    try {
      await expectPgError(
        app.query(
          `insert into clinics (id, name, timezone, locale, currency, default_country)
           values ($1, 'Lakeside Dental', 'Europe/Skopje', 'en', 'MKD', 'MK')`,
          [other],
        ),
        PG.insufficientPrivilege,
      );
      await expectPgError(
        app.query(
          `insert into memberships (id, clinic_id, user_id, role) values ($1, $2, $3, 'owner')`,
          [newId(), existing, userId],
        ),
        PG.insufficientPrivilege,
      );
    } finally {
      await app.end();
    }
    const { rows } = await admin.query('select 1 from clinics where id = $1', [other]);
    expect(rows).toEqual([]);
    expect(await clinicsForUser(userId)).toEqual([]);
  });

  it.each(['clinics', 'memberships'])(
    'without INSERT on %s, a run writes no clinic and no membership: it writes as the app role',
    async (table) => {
      const clinic = newClinic();
      await withoutGrant(admin, 'insert', table, () =>
        expectPgError(createClinicWithOwner(clinic, new Date()), PG.insufficientPrivilege),
      );
      const { rows } = await admin.query('select 1 from clinics where name = $1', [clinic.name]);
      expect(rows, 'no clinic').toEqual([]);
      const userId = await userIdOf(clinic.ownerEmail);
      expect((await personState(userId)).memberships, 'no membership').toEqual([]);
      expect(await clinicsForUser(userId)).toEqual([]);
    },
  );

  it('reads no MIGRATION_DATABASE_URL: a run without it, or with one that leads nowhere, works', async () => {
    for (const value of [undefined, 'postgres://postgres:pw@db.example.invalid:5432/chairside']) {
      vi.stubEnv('MIGRATION_DATABASE_URL', value);
      try {
        const clinic = newClinic();
        const { result } = await captureOutput(() => runClinicCreate(commandLine(clinic)));
        expect(result, String(value)).toBe(0);
        expect(await clinicsForUser(await userIdOf(clinic.ownerEmail))).toHaveLength(1);
      } finally {
        vi.unstubAllEnvs();
      }
    }
  });
});

describe('run again with the same owner email (acceptance 5)', () => {
  it('makes no second person, clinic or link, writes nothing, and says so', async () => {
    const clinic = newClinic();
    expect((await captureOutput(() => runClinicCreate(commandLine(clinic)))).result).toBe(0);
    const userId = await userIdOf(clinic.ownerEmail);

    for (const again of [clinic, { ...clinic, name: 'Another Dental' }]) {
      const [before, person] = [await rowCounts(), await personState(userId)];
      const { output, result } = await captureOutput(() => runClinicCreate(commandLine(again)));
      expect(result).toBe(1);
      expect(output).toContain(
        'Nothing was written: the person with this owner email is already in a clinic.',
      );
      expect(output).not.toContain('/login/set-password#');
      expect([await rowCounts(), await personState(userId)]).toEqual([before, person]);
    }
  });

  it('makes no owner of a person who has a password and no clinic, writing nothing', async () => {
    const clinic = newClinic();
    await createStaffUser({ email: clinic.ownerEmail, name: 'Owner', password: PASSWORD });
    const before = await rowCounts();
    const { output, result } = await captureOutput(() => runClinicCreate(commandLine(clinic)));
    expect(result).toBe(1);
    expect(output).toContain('already has a password and no clinic');
    expect(await rowCounts()).toEqual(before);
  });

  it("finishes a run that broke after making the person (the clinic's insert refused)", async () => {
    const clinic = newClinic();
    const broken = await withoutGrant(admin, 'insert', 'clinics', () =>
      captureOutput(() => runClinicCreate(commandLine(clinic))),
    );
    expect(broken.result, 'the broken run ended with its error').toBeUndefined();
    expect(broken.output).not.toContain('/login/set-password#');
    const userId = await userIdOf(clinic.ownerEmail);
    const left = await personState(userId);
    expect([left.accounts, left.memberships], 'no password, no clinic').toEqual([[], []]);

    const { output, result } = await captureOutput(() => runClinicCreate(commandLine(clinic)));
    expect(result).toBe(0);
    expect(output).toContain('An earlier run had made the owner but not the clinic');
    expect(await userIdOf(clinic.ownerEmail), 'the same person').toBe(userId);
    const [owned] = await clinicsForUser(userId);
    expect(owned).toMatchObject({ clinicName: clinic.name, role: 'owner' });
    const { rows } = await admin.query('select 1 from clinics where name = $1', [clinic.name]);
    expect(rows, 'one clinic').toHaveLength(1);

    expect((await setPassword(tokenOf(printedLink(output)), PASSWORD)).status).toBe(200);
    expect((await signIn(clinic.ownerEmail, PASSWORD)).status).toBe(200);
  });
});

describe('the audit row, the logs and the terminal carry no email, name or token (acceptance 8)', () => {
  it('one clinic.created row, by the system, about the clinic, with ids only', async () => {
    const clinic = newClinic({ ownerName: 'Owner Markerline' });
    const { output, result } = await captureOutput(() => runClinicCreate(commandLine(clinic)));
    expect(result).toBe(0);
    const userId = await userIdOf(clinic.ownerEmail);
    const [membership] = (await personState(userId)).memberships as {
      id: string;
      clinic_id: string;
    }[];
    const clinicId = membership!.clinic_id;

    const { rows } = await admin.query(
      `select clinic_id, actor_type, actor_id, action, entity_type, entity_id, metadata
         from audit_log where clinic_id = $1`,
      [clinicId],
    );
    expect(rows).toEqual([
      {
        clinic_id: clinicId,
        actor_type: 'system',
        actor_id: null,
        action: 'clinic.created',
        entity_type: 'clinic',
        entity_id: clinicId,
        metadata: { ownerId: userId, membershipId: membership!.id },
      },
    ]);
    const token = tokenOf(printedLink(output));
    const written = JSON.stringify(rows);
    for (const value of [clinic.ownerEmail, 'Markerline', clinic.name, token]) {
      expect(written).not.toContain(value);
    }
    for (const value of [clinic.ownerEmail, 'Markerline']) expect(output).not.toContain(value);
  });
});

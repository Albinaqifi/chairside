import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { activeMembership, clinicsForUser, createStaffUser, resolveClinic } from '@/modules/auth';
import {
  appPool,
  expectPgError,
  insertClinic,
  insertMembership,
  migratorPool,
  PG,
  testEmail,
} from './fixtures';
import { insertProvider } from './scheduling-fixtures';

// Which clinic a signed-in user acts for, and that they only ever see that clinic's data.

const admin = migratorPool();
const appWithoutTenant = appPool();
let clinicA: string;
let clinicB: string;
let clinicC: string; // nobody here belongs to it
let inBoth: string; // owner in A, front desk with import in B
let oneDisabled: string; // dentist in A, disabled in B
let nobody: string; // no memberships

const createUser = async () =>
  (await createStaffUser({ email: testEmail(), name: 'Test Staff', password: 'MARKER-pw-1a2b3c' }))
    .id;

const byClinicId = (a: { clinic_id: string }, b: { clinic_id: string }) =>
  a.clinic_id.localeCompare(b.clinic_id);

beforeAll(async () => {
  [clinicA, clinicB, clinicC] = await Promise.all([
    insertClinic(admin),
    insertClinic(admin),
    insertClinic(admin),
  ]);
  [inBoth, oneDisabled, nobody] = await Promise.all([createUser(), createUser(), createUser()]);
  await insertMembership(admin, { clinicId: clinicA, userId: inBoth, role: 'owner' });
  await insertMembership(admin, {
    clinicId: clinicB,
    userId: inBoth,
    role: 'front_desk',
    extraPermissions: ['import'],
  });
  await insertMembership(admin, { clinicId: clinicA, userId: oneDisabled, role: 'dentist' });
  await insertMembership(admin, {
    clinicId: clinicB,
    userId: oneDisabled,
    role: 'dentist',
    status: 'disabled',
  });
});

afterAll(async () => {
  await closeDb();
  await appWithoutTenant.end();
  await admin.end();
});

describe('clinicsForUser', () => {
  it('lists the active memberships with clinic, role and extra permissions, by clinic name', async () => {
    const choices = await clinicsForUser(inBoth);
    expect(choices).toHaveLength(2);
    const names = choices.map((c) => c.clinicName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(choices.find((c) => c.clinicId === clinicA)).toMatchObject({
      role: 'owner',
      extraPermissions: [],
    });
    expect(choices.find((c) => c.clinicId === clinicB)).toMatchObject({
      role: 'front_desk',
      extraPermissions: ['import'],
    });
    const { rows } = await admin.query<{ id: string }>(
      'select id from memberships where user_id = $1',
      [inBoth],
    );
    expect(choices.map((c) => c.membershipId).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('leaves out a disabled membership', async () => {
    expect((await clinicsForUser(oneDisabled)).map((c) => c.clinicId)).toEqual([clinicA]);
  });

  it('is empty for a user without memberships', async () => {
    expect(await clinicsForUser(nobody)).toEqual([]);
  });

  it('refuses a user id that is not a UUID', async () => {
    await expect(clinicsForUser('not-a-uuid')).rejects.toThrow(TypeError);
  });

  it('is the one way the app role sees memberships without a clinic set', async () => {
    expect((await appWithoutTenant.query('select id from memberships')).rows).toEqual([]);
    const { rows } = await appWithoutTenant.query<{ clinic_id: string }>(
      'select clinic_id from clinics_for_user($1)',
      [inBoth],
    );
    expect(rows.sort(byClinicId)).toEqual(
      [{ clinic_id: clinicA }, { clinic_id: clinicB }].sort(byClinicId),
    );
  });
});

describe('a user with memberships in two clinics', () => {
  it('sees only the data of the clinic they picked, and can switch', async () => {
    const choices = await clinicsForUser(inBoth);

    for (const [picked, other] of [
      [clinicA, clinicB],
      [clinicB, clinicA],
    ] as const) {
      const resolved = resolveClinic(choices, picked);
      expect(resolved.kind).toBe('clinic');
      if (resolved.kind !== 'clinic') throw new Error('unreachable');
      expect(resolved.choice.clinicId).toBe(picked);

      await withTenant(resolved.choice.clinicId, async (tx) => {
        expect((await tx.execute(sql`select id from clinics`)).rows).toEqual([{ id: picked }]);
        expect((await tx.execute(sql`select id from clinics where id = ${other}`)).rows).toEqual(
          [],
        );
        // Their own membership in the other clinic is not visible either.
        const memberships = await tx.execute(
          sql`select clinic_id from memberships where user_id = ${inBoth}`,
        );
        expect(memberships.rows).toEqual([{ clinic_id: picked }]);
        expect(await activeMembership(tx, inBoth)).toMatchObject({
          clinicId: picked,
          userId: inBoth,
          status: 'active',
        });
      });
    }
  });

  it('cannot pick a clinic they do not belong to', async () => {
    const choices = await clinicsForUser(inBoth);
    expect(resolveClinic(choices, clinicC)).toEqual({ kind: 'choose', choices });
    await withTenant(clinicC, async (tx) => {
      expect(await activeMembership(tx, inBoth)).toBeNull();
    });
  });
});

describe('a disabled membership', () => {
  it('does not let the user into that clinic', async () => {
    const choices = await clinicsForUser(oneDisabled);
    // Picking the clinic with the disabled membership falls back to the only clinic they may enter.
    expect(resolveClinic(choices, clinicB)).toEqual({
      kind: 'clinic',
      choice: expect.objectContaining({ clinicId: clinicA }),
    });
    await withTenant(clinicB, async (tx) => {
      expect(await activeMembership(tx, oneDisabled)).toBeNull();
    });
    await withTenant(clinicA, async (tx) => {
      expect(await activeMembership(tx, oneDisabled)).toMatchObject({ role: 'dentist' });
    });
  });
});

// E01-T04b: the calendar opens on a linked member's own column, read with the membership in the
// clinic's own transaction (D-091, "Revisit if").
describe("the active membership's provider", () => {
  it('is the provider the membership is linked to, in that clinic only; null when linked to none', async () => {
    const [linked, ofProvider] = [await createUser(), await insertClinic(admin)];
    const provider = await insertProvider(admin, ofProvider, 'hygienist');
    await insertMembership(admin, { clinicId: ofProvider, userId: linked, providerId: provider });
    await insertMembership(admin, { clinicId: clinicA, userId: linked, role: 'owner' });
    await withTenant(ofProvider, async (tx) => {
      expect(await activeMembership(tx, linked)).toMatchObject({ providerId: provider });
    });
    await withTenant(clinicA, async (tx) => {
      expect(await activeMembership(tx, linked)).toMatchObject({ providerId: null });
      expect(await activeMembership(tx, inBoth)).toMatchObject({ providerId: null });
    });
  });
});

describe('the memberships table', () => {
  it('allows one membership per user and clinic', async () => {
    await expectPgError(
      insertMembership(admin, { clinicId: clinicA, userId: inBoth }),
      PG.uniqueViolation,
    );
  });

  it('refuses unknown roles, statuses and extra permissions', async () => {
    await expectPgError(
      insertMembership(admin, { clinicId: clinicC, userId: nobody, role: 'assistant' }),
      PG.checkViolation,
    );
    await expectPgError(
      insertMembership(admin, { clinicId: clinicC, userId: nobody, status: 'pending' }),
      PG.checkViolation,
    );
    await expectPgError(
      insertMembership(admin, { clinicId: clinicC, userId: nobody, extraPermissions: ['delete'] }),
      PG.checkViolation,
    );
  });

  // Read-only for the app role from E00-T02 until E00-T05b: migration 0004 gives it INSERT, for
  // `pnpm clinic:create`'s first owner (owner, D-101). The policy keeps every insert in the
  // transaction's own clinic, and nothing lets the app change or delete a membership.
  it('lets the app role add a member to its own clinic only, and change or delete none', async () => {
    const added = sql`
      insert into memberships (id, clinic_id, user_id, role)
      values (gen_random_uuid(), ${clinicC}, ${nobody}, 'owner')`;
    // Its own clinic: added, then rolled back, so `nobody` keeps no membership.
    await expect(
      withTenant(clinicC, async (tx) => {
        await tx.execute(added);
        throw new Error('added, now rolled back');
      }),
    ).rejects.toThrow('added, now rolled back');
    // Another clinic's: refused by the policy.
    await withTenant(clinicA, async (tx) => {
      await expectPgError(tx.execute(added), PG.insufficientPrivilege);
    });
    // Changed or deleted, in its own clinic too: no privilege.
    for (const statement of [
      sql`update memberships set role = 'dentist' where user_id = ${inBoth}`,
      sql`delete from memberships where user_id = ${inBoth}`,
    ]) {
      await withTenant(clinicA, async (tx) => {
        await expectPgError(tx.execute(statement), PG.insufficientPrivilege);
      });
    }
    const { rows } = await admin.query('select 1 from memberships where user_id = $1', [nobody]);
    expect(rows).toEqual([]);
  });
});

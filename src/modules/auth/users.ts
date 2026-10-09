import { getAuth } from './better-auth';

export interface NewStaffUser {
  email: string;
  name: string;
  /**
   * The person's password, for the seed only (its logins share one, README.md). Everyone else is
   * made without one, and so without a password login: nobody can sign in as them until they choose
   * their own through a one-time link (createSetupLink(), D-101).
   */
  password?: string;
  /**
   * The person's id, for the seed only (owner, handoffs/E00-T05a.md): a seeded person keeps the
   * same id across `pnpm db:reset`, so later seeds and tests can name them. Everyone else leaves it
   * out and gets a new id from the library (newId()).
   */
  id?: string;
}

/**
 * Creates a person, with a password login when a password is given. There is no self sign-up: the
 * seed (E00-T05a), the operator script (`pnpm clinic:create`, E00-T05b) and invites (E04) call this.
 * The library hashes the password and sets the timestamps. Fails if the email or the given id is
 * taken, or the password is too short or too long to sign in with.
 */
export async function createStaffUser(input: NewStaffUser): Promise<{ id: string }> {
  const ctx = await getAuth().$context;
  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  const { password } = input;
  if (
    password !== undefined &&
    (password.length < minPasswordLength || password.length > maxPasswordLength)
  ) {
    throw new RangeError(
      `createStaffUser: the password must be ${minPasswordLength} to ${maxPasswordLength} characters`,
    );
  }
  const user = await ctx.internalAdapter.createUser(
    {
      // The library keeps an id it is given: it creates users with forceAllowId, and with a
      // generateId of our own it writes a given id as it is. Without one, it calls newId().
      ...(input.id === undefined ? {} : { id: input.id }),
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      emailVerified: true, // staff accounts are created by the operator or by invite
    },
    { method: 'admin' },
  ); // how the library labels an account made by an administrator
  if (password !== undefined) {
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(password),
    });
  }
  return { id: user.id };
}

/** A person found by their email: their id, and whether they can sign in with a password yet. */
export interface StaffUser {
  id: string;
  /** False for a person made without one who has not yet chosen theirs (D-101). */
  hasPassword: boolean;
}

/**
 * The person with this email (trimmed, any case), or null. `hasPassword` is the library's own test
 * for a password login: the credential account sign-in and `/reset-password` look for.
 */
export async function findStaffUser(email: string): Promise<StaffUser | null> {
  const ctx = await getAuth().$context;
  const found = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase());
  if (!found) return null;
  const { id } = found.user;
  return { id, hasPassword: (await ctx.internalAdapter.findCredentialAccount(id)) !== null };
}

import { getAuth } from './better-auth';

export interface NewStaffUser {
  email: string;
  name: string;
  password: string;
  /**
   * The person's id, for the seed only (owner, handoffs/E00-T05a.md): a seeded person keeps the
   * same id across `pnpm db:reset`, so later seeds and tests can name them. Everyone else leaves it
   * out and gets a new id from the library (newId()).
   */
  id?: string;
}

/**
 * Creates a person who can sign in with email and password. There is no self sign-up: the seed
 * (E00-T05a), the operator script (E00-T05b) and invites (E04) call this. The library hashes the
 * password and sets the timestamps. Fails if the email or the given id is taken, or the password
 * is too short to sign in with.
 */
export async function createStaffUser(input: NewStaffUser): Promise<{ id: string }> {
  const ctx = await getAuth().$context;
  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  if (input.password.length < minPasswordLength || input.password.length > maxPasswordLength) {
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
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  });
  return { id: user.id };
}

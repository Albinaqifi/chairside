import { getAuth } from './better-auth';

export interface NewStaffUser {
  email: string;
  name: string;
  password: string;
}

/**
 * Creates a person who can sign in with email and password. There is no self sign-up: the seed
 * and the operator script (E00-T05) and invites (E04) call this. The library hashes the password
 * and sets the timestamps. Fails if the email is taken or the password is too short to sign in with.
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

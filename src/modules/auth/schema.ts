import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '@/lib/ids';
// For the foreign keys only (D-058). scheduling's schema.ts imports users from this file too: the
// cycle holds because each side reads the other only inside drizzle's callbacks.
import { providers } from '@/modules/scheduling/schema';
import { clinics } from '@/modules/tenancy/schema';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/*
 * The auth library's tables (Better Auth, D-006): users, sessions, accounts, verifications and
 * rate_limits. They are GLOBAL: a person can belong to several clinics, so none of them has a
 * clinic_id or Row-Level Security (tests/integration/tenant-allow-list.ts). The TypeScript
 * property names are the library's field names; it finds the tables by these names.
 */

/** A staff member's identity. Which clinics they may enter is in `memberships`. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    name: text('name').notNull(),
    email: text('email').notNull().unique(), // lower-case
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    ...timestamps,
  },
  (t) => [check('users_email_check', sql`${t.email} = lower(${t.email})`)],
);

/** A login session. `token` is the secret in the cookie; it never goes into a log. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/** A way to sign in. In v1 only `credential` (email + password): `password` holds the hash. */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'), // the hash, never the password itself
    ...timestamps,
  },
  (t) => [
    index('accounts_user_id_idx').on(t.userId),
    unique('accounts_provider_id_account_id_key').on(t.providerId, t.accountId),
  ],
);

/** One-time tokens the library issues (password reset, E04). */
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/** Request counters for rate limiting, by client address and path (`key`). */
export const rateLimits = pgTable('rate_limits', {
  id: uuid('id').primaryKey().$defaultFn(newId),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(), // Unix time in ms
});

/**
 * A person's place in one clinic (D-021): their role, extra permissions and whether they may
 * enter. A tenant table. `provider_id` links the person to their calendar column, a provider of
 * the same clinic (E01-T01a); clinics_for_user() returns that provider's kind, which can() reads
 * (D-091).
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    extraPermissions: text('extra_permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    providerId: uuid('provider_id'),
    status: text('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    unique('memberships_clinic_id_id_key').on(t.clinicId, t.id),
    unique('memberships_clinic_id_user_id_key').on(t.clinicId, t.userId),
    index('memberships_user_id_idx').on(t.userId),
    foreignKey({
      name: 'memberships_provider_id_fk',
      columns: [t.clinicId, t.providerId],
      foreignColumns: [providers.clinicId, providers.id],
    }),
    check(
      'memberships_role_check',
      sql`${t.role} in ('owner', 'dentist', 'hygienist', 'front_desk')`,
    ),
    check('memberships_status_check', sql`${t.status} in ('active', 'disabled')`),
    check(
      'memberships_extra_permissions_check',
      sql`${t.extraPermissions} <@ array['import', 'export']::text[]`,
    ),
  ],
);

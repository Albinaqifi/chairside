// `pnpm clinic:create` (E00-T05b, D-042, D-101): the operator's script for a new clinic and its first
// owner, who chooses their own password through the one-time link it prints. There is no sign-up page.
// Run with tsx, as the seed is (D-090), so it may import `@/`. It writes as the app role
// (DATABASE_URL), the clinic, the membership and the audit row inside withTenant for the new clinic,
// so Row-Level Security binds it as it binds every page; it never reads MIGRATION_DATABASE_URL. It
// runs on this machine, and against a database elsewhere only with --remote-database: on a host,
// inside the app's image, never from a development machine against production (D-044). How to run
// it: docs/runbook.md.
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { systemClock, type Clock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import * as audit from '@/modules/audit';
import {
  addMembership,
  clinicsForUser,
  createSetupLink,
  createStaffUser,
  findStaffUser,
  SETUP_LINK_DAYS,
} from '@/modules/auth';
import * as tenancy from '@/modules/tenancy';
import { APP_ROLE, connectionTarget, isLocalHost } from './reset';

/** What the script makes: a clinic, and the person who will own it. */
export interface ClinicCreateInput extends tenancy.NewClinic {
  ownerEmail: string;
  ownerName: string;
}

type Field = keyof ClinicCreateInput;

/** North Macedonia's, where a setting is not given (D-049), the texts in English (D-053). */
export const CLINIC_DEFAULTS = {
  timeZone: 'Europe/Skopje',
  country: 'MK',
  currency: 'MKD',
  locale: 'en',
} as const satisfies Partial<ClinicCreateInput>;

/**
 * Each field's option, and what it must be, in the order of USAGE: a refusal names the option,
 * never what was typed.
 */
const FIELDS: Record<Field, { option: string; mustBe: string }> = {
  name: { option: '--name', mustBe: "the clinic's name, not empty" },
  ownerEmail: { option: '--owner-email', mustBe: "the owner's email address" },
  ownerName: { option: '--owner-name', mustBe: "the owner's name, not empty" },
  timeZone: { option: '--time-zone', mustBe: 'a time zone Intl knows, such as Europe/Skopje' },
  country: {
    option: '--country',
    mustBe: 'a country the phone package supports: two capital letters, such as MK (GB, not UK)',
  },
  currency: { option: '--currency', mustBe: 'three capital letters, such as MKD' },
  locale: { option: '--locale', mustBe: 'en: the app has texts in English only' },
};

/** The owner's email trimmed and lower-cased, then checked; both names trimmed, then not empty. */
const owner = z.object({
  ownerEmail: z.string().trim().toLowerCase().pipe(z.email()),
  ownerName: z.string().trim().min(1),
});

/**
 * The fields that cannot be used, in the order of FIELDS: the clinic's settings as
 * tenancy.newClinicProblems() finds them, and the owner's email and name.
 */
function inputProblems(input: Partial<ClinicCreateInput>): Field[] {
  const settings: tenancy.NewClinic = {
    name: input.name ?? '',
    timeZone: input.timeZone ?? '',
    country: input.country ?? '',
    currency: input.currency ?? '',
    locale: input.locale ?? '',
  };
  const wrong = new Set<Field>(tenancy.newClinicProblems(settings));
  for (const issue of owner.safeParse(input).error?.issues ?? []) {
    const [field] = issue.path;
    if (field === 'ownerEmail' || field === 'ownerName') wrong.add(field);
  }
  return (Object.keys(FIELDS) as Field[]).filter((field) => wrong.has(field));
}

/** What the command line asks for. */
export type ClinicCreateArgs =
  | { kind: 'help' }
  | { kind: 'refused'; problems: string[] }
  | { kind: 'create'; input: ClinicCreateInput; remoteDatabase: boolean };

export const USAGE = `Usage: pnpm clinic:create --name <the clinic's name> --owner-email <email> --owner-name <name>
         [--time-zone ${CLINIC_DEFAULTS.timeZone}] [--country ${CLINIC_DEFAULTS.country}] [--currency ${CLINIC_DEFAULTS.currency}] [--locale ${CLINIC_DEFAULTS.locale}] [--remote-database]
Creates a clinic and its first owner, then prints the link where the owner chooses their password:
it works once, for ${SETUP_LINK_DAYS} days. A setting not given is North Macedonia's, as shown.
--remote-database: the database is not on this machine (on a host, in the app's image only).
See docs/runbook.md.`;

/**
 * Reads the command line (pnpm passes what follows the script's name). Every problem is found at
 * once, each named by its option, before anything connects; what was typed is never repeated, as
 * an email is personal.
 */
export function parseClinicCreateArgs(argv: readonly string[]): ClinicCreateArgs {
  let values;
  try {
    ({ values } = parseArgs({
      // A `--` in front, as some ways of passing arguments through add, ends nothing here.
      args: argv[0] === '--' ? argv.slice(1) : [...argv],
      options: {
        name: { type: 'string' },
        'owner-email': { type: 'string' },
        'owner-name': { type: 'string' },
        'time-zone': { type: 'string', default: CLINIC_DEFAULTS.timeZone },
        country: { type: 'string', default: CLINIC_DEFAULTS.country },
        currency: { type: 'string', default: CLINIC_DEFAULTS.currency },
        locale: { type: 'string', default: CLINIC_DEFAULTS.locale },
        'remote-database': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    // parseArgs' own message can repeat a value typed without its option.
    return {
      kind: 'refused',
      problems: ['an option it does not know, an option without its value, or a value without one'],
    };
  }
  if (values.help) return { kind: 'help' };
  const typed = {
    name: values.name,
    timeZone: values['time-zone'],
    country: values.country,
    currency: values.currency,
    locale: values.locale,
    ownerEmail: values['owner-email'],
    ownerName: values['owner-name'],
  };
  const problems = inputProblems(typed);
  if (problems.length > 0) {
    return {
      kind: 'refused',
      problems: problems.map((field) => `${FIELDS[field].option} must be ${FIELDS[field].mustBe}`),
    };
  }
  const { ownerEmail, ownerName } = owner.parse(typed);
  return {
    kind: 'create',
    input: {
      name: typed.name?.trim() ?? '',
      timeZone: typed.timeZone,
      country: typed.country,
      currency: typed.currency,
      locale: typed.locale,
      ownerEmail,
      ownerName,
    },
    remoteDatabase: values['remote-database'],
  };
}

/** The settings the script reads, all of them the app's own: nothing new in .env.example. */
const SETTINGS = ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET'] as const;

/**
 * The guard, run before anything connects (D-101): the database DATABASE_URL names is on this
 * machine, as pg will really reach it (connectionTarget()), unless --remote-database says it is not;
 * and the script connects as the app role, so the policies bind it. NODE_ENV=production is no
 * refusal: on a host the script runs there. The problem, or null.
 */
export function clinicCreateTargetProblem(
  databaseUrl: string,
  remoteDatabase: boolean,
): string | null {
  const { host, user } = connectionTarget(databaseUrl);
  if (!isLocalHost(host) && !remoteDatabase) {
    return (
      `DATABASE_URL names a database on "${host}", not on this machine. Add --remote-database ` +
      "only on a host, inside the app's image (docs/runbook.md); never from a development " +
      'machine against production.'
    );
  }
  if (user !== APP_ROLE) {
    return `DATABASE_URL must connect as ${APP_ROLE}: the script writes as the app role, so the policies bind it.`;
  }
  return null;
}

/** Why a run made nothing: a person with the owner's email is there already. */
export type ClinicCreateRefusal = 'owner_has_clinic' | 'owner_has_password';

export type ClinicCreateResult =
  | {
      ok: true;
      clinicId: string;
      /** The setup link: for the owner alone, through the terminal, never a logger. */
      link: string;
      /** True when the owner was a person an earlier, broken run left behind. */
      ownerTakenUp: boolean;
    }
  | { ok: false; refusal: ClinicCreateRefusal };

/**
 * Makes the clinic and its first owner, in this order: the person, through the auth module (D-063),
 * made without a password, so nobody can sign in as them before the link is used; the link
 * (createSetupLink); then, in one transaction for the new clinic, the clinic, the owner's membership
 * and one audit row, `clinic.created` by the system, ids only. The person and the link are written
 * through the auth library, outside that transaction, and the app role may not delete a person, so
 * a transaction that fails leaves the person and an unprinted link nobody has, which expires. A
 * second run with the same owner email takes that person up and finishes the work.
 *
 * Refused, with nothing written: an owner email whose person is already in a clinic (a second run:
 * no second clinic, and no second live link, which could reset a password already chosen), or whose
 * person has a password. `now` is the run's moment: the link's 3 days, the rows' times.
 */
export async function createClinicWithOwner(
  input: ClinicCreateInput,
  now: Date,
): Promise<ClinicCreateResult> {
  const problems = inputProblems(input);
  if (problems.length > 0) {
    throw new Error(`createClinicWithOwner: ${problems.join(', ')} cannot be used`);
  }
  const found = await findStaffUser(input.ownerEmail);
  if (found && (await clinicsForUser(found.id)).length > 0) {
    return { ok: false, refusal: 'owner_has_clinic' };
  }
  if (found?.hasPassword) return { ok: false, refusal: 'owner_has_password' };
  // No clinic and no password: a person a broken run left behind, taken up rather than made twice.
  const userId =
    found?.id ?? (await createStaffUser({ email: input.ownerEmail, name: input.ownerName })).id;
  const link = await createSetupLink(userId, now);
  const clinicId = newId();
  await withTenant(clinicId, async (tx) => {
    const { name, timeZone, country, currency, locale } = input;
    await tenancy.createClinic(tx, { name, timeZone, country, currency, locale }, now);
    const membershipId = await addMembership(tx, { userId, role: 'owner' }, now);
    await audit.record(tx, {
      at: now,
      actorType: 'system',
      actorId: null,
      action: 'clinic.created',
      entityType: 'clinic',
      entityId: clinicId,
      metadata: { ownerId: userId, membershipId },
    });
  });
  return { ok: true, clinicId, link, ownerTakenUp: found !== null };
}

const REFUSALS: Record<ClinicCreateRefusal, string> = {
  owner_has_clinic:
    'Nothing was written: the person with this owner email is already in a clinic. A second run ' +
    'makes no second person, clinic or link. A link that expired unused: docs/runbook.md.',
  owner_has_password:
    'Nothing was written: a person with this owner email already has a password and no clinic. ' +
    'The script makes owners of new people only.',
};

/**
 * The command: reads the command line and the app's settings, checks both before anything
 * connects, makes the clinic, and prints the setup link on the terminal, the one place it goes.
 * Answers the exit code: 0 when the clinic was made, 1 when it refused, with what to do and no
 * stack. An unexpected failure (the database unreachable) is thrown: its errors carry no values.
 */
export async function runClinicCreate(
  argv: readonly string[],
  clock: Clock = systemClock,
): Promise<number> {
  const args = parseClinicCreateArgs(argv);
  if (args.kind === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (args.kind === 'refused') {
    console.error(
      ['Refused, nothing written:', ...args.problems.map((problem) => `  ${problem}.`)].join('\n'),
    );
    console.error(USAGE);
    return 1;
  }
  const missing = SETTINGS.filter((setting) => !process.env[setting]);
  if (missing.length > 0) {
    console.error(
      `Refused, nothing written: ${missing.join(', ')} not set. Locally: copy .env.example to .env ` +
        "(README.md); on a host, the app's own settings.",
    );
    return 1;
  }
  const target = clinicCreateTargetProblem(process.env.DATABASE_URL ?? '', args.remoteDatabase);
  if (target !== null) {
    console.error(`Refused, nothing written: ${target}`);
    return 1;
  }

  const result = await createClinicWithOwner(args.input, clock.now());
  if (!result.ok) {
    console.error(REFUSALS[result.refusal]);
    return 1;
  }
  if (result.ownerTakenUp) {
    console.log('An earlier run had made the owner but not the clinic: this run finished it.');
  }
  console.log(
    `Clinic ${result.clinicId} created. Send its owner this link yourself: they choose their ` +
      `password there. It works once, for ${SETUP_LINK_DAYS} days.`,
  );
  console.log(result.link);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await runClinicCreate(process.argv.slice(2));
  } finally {
    // The pool the run used: open, it would keep the script from ending.
    await closeDb();
  }
}

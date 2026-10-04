import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import { withTenant, type TenantTransaction } from '@/db/tenant';
import { systemClock } from '@/lib/clock';
import { logger } from '@/lib/logger';
import * as audit from '@/modules/audit';
import { can, PERMISSIONS, type Permission } from '@/modules/auth';
import { parseInput, type InputIssue } from './action-input';
import { currentStaff, requireUser, type SignedInUser, type Staff } from './auth';

/*
 * The action wrappers (E00-T03, D-071). Every server action is made by one of them, so the checks
 * below cannot be forgotten (E00-T08 makes lint refuse any other):
 *
 * - staffAction: a change. Who → which clinic (D-069) → allowed → valid (D-068) → the handler and
 *   exactly one audit row in one transaction → a typed answer.
 * - staffRead: a read, as an action from the browser or in a page while it renders (`forPage`).
 *   The same steps, with an audit row only for a read that declares one (a patient record view).
 * - userAction: for a signed-in person before a clinic is chosen (the clinic picker): who →
 *   valid → the handler. No clinic, no transaction, no audit row.
 *
 * Every staffAction and staffRead names the permission it needs, or 'every_member'. No default.
 */

/** What a staff action needs: a permission from the table, or every active member may. */
export type ActionPermission = Permission | 'every_member';

/** The codes the wrappers answer with themselves. A handler refuses with codes of its own. */
export type WrapperErrorCode = 'clinic_changed' | 'forbidden' | 'invalid_input' | 'internal';

type HandlerRefusal<R extends string> = [R] extends [never] ? never : { code: R };

/** Why a read gave no answer. */
export type ReadError<R extends string = never> =
  /** The role does not have the permission. */
  | { code: 'forbidden' }
  /** The input does not fit the schema: where, and what kind of problem; never the values. */
  | { code: 'invalid_input'; issues: InputIssue[] }
  /** Something unexpected. It was rolled back and logged; the answer has no detail. */
  | { code: 'internal' }
  /** The handler's own refusal, such as `not_found`. */
  | HandlerRefusal<R>;

/**
 * Why an action did not run or did not finish; nothing it did is kept. `clinic_changed`: the
 * request now resolves to another clinic than the page was shown for (another tab switched, or a
 * membership was disabled), so nothing ran (D-069). The page should be reloaded.
 */
export type ActionError<R extends string = never> = { code: 'clinic_changed' } | ReadError<R>;

export type ActionResult<T, R extends string = never> =
  { ok: true; value: T } | { ok: false; error: ActionError<R> };

export type ReadResult<T, R extends string = never> =
  { ok: true; value: T } | { ok: false; error: ReadError<R> };

export type UserActionError<R extends string = never> =
  { code: 'invalid_input'; issues: InputIssue[] } | { code: 'internal' } | HandlerRefusal<R>;

export type UserActionResult<T, R extends string = never> =
  { ok: true; value: T } | { ok: false; error: UserActionError<R> };

const REFUSAL = Symbol('refusal');

/** A handler's own refusal, made by refuse(). */
export interface Refusal<C extends string> {
  readonly [REFUSAL]: C;
}

const REFUSAL_CODE = /^[a-z][a-z0-9_]*$/;
const WRAPPER_CODES: readonly string[] = [
  'clinic_changed',
  'forbidden',
  'invalid_input',
  'internal',
] satisfies WrapperErrorCode[];

/**
 * A handler's own "no", such as `return refuse('not_found')`. Nothing the handler did is kept, no
 * audit row is written, and the caller gets `{ code: 'not_found' }`. The code is a lower-case word
 * that the wrappers do not use themselves.
 */
export function refuse<const C extends string>(
  code: C extends WrapperErrorCode ? never : C,
): Refusal<C> {
  const text: string = code;
  if (!REFUSAL_CODE.test(text) || WRAPPER_CODES.includes(text)) {
    throw new TypeError('refuse: the code must be a lower-case word the wrappers do not use');
  }
  return Object.freeze({ [REFUSAL]: text }) as Refusal<C>;
}

function isRefusal(value: unknown): value is Refusal<string> {
  return typeof value === 'object' && value !== null && REFUSAL in value;
}

/** What a staff action's or read's handler gets. */
export interface StaffContext<In> {
  /** The input, parsed by the schema. */
  input: In;
  /** The transaction, in the clinic the action runs in. Pass it to the module functions. */
  tx: TenantTransaction;
  /** Who acts, in which clinic, with which role. */
  staff: Staff;
  /** "Now" for this action: the clock, read once here at the edge. Pass it on. */
  now: Date;
}

/** What a userAction's handler gets. */
export interface UserContext<In> {
  input: In;
  user: SignedInUser;
  /** "Now" for this action: the clock, read once here at the edge. */
  now: Date;
}

/**
 * A handler: the work itself. Its result is the answer's value; `refuse(code)` is its own "no".
 * Anything it throws is unexpected: rolled back, logged, answered `internal`. That includes
 * Next.js's redirect() and notFound(): a staff handler returns, and the page goes where it should.
 */
type Handler<Context, Out, R extends string> = (context: Context) => Promise<Out | Refusal<R>>;

/** The fields of T that hold a V. */
type FieldsHolding<T, V> = T extends object
  ? { [K in keyof T]-?: T[K] extends V ? K : never }[keyof T] & string
  : never;

/**
 * Where a value of the audit row comes from: a function of the parsed input and the staff member,
 * or a field of the handler's result, for example `{ result: 'id' }` for an entity it created.
 */
export type AuditSource<In, Out, V> =
  ((action: { input: In; staff: Staff }) => V) | { result: FieldsHolding<Out, V> };

/** What an action's audit row records (security-privacy.md, section 10). */
export interface AuditDeclaration<In, Out> {
  /** What happened, as `<entity>.<what happened>`: `patient.created`. */
  action: string;
  /** What it happened to, as a code: `patient`. */
  entityType: string;
  /** That entity's id: `({ input }) => input.patientId`, or `{ result: 'id' }`. */
  entityId: AuditSource<In, Out, string>;
  /** Ids, codes and field names only. A personal field name fails the action (audit.record). */
  metadata?: AuditSource<In, Out, audit.AuditMetadata>;
}

/**
 * A staff action as the browser calls it: with the id of the clinic its page was shown for, and
 * the input (a plain value, or a form's FormData). A form binds the clinic id first:
 * `action.bind(null, clinicId)`.
 */
export type StaffAction<In, Out, R extends string = never> = (
  clinicId: string,
  input: In | FormData,
) => Promise<ActionResult<Out, R>>;

/** A staff read: called as an action like StaffAction, or by a page with `forPage`. */
export type StaffRead<In, Out, R extends string = never> = StaffAction<In, Out, R> & {
  /**
   * For a page while it renders on the server: the same steps without the clinic check, in the
   * clinic resolved for this request (D-069). It is not an action: never export it from a
   * 'use server' file, where the browser could call it without the clinic check.
   */
  forPage: (input: In) => Promise<ReadResult<Out, R>>;
};

/** A user action as the browser calls it: the input, a plain value or a form's FormData. */
export type UserAction<In, Out, R extends string = never> = (
  input: In | FormData,
) => Promise<UserActionResult<Out, R>>;

/**
 * A wrapper-made action as the `action` of a plain `<form>`, which works without JavaScript too.
 * The same function: React types a form's action as returning nothing because it ignores the
 * answer. A form that shows the answer uses useActionState instead (E00-T04).
 */
export function asFormAction(
  action: (formData: FormData) => Promise<unknown>,
): (formData: FormData) => Promise<void> {
  return action as (formData: FormData) => Promise<void>;
}

/**
 * Makes a server action that changes data (example in CLAUDE.md, "Who is signed in"). When the
 * browser calls it:
 * 1. Who: currentStaff(). No session → the login page; no settled clinic → the clinic picker.
 * 2. Which clinic: the id the call carries must be the clinic the request resolves to, else
 *    `clinic_changed` (D-069).
 * 3. Allowed: `can()` for the declared permission, else `forbidden`.
 * 4. Valid: the input parsed with the schema, else `invalid_input` with paths and codes.
 * 5. Do it: the handler, in one withTenant for that clinic, with the clock read once as `now`.
 * 6. Audit: exactly one row from the `audit` declaration, in the same transaction.
 * 7. Answer: `{ ok: true, value }`, or `{ ok: false, error: { code } }`.
 */
export function staffAction<S extends z.ZodType, Out, R extends string = never>(
  options: {
    permission: ActionPermission;
    input: S;
    audit: AuditDeclaration<z.output<S>, NoInfer<Out>>;
  },
  handler: Handler<StaffContext<z.output<S>>, Out, R>,
): StaffAction<z.input<S>, Out, R> {
  const spec = checkedSpec('staffAction', options, true);
  const work = handler as unknown as AnyStaffHandler;
  const action = async (clinicId: string, input: unknown) =>
    runStaff(spec, work, { from: 'browser', clinicId }, input);
  return action as StaffAction<z.input<S>, Out, R>;
}

/**
 * Makes a read: as a server action for the browser (polling, a drawer that loads), with the same
 * steps as staffAction and the clinic check; or `forPage` for a page while it renders, without
 * the clinic check. No audit row, unless the read declares one: a read that shows a patient
 * record does (security-privacy.md, section 10), and then the record is shown only if its row
 * was written.
 */
export function staffRead<S extends z.ZodType, Out, R extends string = never>(
  options: {
    permission: ActionPermission;
    input: S;
    /** Only for a read that shows a patient record: one audit row per view. */
    audit?: AuditDeclaration<z.output<S>, NoInfer<Out>>;
  },
  handler: Handler<StaffContext<z.output<S>>, Out, R>,
): StaffRead<z.input<S>, Out, R> {
  const spec = checkedSpec('staffRead', options, false);
  const work = handler as unknown as AnyStaffHandler;
  const action = async (clinicId: string, input: unknown) =>
    runStaff(spec, work, { from: 'browser', clinicId }, input);
  const forPage = async (input: unknown) => runStaff(spec, work, { from: 'page' }, input);
  return Object.assign(action, { forPage }) as StaffRead<z.input<S>, Out, R>;
}

/**
 * Makes a server action for a signed-in person who has no clinic yet (the clinic picker):
 * who → valid → the handler. No clinic, no transaction, no audit row (D-071). Its handler may
 * redirect: with no transaction, nothing is lost by it.
 */
export function userAction<S extends z.ZodType, Out, R extends string = never>(
  options: { input: S },
  handler: Handler<UserContext<z.output<S>>, Out, R>,
): UserAction<z.input<S>, Out, R> {
  checkSchema('userAction', options.input);
  const action = async (sent: unknown): Promise<UserActionResult<unknown, string>> => {
    let userId: string | undefined;
    try {
      // 1. Who. Without a session, requireUser() sends the person to the login page.
      const user = await requireUser();
      userId = user.id;
      // 2. Valid?
      const parsed = await parseInput(options.input, sent);
      if (!parsed.ok) return { ok: false, error: { code: 'invalid_input', issues: parsed.issues } };
      // 3. Do it.
      const outcome: unknown = await handler({ input: parsed.value, user, now: systemClock.now() });
      if (isRefusal(outcome)) return { ok: false, error: { code: outcome[REFUSAL] } };
      return { ok: true, value: outcome };
    } catch (error) {
      // A redirect, the login page's or the handler's own, is Next.js's to carry out.
      unstable_rethrow(error);
      return internal(error, { wrapper: 'userAction', userId });
    }
  };
  return action as UserAction<z.input<S>, Out, R>;
}

type AnyStaffHandler = (context: StaffContext<unknown>) => Promise<unknown>;

interface StaffSpec {
  wrapper: 'staffAction' | 'staffRead';
  permission: ActionPermission;
  input: z.ZodType;
  audit: AuditDeclaration<unknown, unknown> | undefined;
}

/** How the wrapper was reached: by the browser with the page's clinic id, or by a page rendering. */
type Call = { from: 'browser'; clinicId: unknown } | { from: 'page' };

async function runStaff(
  spec: StaffSpec,
  handler: AnyStaffHandler,
  call: Call,
  sent: unknown,
): Promise<ActionResult<unknown, string>> {
  // 1. Who. currentStaff() throws Next.js's redirects (to the login page, to the picker): rethrown
  //    for Next.js to carry out. Anything else that fails here is unexpected.
  let staff: Staff;
  try {
    staff = await currentStaff();
  } catch (error) {
    unstable_rethrow(error);
    return internal(error, details(spec));
  }
  const ids = { userId: staff.user.id, clinicId: staff.clinic.clinicId };

  // 2. Which clinic (D-069). The id only ever stops an action: the clinic it runs in is still the
  //    one resolved from the person's active memberships.
  if (call.from === 'browser' && call.clinicId !== staff.clinic.clinicId) {
    return { ok: false, error: { code: 'clinic_changed' } };
  }

  // 3. Allowed?
  if (!allowed(staff, spec.permission)) return { ok: false, error: { code: 'forbidden' } };

  // 4. Valid?
  let input: unknown;
  try {
    const parsed = await parseInput(spec.input, sent);
    if (!parsed.ok) return { ok: false, error: { code: 'invalid_input', issues: parsed.issues } };
    input = parsed.value;
  } catch (error) {
    return internal(error, details(spec, ids)); // a refinement or transform that threw
  }

  // 5. Do it, and 6. audit it, in one transaction: both are kept, or neither.
  const now = systemClock.now();
  try {
    const value = await withTenant(staff.clinic.clinicId, async (tx) => {
      const outcome = await handler({ input, tx, staff, now });
      if (isRefusal(outcome)) throw new HandlerRefused(outcome[REFUSAL]);
      if (spec.audit) await audit.record(tx, auditEntry(spec.audit, input, outcome, staff, now));
      return outcome;
    });
    // 7. Answer.
    return { ok: true, value };
  } catch (error) {
    // A refusal arrives here only if its rollback worked; otherwise the rollback's error does.
    if (error instanceof HandlerRefused) return { ok: false, error: { code: error.code } };
    return internal(error, details(spec, ids));
  }
}

/** Carries a handler's refusal out of its transaction, so the transaction rolls back. */
class HandlerRefused extends Error {
  override name = 'HandlerRefused';
  readonly code: string;
  constructor(code: string) {
    super('The handler refused; its transaction was rolled back.');
    this.code = code;
  }
}

function allowed(staff: Staff, permission: ActionPermission): boolean {
  if (permission === 'every_member') return true;
  const extras = {
    extraPermissions: staff.clinic.extraPermissions,
    // Memberships are linked to providers from E01-T01; until then nobody is.
    providerKind: null,
  };
  return can(staff.clinic.role, extras, permission);
}

function auditEntry(
  declaration: AuditDeclaration<unknown, unknown>,
  input: unknown,
  result: unknown,
  staff: Staff,
  now: Date,
): audit.AuditEntry {
  const from = <V>(source: AuditSource<unknown, unknown, V>): V | undefined =>
    typeof source === 'function'
      ? source({ input, staff })
      : (result as Record<string, V> | null | undefined)?.[source.result as string];
  return {
    at: now,
    actorType: 'user',
    actorId: staff.user.id,
    action: declaration.action,
    entityType: declaration.entityType,
    // audit.record() checks it: a missing or malformed id fails the action, it is never guessed.
    entityId: from(declaration.entityId) as string,
    metadata: declaration.metadata && from(declaration.metadata),
  };
}

/** The ids a failure is logged with: never the input, never a personal value. */
function details(spec: StaffSpec, ids: { userId?: string; clinicId?: string } = {}) {
  return {
    wrapper: spec.wrapper,
    permission: spec.permission,
    action: spec.audit?.action,
    ...ids,
  };
}

/**
 * Anything unexpected: withTenant has rolled it back; it is logged once here, with ids and the
 * error (cleaned of query values where it was made, D-070), and answered without detail. The
 * error may not be the handler's first: when a rollback fails, Drizzle throws the rollback's.
 */
function internal(
  error: unknown,
  context: Record<string, string | undefined>,
): { ok: false; error: { code: 'internal' } } {
  logger.error({ err: error, ...context }, 'action failed; answered internal');
  return { ok: false, error: { code: 'internal' } };
}

function checkedSpec(
  wrapper: StaffSpec['wrapper'],
  options: { permission: unknown; input: unknown; audit?: unknown },
  auditRequired: boolean,
): StaffSpec {
  const { permission, input } = options;
  if (permission !== 'every_member' && !(PERMISSIONS as readonly unknown[]).includes(permission)) {
    throw new TypeError(`${wrapper}: name the permission it needs, or 'every_member'`);
  }
  checkSchema(wrapper, input);
  if (auditRequired || options.audit !== undefined) checkAudit(wrapper, options.audit);
  return {
    wrapper,
    permission: permission as ActionPermission,
    input: input as z.ZodType,
    audit: options.audit as AuditDeclaration<unknown, unknown> | undefined,
  };
}

function checkSchema(wrapper: string, schema: unknown): void {
  const parse = (schema as { safeParseAsync?: unknown } | null | undefined)?.safeParseAsync;
  if (typeof parse !== 'function') throw new TypeError(`${wrapper}: input must be a Zod schema`);
}

function checkAudit(wrapper: string, declaration: unknown): void {
  const d = declaration as Partial<Record<keyof AuditDeclaration<unknown, unknown>, unknown>>;
  const isSource = (value: unknown) =>
    typeof value === 'function' ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { result?: unknown }).result === 'string');
  const valid =
    typeof declaration === 'object' &&
    declaration !== null &&
    typeof d.action === 'string' &&
    typeof d.entityType === 'string' &&
    isSource(d.entityId) &&
    (d.metadata === undefined || isSource(d.metadata));
  if (!valid) {
    throw new TypeError(`${wrapper}: audit needs an action, an entityType and an entityId`);
  }
}

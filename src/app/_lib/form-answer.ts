import { unstable_rethrow } from 'next/navigation';
import type { InputIssue } from './action-input';
import type { ActionError, ActionResult, StaffAction } from './actions';

/*
 * What a staff form shows after it was sent (E00-T04c, D-092): the wrapper's answer (D-072), or a
 * call that failed at the network, turned into one of the form's answers. No React here, so each
 * answer is unit-tested; ./staff-form.tsx shows them.
 */

/**
 * What is wrong with one field, as the form says it: empty, or the input issue's code (Zod's) as
 * one of a few kinds. The texts are under form.fieldErrors in the message file.
 */
export type FieldProblem = 'missing' | 'tooSmall' | 'tooBig' | 'invalidFormat' | 'other';

/** A staff form's answer, from the last time it was sent. */
export type FormAnswer<Out> =
  /** Not sent yet. */
  | { kind: 'idle' }
  /** The action is done: a toast says so. */
  | { kind: 'done'; value: Out }
  /** `invalid_input`: each problem at its field, by the field's name. */
  | { kind: 'invalid'; fields: ReadonlyMap<string, FieldProblem> }
  /** The person's role does not have the action's permission. */
  | { kind: 'forbidden' }
  /** Another tab switched clinic (D-069): nothing ran, and the page should be reloaded. */
  | { kind: 'clinic_changed' }
  /** The handler's own refusal: its text if the form gives one, else the general failure. */
  | { kind: 'refused'; code: string }
  /** `internal`, or the call never got an answer (the network, the server restarting). */
  | { kind: 'failed' };

export const IDLE: FormAnswer<never> = { kind: 'idle' };
const FAILED: FormAnswer<never> = { kind: 'failed' };

/**
 * Sends a form to a wrapper-made staff action with the clinic id given, and gives the form's
 * answer. The clinic id is the frame's (./frame-clinic.tsx), never one a page passes.
 */
export async function sendForm<In, Out, R extends string>(
  action: StaffAction<In, Out, R>,
  clinicId: string,
  formData: FormData,
): Promise<FormAnswer<Out>> {
  let result: ActionResult<Out, R>;
  try {
    result = await action(clinicId, formData);
  } catch (error) {
    // Next.js's redirect (an ended session: the login page) is Next.js's to carry out: its router
    // has already started the navigation, and its boundary expects the error (D-074).
    unstable_rethrow(error);
    // The call failed: the network is gone, the server restarting. Answered here, as the general
    // failure: in useActionState's transition the rejection would go to the nearest error
    // boundary, and the app has none (Next.js, 01-getting-started/10-error-handling.md).
    return FAILED;
  }
  return answerOf(result, formData);
}

/** The form's answer to a wrapper's answer; `sent` is the form's data, to tell empty fields. */
export function answerOf<Out>(result: ActionResult<Out, string>, sent: FormData): FormAnswer<Out> {
  if (result.ok) return { kind: 'done', value: result.value };
  const error: ActionError<string> = result.error;
  // A handler's refusal never uses the wrappers' codes (refuse() refuses them), so `code` alone
  // tells the answers apart; `issues` comes only with invalid_input.
  if (error.code === 'invalid_input' && 'issues' in error) {
    return { kind: 'invalid', fields: fieldProblems(error.issues, sent) };
  }
  switch (error.code) {
    case 'forbidden':
      return { kind: 'forbidden' };
    case 'clinic_changed':
      return { kind: 'clinic_changed' };
    case 'internal':
    case 'invalid_input': // without its issues: not one the wrappers give
      return FAILED;
    default:
      return { kind: 'refused', code: error.code };
  }
}

/**
 * Each field's problem, by the field's name: the first issue whose path starts with it. An issue
 * whose path starts with no field name (the whole input, a list position, `*` for a key the
 * schema does not declare) has no field to show at; the form's own message still says that some
 * fields need a look. A field sent empty is `missing`, whatever the code.
 */
export function fieldProblems(
  issues: readonly InputIssue[],
  sent: FormData,
): ReadonlyMap<string, FieldProblem> {
  const fields = new Map<string, FieldProblem>();
  for (const { path, code } of issues) {
    const [name] = path;
    if (typeof name !== 'string' || name === '*' || fields.has(name)) continue;
    fields.set(name, sentEmpty(sent, name) ? 'missing' : problemOf(code));
  }
  return fields;
}

const PROBLEMS: Readonly<Record<string, FieldProblem>> = {
  too_small: 'tooSmall',
  too_big: 'tooBig',
  invalid_format: 'invalidFormat',
};

function problemOf(code: string): FieldProblem {
  return Object.hasOwn(PROBLEMS, code) ? (PROBLEMS[code] ?? 'other') : 'other';
}

/** True when the field was not sent, or sent as blanks or an empty file input. */
function sentEmpty(sent: FormData, name: string): boolean {
  return sent
    .getAll(name)
    .every((value) =>
      typeof value === 'string' ? value.trim() === '' : value.size === 0 && value.name === '',
    );
}

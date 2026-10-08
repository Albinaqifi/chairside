'use client';

import { useTranslations } from 'next-intl';
import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { Field, type FieldControlProps, type FieldOrientation } from '@/ui/field';
import { useToast } from '@/ui/toast';
import type { StaffAction } from './actions';
import { IDLE, sendForm, type FormAnswer } from './form-answer';
import { useFrameClinic } from './frame-clinic';

/*
 * The form pattern (E00-T04c, D-092): the one way a staff screen sends a form to a wrapped action
 * (staffAction, E00-T03) and shows the answer. Example in CLAUDE.md, "A staff form".
 */

/** A staff form's state: its answer, and how many times it was sent, so each answer is new. */
export interface FormState<Out> {
  answer: FormAnswer<Out>;
  attempt: number;
}

/** The answer the fields read their problems from. */
const AnswerContext = createContext<FormAnswer<unknown>>(IDLE);

/** Whether the form runs in the browser never changes once it does: nothing to subscribe to. */
function subscribeToNothing() {
  return () => undefined;
}

export interface StaffFormProps<In, Out, R extends string> {
  /** The wrapper-made action, as the browser calls it: `action(clinicId, input)`. */
  action: StaffAction<In, Out, R>;
  /** What the toast says when the action is done. */
  doneMessage: string;
  /** Called with the action's value when it is done, after the toast: to close a drawer, … */
  onDone?: (value: Out) => void;
  /** A text for each of the handler's own refusals; one without a text shows the general failure. */
  refusals?: Partial<Record<R, string>>;
  submitLabel: string;
  /** The submit button's text while the action runs ("Saving…"). */
  pendingLabel: string;
  className?: string;
  /** The fields: a StaffField for each. */
  children: ReactNode;
}

/**
 * A form that sends its fields to a wrapper-made staff action and shows the answer in the standard
 * way: `invalid_input` at its fields, `forbidden` as a message, `clinic_changed` with a reload,
 * the general failure for `internal`, for a call that fails at the network and for a refusal
 * without its own text, and a toast when it is done. The message stands above the submit button.
 *
 * - **The clinic** is the frame's (useFrameClinic(), D-069): there is no prop for one, so no page
 *   can pass its own.
 * - **The bridge** (D-072, "Revisit if"): useActionState calls its action with (previous state,
 *   form data); the wrappers take (clinic id, input). A function of the form's own sits between.
 * - **Sent once:** the submit button is disabled while the action runs, and a second submit before
 *   React has disabled it is dropped, so a double click sends one request.
 * - **Not before the page's script runs:** the submit button is disabled in the server's HTML and
 *   enabled once the form runs in the browser, as the login form's (D-076). React would hold each
 *   submit made before then and send each one through the form's `action` once the script runs,
 *   past onSubmit and its guard, and then empty the fields: a double click ran the action twice
 *   (E00-T04c test finding 1). A disabled button stops Enter from submitting the form too. Its
 *   `autoComplete="off"` keeps it disabled in Firefox after a reload or Back: without it, Firefox
 *   gives the new page's button the state the old page's had, enabled, before the script runs.
 * - **Sent from onSubmit,** which dispatches the form's data itself: React's own form action empties
 *   every field after the action, an answer with field errors included (React 19 resets a form
 *   after its action). The `action` is still the dispatch, so the form is never sent to a URL.
 * - **noValidate:** a field's error shows one way, the server's, never the browser's own bubble.
 * - **Nothing kept in the browser** (owner, D-093): `autocomplete="off"` on the form, so no browser
 *   gives its fields back after a reload or Back, or offers past entries in them. After a clinic
 *   switch in another tab, a reload renders the page for the other clinic, and Firefox would put
 *   back what was typed for the first. Radix's checkbox and switch send a hidden input that they set
 *   only when they change: given back, it would send what the control does not show. No field sets
 *   an `autocomplete` of its own but `off`: WebKit gives such a field back after Back, under another
 *   clinic's page too, so nothing typed about a patient stays in the browser (D-095). A field that
 *   needs the browser's suggestions comes back to the architect first.
 */
export function StaffForm<In, Out, R extends string = never>({
  action,
  doneMessage,
  onDone,
  refusals,
  submitLabel,
  pendingLabel,
  className,
  children,
}: StaffFormProps<In, Out, R>) {
  const clinicId = useFrameClinic();
  const showToast = useToast();
  // false in the server's HTML and while the page hydrates, true once the form runs in the browser.
  const inBrowser = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);

  const [state, dispatch, pending] = useActionState(
    async (previous: FormState<Out>, formData: FormData): Promise<FormState<Out>> => {
      try {
        const answer = await sendForm(action, clinicId, formData);
        if (answer.kind === 'done') {
          showToast(doneMessage);
          onDone?.(answer.value);
        }
        return { answer, attempt: previous.attempt + 1 };
      } finally {
        sending.current = false;
      }
    },
    { answer: IDLE, attempt: 0 },
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return; // a second click or Enter while the first is on its way
    sending.current = true;
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  // After each answer, the keyboard's place: the first field with a problem, or the submit button
  // again when the focus was lost (a button that is disabled while it runs can lose it).
  useEffect(() => {
    if (state.attempt === 0) return;
    const invalid =
      state.answer.kind === 'invalid'
        ? formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
        : null;
    if (invalid) invalid.focus();
    else if (document.activeElement === null || document.activeElement === document.body) {
      submitRef.current?.focus();
    }
  }, [state]);

  const refusalText =
    state.answer.kind === 'refused' ? refusals?.[state.answer.code as R] : undefined;

  return (
    <AnswerContext value={state.answer}>
      <form
        ref={formRef}
        action={dispatch}
        onSubmit={submit}
        noValidate
        autoComplete="off"
        className={cn('grid gap-4', className)}
      >
        {children}
        {/* A new message for each answer, so a screen reader reads it again when it repeats. */}
        <FormMessage
          key={state.attempt}
          answer={state.answer}
          refusalText={refusalText}
          form={formRef}
        />
        <div>
          <Button ref={submitRef} type="submit" disabled={!inBrowser || pending} autoComplete="off">
            {pending ? pendingLabel : submitLabel}
          </Button>
        </div>
      </form>
    </AnswerContext>
  );
}

/**
 * One field of a StaffForm: its label, its control and its problem from the last answer, tied
 * together for screen readers (src/ui/field.tsx). The control is given its id, its name and the
 * problem's attributes: `render={(field) => <Input {...field} />}`. A checkbox or a switch takes
 * `orientation="horizontal"`, its label beside it.
 */
export function StaffField({
  name,
  label,
  orientation,
  className,
  render,
}: {
  /** The field's name in the form's data, as the action's input schema names it. */
  name: string;
  label: ReactNode;
  orientation?: FieldOrientation;
  className?: string;
  render: (control: FieldControlProps) => ReactNode;
}) {
  const t = useTranslations('form.fieldErrors');
  const answer = useContext(AnswerContext);
  const problem = answer.kind === 'invalid' ? answer.fields.get(name) : undefined;
  return (
    <Field
      name={name}
      label={label}
      error={problem && t(problem)}
      orientation={orientation}
      className={className}
      render={render}
    />
  );
}

/** The form's own message for an answer, above its submit button; none while idle or done. */
function FormMessage({
  answer,
  refusalText,
  form,
}: {
  answer: FormAnswer<unknown>;
  refusalText: string | undefined;
  form: { readonly current: HTMLFormElement | null };
}) {
  const t = useTranslations('form');
  if (answer.kind === 'clinic_changed') {
    return (
      <div
        role="alert"
        className="grid justify-items-start gap-2 rounded-control border border-warn-border bg-warn-bg px-3 py-2"
      >
        <p>{t('clinicChanged')}</p>
        <Button type="button" variant="secondary" onClick={() => reload(form.current)}>
          {t('reload')}
        </Button>
      </div>
    );
  }
  let text: string;
  switch (answer.kind) {
    case 'idle':
    case 'done':
      return null;
    case 'invalid':
      text = t('invalid');
      break;
    case 'forbidden':
      text = t('forbidden');
      break;
    case 'refused':
      text = refusalText ?? t('failed');
      break;
    case 'failed':
      text = t('failed');
      break;
  }
  return (
    <p role="alert" className="rounded-control bg-error-bg px-3 py-2 text-error">
      {text}
    </p>
  );
}

/**
 * Reloads the page, which then renders for the clinic chosen in the other tab (D-069). The fields
 * are emptied first: what was typed was meant for the clinic this page was shown for, and a browser
 * that refills fields after a reload (Firefox does) would offer it to the other one.
 */
function reload(form: HTMLFormElement | null): void {
  form?.reset();
  window.location.reload();
}

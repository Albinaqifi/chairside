import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Input } from '@/ui/input';
import type { ActionResult, StaffAction } from './actions';
import { IDLE, type FormAnswer } from './form-answer';
import { FrameClinic } from './frame-clinic';
import { StaffField, StaffForm, type FormState, type StaffFormProps } from './staff-form';

// E00-T04c, acceptance 2 and 5: what a staff form shows for each answer, and that it sends the
// clinic id of the frame it is in. React renders the form as the server sends it; useActionState
// is replaced so that each test chooses the form's state and gets the function the form hands it
// (the bridge to the wrapper's call shape). The texts are their keys. Every value is synthetic.

type Bridge = (previous: FormState<unknown>, formData: FormData) => Promise<FormState<unknown>>;

const form = vi.hoisted(() => ({
  state: undefined as unknown,
  pending: false,
  inBrowser: false,
  bridge: undefined as Bridge | undefined,
}));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useActionState: (bridge: Bridge, initial: unknown) => {
      form.bridge = bridge;
      return [form.state ?? initial, () => undefined, form.pending];
    },
    // React's own, which gives the server's snapshot as the server sends the form; with
    // `inBrowser`, the browser's snapshot, as React gives it once the page has hydrated.
    useSyncExternalStore: <T>(
      subscribe: (onStoreChange: () => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T => {
      const asServerSends = react.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
      return form.inBrowser ? getSnapshot() : asServerSends;
    },
  };
});

const toast = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('@/ui/toast', () => ({ useToast: () => toast.show }));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

const CLINIC_A = '01970000-0000-7000-8000-0000000000a1';
const CLINIC_B = '01970000-0000-7000-8000-0000000000b1';

type Out = { answer: string };
type DemoAction = StaffAction<unknown, Out, 'demo_refused'>;

const doneResult: ActionResult<Out, 'demo_refused'> = { ok: true, value: { answer: 'done' } };

beforeEach(() => {
  form.state = undefined;
  form.pending = false;
  form.inBrowser = false;
  form.bridge = undefined;
  toast.show.mockReset();
});

/**
 * A staff form with two fields, in a frame for `frameClinicId`, as the server renders it; with
 * `inBrowser`, as it renders once it runs in the browser.
 */
function render(
  options: {
    action?: DemoAction;
    frameClinicId?: string;
    answer?: FormAnswer<unknown>;
    pending?: boolean;
    inBrowser?: boolean;
    onDone?: (value: Out) => void;
  } = {},
): string {
  if (options.answer) form.state = { answer: options.answer, attempt: 1 };
  form.pending = options.pending ?? false;
  form.inBrowser = options.inBrowser ?? false;
  const field = (name: string): ReactNode =>
    createElement(StaffField, {
      key: name,
      name,
      label: `label.${name}`,
      render: (control) => createElement(Input, control),
    });
  // Props whose children TypeScript requires are built first, then handed to createElement.
  const props: StaffFormProps<unknown, Out, 'demo_refused'> = {
    action: options.action ?? vi.fn<DemoAction>(() => Promise.resolve(doneResult)),
    doneMessage: 'demo.done',
    onDone: options.onDone,
    refusals: { demo_refused: 'demo.refusedText' },
    submitLabel: 'demo.send',
    pendingLabel: 'demo.sending',
    children: [field('note'), field('code')],
  };
  const frame: ComponentProps<typeof FrameClinic> = {
    clinicId: options.frameClinicId ?? CLINIC_A,
    children: createElement(StaffForm<unknown, Out, 'demo_refused'>, props),
  };
  return renderToString(createElement(FrameClinic, frame));
}

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

/** The input named `name`. */
function input(html: string, name: string): Map<string, string> {
  const found = tags(html, 'input').find((attributes) => attributes.get('name') === name);
  if (!found) throw new Error(`no input named ${name}`);
  return found;
}

/** The text of the element whose id is `id`, without tags. */
function textOfId(html: string, id: string): string | undefined {
  const match = new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  return match?.[2]?.replace(/<[^>]*>/g, '');
}

/** The text of each role="alert" element, without tags. */
function alerts(html: string): string[] {
  return [...html.matchAll(/<(p|div)\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/\1>/g)].map(
    ([, , inside = '']) =>
      inside
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  );
}

function submitButton(html: string): Map<string, string> {
  const [button] = tags(html, 'button').filter((b) => b.get('type') === 'submit');
  if (!button) throw new Error('no submit button');
  return button;
}

describe('what a staff form shows for each answer (E00-T04c, acceptance 5)', () => {
  it('invalid_input: each problem at its field, tied to the control for screen readers', () => {
    const html = render({
      answer: { kind: 'invalid', fields: new Map([['code', 'invalidFormat']]) },
    });
    const code = input(html, 'code');
    expect(code.get('aria-invalid')).toBe('true');
    const errorId = code.get('aria-describedby') ?? '';
    expect(errorId).not.toBe('');
    expect(textOfId(html, errorId)).toBe('form.fieldErrors.invalidFormat');
    // The label names the control.
    const label = tags(html, 'label').find((l) => l.get('for') === code.get('id'));
    expect(label, 'a label for the code field').toBeDefined();
    // The field without a problem shows none.
    const note = input(html, 'note');
    expect(note.has('aria-invalid')).toBe(false);
    expect(note.has('aria-describedby')).toBe(false);
    // And the form says, once, that some fields need a look.
    expect(alerts(html)).toEqual(['form.invalid']);
  });

  it.each([
    { kind: 'missing', key: 'form.fieldErrors.missing' },
    { kind: 'tooSmall', key: 'form.fieldErrors.tooSmall' },
    { kind: 'tooBig', key: 'form.fieldErrors.tooBig' },
    { kind: 'other', key: 'form.fieldErrors.other' },
  ] as const)('a field that is $kind shows $key', ({ kind, key }) => {
    const html = render({ answer: { kind: 'invalid', fields: new Map([['note', kind]]) } });
    expect(textOfId(html, input(html, 'note').get('aria-describedby') ?? '')).toBe(key);
  });

  it('forbidden: a message, at no field', () => {
    const html = render({ answer: { kind: 'forbidden' } });
    expect(alerts(html)).toEqual(['form.forbidden']);
    expect(input(html, 'note').has('aria-invalid')).toBe(false);
  });

  it('clinic_changed: the reload message, with a button that reloads and sends nothing', () => {
    const html = render({ answer: { kind: 'clinic_changed' } });
    expect(alerts(html)).toEqual(['form.clinicChanged form.reload']);
    const reload = tags(html, 'button').filter((b) => b.get('type') === 'button');
    expect(reload).toHaveLength(1);
  });

  it('internal, or a call that rejected: the general failure', () => {
    expect(alerts(render({ answer: { kind: 'failed' } }))).toEqual(['form.failed']);
  });

  it("a handler's refusal with a text of its own shows that text", () => {
    const html = render({ answer: { kind: 'refused', code: 'demo_refused' } });
    expect(alerts(html)).toEqual(['demo.refusedText']);
  });

  it('a refusal without a text of its own shows the general failure', () => {
    const html = render({ answer: { kind: 'refused', code: 'not_found' } });
    expect(alerts(html)).toEqual(['form.failed']);
  });

  it('before it is sent, and when it is done, the form shows no message (a toast says done)', () => {
    expect(alerts(render({ answer: IDLE }))).toEqual([]);
    expect(alerts(render({ answer: { kind: 'done', value: { answer: 'done' } } }))).toEqual([]);
  });

  it('while the action runs, the submit button is disabled and says so', () => {
    // In the browser, where an action runs. The server's HTML is the next test's: its button is
    // disabled whatever the state (E00-T04c test finding 1).
    const running = submitButton(render({ pending: true, inBrowser: true }));
    expect(running.has('disabled')).toBe(true);
    const idle = submitButton(render({ pending: false, inBrowser: true }));
    expect(idle.has('disabled')).toBe(false);
    expect(render({ pending: true })).toContain('demo.sending');
    expect(render({ pending: false })).toContain('demo.send');
  });

  it("in the server's HTML its submit button is disabled, so nothing is sent before the script runs", () => {
    // E00-T04c test finding 1: React holds each submit made before the page's script runs and,
    // once it runs, sends each one through the form's action, past onSubmit and its guard. A
    // double click ran the action twice, and React's reset emptied the fields. A disabled button
    // stops a click and Enter alike (D-076, as the login form's).
    const html = render();
    const submitButtons = tags(html, 'button').filter(
      (button) => (button.get('type') ?? 'submit').toLowerCase() === 'submit',
    );
    const submitInputs = tags(html, 'input').filter((input) =>
      ['submit', 'image'].includes((input.get('type') ?? 'text').toLowerCase()),
    );
    expect(submitButtons, 'the submit buttons').not.toHaveLength(0);
    for (const control of [...submitButtons, ...submitInputs]) {
      expect(control.has('disabled')).toBe(true);
    }
  });

  it('in the server\'s HTML its submit button has autocomplete="off", so Firefox keeps it disabled after a reload or Back', () => {
    // E00-T04c test finding 1, in Firefox: after F5 or Back, Firefox gave the new page's button the
    // state the old page's had, enabled, before the page's script ran, so a double click and Enter
    // were held and sent three times. "off" is Firefox's own way out (MDN, the disabled
    // attribute); other browsers keep no button state.
    const html = render();
    const submitButtons = tags(html, 'button').filter(
      (button) => (button.get('type') ?? 'submit').toLowerCase() === 'submit',
    );
    const submitInputs = tags(html, 'input').filter((input) =>
      ['submit', 'image'].includes((input.get('type') ?? 'text').toLowerCase()),
    );
    expect(submitButtons, 'the submit buttons').not.toHaveLength(0);
    for (const control of [...submitButtons, ...submitInputs]) {
      expect(control.get('autocomplete')?.toLowerCase()).toBe('off');
    }
  });

  it('is a form that never goes to a URL, and leaves field checks to the server', () => {
    const [attributes] = tags(render(), 'form');
    expect(attributes?.get('action')).toMatch(/^javascript:/); // React's: a function as its action
    expect(attributes?.has('method')).toBe(false);
    expect(attributes?.has('novalidate')).toBe(true);
  });
});

describe('a staff form sends the clinic id of the frame it is in (E00-T04c, acceptance 2)', () => {
  it.each([CLINIC_A, CLINIC_B])('in a frame for %s, it sends that id', async (frameClinicId) => {
    const action = vi.fn<DemoAction>(() => Promise.resolve(doneResult));
    render({ action, frameClinicId });
    const data = new FormData();
    data.append('note', 'a note');
    await form.bridge?.({ answer: IDLE, attempt: 0 }, data);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(frameClinicId, data);
  });

  it('takes no clinic id of its own: no page can pass one', () => {
    expectTypeOf<StaffFormProps<unknown, Out, never>>().not.toHaveProperty('clinicId');
  });

  it('outside the staff frame it does not render at all', () => {
    const props: StaffFormProps<unknown, Out, never> = {
      action: vi.fn<StaffAction<unknown, Out>>(),
      doneMessage: 'demo.done',
      submitLabel: 'demo.send',
      pendingLabel: 'demo.sending',
      children: null,
    };
    const lonely = createElement(StaffForm<unknown, Out, never>, props);
    expect(() => renderToString(lonely)).toThrow(/outside the staff layout/);
  });
});

describe('the answer the bridge gives back', () => {
  it('done: a toast with the done message, then onDone with the value; a new attempt', async () => {
    const onDone = vi.fn();
    render({ onDone });
    const state = await form.bridge?.({ answer: IDLE, attempt: 2 }, new FormData());
    expect(state).toEqual({ answer: { kind: 'done', value: { answer: 'done' } }, attempt: 3 });
    expect(toast.show).toHaveBeenCalledExactlyOnceWith('demo.done');
    expect(onDone).toHaveBeenCalledExactlyOnceWith({ answer: 'done' });
  });

  it('a call that rejects: the general failure, no toast, no onDone, and the form works again', async () => {
    const onDone = vi.fn();
    render({
      action: vi.fn<DemoAction>(() => Promise.reject(new TypeError('Failed to fetch'))),
      onDone,
    });
    const state = await form.bridge?.({ answer: IDLE, attempt: 0 }, new FormData());
    expect(state).toEqual({ answer: { kind: 'failed' }, attempt: 1 });
    expect(toast.show).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a refusal: no toast, no onDone', async () => {
    const onDone = vi.fn();
    const refused: ActionResult<Out, 'demo_refused'> = {
      ok: false,
      error: { code: 'demo_refused' },
    };
    render({ action: vi.fn<DemoAction>(() => Promise.resolve(refused)), onDone });
    const state = await form.bridge?.({ answer: IDLE, attempt: 0 }, new FormData());
    expect(state?.answer).toEqual({ kind: 'refused', code: 'demo_refused' });
    expect(toast.show).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

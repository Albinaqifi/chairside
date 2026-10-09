import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/i18n/en.json';
import {
  attemptSetPassword,
  SetPasswordForm,
  setPasswordFailure,
  tokenOf,
  type SetPasswordFailure,
} from './set-password-form';

// E00-T05b, acceptance 2 and 9 below the browser: the page a setup link opens. Its form as the
// server sends it (D-076's pattern), and what it answers for each of the auth library's answers;
// the end-to-end check (tests/e2e/set-password.spec.ts) opens it in three browsers. The auth
// library's client is a stand-in that answers as each test says. Every value is synthetic.

const client = vi.hoisted(() => ({ resetPassword: vi.fn() }));
vi.mock('@/app/_lib/auth-client', () => ({ authClient: { resetPassword: client.resetPassword } }));

// The form's texts come from the message file through next-intl, which only the app's layout
// provides. Here each text is its key: the checks read no words.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const LENGTH = { min: 8, max: 128 };
const TOKEN = 'MARKER-token-6d1f';
const PASSWORD = 'MARKER-pw-6d1f-new';

beforeEach(() => {
  client.resetPassword.mockReset();
});

/** The attributes of each `tag` element in `html`, by lower-case name, as HTML reads them. */
function startTags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    // React writes every attribute as name="value", with the value escaped.
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

function renderForm() {
  const html = renderToString(createElement(SetPasswordForm, { length: LENGTH, linkDays: 3 }));
  const forms = startTags(html, 'form');
  expect(forms, 'the number of <form> elements').toHaveLength(1);
  return {
    html,
    form: forms[0] ?? new Map<string, string>(),
    inputs: startTags(html, 'input'),
    // A button without a type submits its form too.
    submitButtons: startTags(html, 'button').filter(
      (button) => (button.get('type') ?? 'submit').toLowerCase() === 'submit',
    ),
    noscripts: [...html.matchAll(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi)],
  };
}

describe("the form, in the server's HTML (D-076, as the login form)", () => {
  it('posts to its own page, with the default encoding, so no submission puts a field in the URL', () => {
    const { form } = renderForm();
    expect(form.get('method')?.toLowerCase()).toBe('post');
    expect(form.get('action')).toBe('/login/set-password');
    expect(form.has('enctype')).toBe(false);
  });

  it('sends its submit button disabled, and no enabled submit input: nothing goes before the script runs', () => {
    const { submitButtons, inputs } = renderForm();
    expect(submitButtons, 'the submit buttons').toHaveLength(1);
    for (const button of submitButtons) expect(button.has('disabled')).toBe(true);
    for (const input of inputs.filter((i) => ['submit', 'image'].includes(i.get('type') ?? ''))) {
      expect(input.has('disabled')).toBe(true);
    }
  });

  it('has one field: a new password, which password managers may fill and save', () => {
    const { inputs } = renderForm();
    expect(inputs.map((input) => Object.fromEntries(input))).toEqual([
      expect.objectContaining({
        name: 'password',
        type: 'password',
        autocomplete: 'new-password',
        'aria-describedby': 'set-password-hint',
      }),
    ]);
  });

  it('holds no token: the token stays after `#` until the script sends it', () => {
    const { html, inputs } = renderForm();
    expect(inputs.some((input) => input.get('type') === 'hidden')).toBe(false);
    expect(html).not.toMatch(/token/i);
  });

  it('says in a <noscript> line why setting a password needs JavaScript', () => {
    expect(renderForm().noscripts).toHaveLength(1);
  });
});

describe('tokenOf: the token is what follows `#`', () => {
  it.each([
    { hash: `#${TOKEN}`, token: TOKEN },
    { hash: '#', token: '' },
    { hash: '', token: '' },
  ])('"$hash" → "$token"', ({ hash, token }) => {
    expect(tokenOf(hash)).toBe(token);
  });
});

describe('setPasswordFailure: the text for each answer of the library', () => {
  it.each([
    { error: { status: 400, code: 'INVALID_TOKEN' }, failure: 'invalidLink' },
    { error: { status: 400, code: 'USER_NOT_FOUND' }, failure: 'invalidLink' },
    { error: { status: 400, code: 'PASSWORD_TOO_SHORT' }, failure: 'tooShort' },
    { error: { status: 400, code: 'PASSWORD_TOO_LONG' }, failure: 'tooLong' },
    { error: { status: 429 }, failure: 'tooManyAttempts' },
    { error: { status: 500 }, failure: 'failed' },
    { error: { status: 403, code: 'INVALID_ORIGIN' }, failure: 'failed' },
  ])('$error.status $error.code → $failure', ({ error, failure }) => {
    expect(setPasswordFailure(error)).toBe(failure);
  });

  it('has a text in the message file for every failure', () => {
    const failures: SetPasswordFailure[] = [
      'invalidLink',
      'tooShort',
      'tooLong',
      'tooManyAttempts',
      'failed',
    ];
    for (const failure of failures) expect(messages.setPassword.errors[failure]).not.toBe('');
  });
});

describe('attemptSetPassword', () => {
  it('sends the new password with the token to the library, and answers null when it is set', async () => {
    client.resetPassword.mockResolvedValue({ data: { status: true }, error: null });
    expect(await attemptSetPassword(TOKEN, PASSWORD, LENGTH)).toBeNull();
    expect(client.resetPassword).toHaveBeenCalledExactlyOnceWith({
      newPassword: PASSWORD,
      token: TOKEN,
    });
  });

  // Acceptance 2: the library answers a wrong, a used and an expired token alike (INVALID_TOKEN,
  // tests/integration/clinic-create.test.ts), and a link without a token is never sent: one text.
  it('a missing, wrong, used or expired token: the one same answer', async () => {
    client.resetPassword.mockResolvedValue({
      data: null,
      error: {
        status: 400,
        statusText: 'Bad Request',
        code: 'INVALID_TOKEN',
        message: 'Invalid token',
      },
    });
    const answers = [
      await attemptSetPassword('', PASSWORD, LENGTH),
      await attemptSetPassword(TOKEN, PASSWORD, LENGTH), // wrong, used or expired: one answer
    ];
    expect(answers).toEqual(['invalidLink', 'invalidLink']);
    expect(client.resetPassword, 'the missing token is never sent').toHaveBeenCalledTimes(1);
  });

  it('a password of a length the library refuses: said at once, whatever the link, and nothing sent', async () => {
    for (const token of [TOKEN, '']) {
      expect(await attemptSetPassword(token, 'x'.repeat(LENGTH.min - 1), LENGTH)).toBe('tooShort');
      expect(await attemptSetPassword(token, 'x'.repeat(LENGTH.max + 1), LENGTH)).toBe('tooLong');
    }
    expect(client.resetPassword).not.toHaveBeenCalled();
  });

  it('a call that fails at the network: failed, so the button works again', async () => {
    client.resetPassword.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await attemptSetPassword(TOKEN, PASSWORD, LENGTH)).toBe('failed');
  });
});

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';

// useRouter() needs the App Router, which only Next.js mounts. The server's HTML does not use it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

/**
 * The login form's HTML as the server renders it: the attributes of the form and of its submit
 * buttons and inputs, and the text of its <noscript> lines. The checks read only these, never the form's
 * English words, so the form can be translated (E00-T04) without changing a check.
 */
function renderLoginForm() {
  const html = renderToString(createElement(LoginForm));
  const forms = startTags(html, 'form');
  expect(forms, 'the number of <form> elements').toHaveLength(1);
  return {
    form: forms[0] ?? new Map<string, string>(),
    // A button without a type submits its form too.
    submitButtons: startTags(html, 'button').filter(
      (button) => (button.get('type') ?? 'submit').toLowerCase() === 'submit',
    ),
    // An input can submit its form too, and the first submit control in the form is what Enter uses.
    submitInputs: startTags(html, 'input').filter((input) =>
      ['submit', 'image'].includes((input.get('type') ?? 'text').toLowerCase()),
    ),
    noscripts: textsOf(html, 'noscript'),
  };
}

/** The attributes of each `tag` element in `html`, by lower-case name, as HTML reads them. */
function startTags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    // React writes every attribute as name="value", with the value escaped.
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

/** The text inside each `tag` element in `html`, without tags and React's comment markers. */
function textsOf(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map(
    ([, inside = '']) => inside.replace(/<!--[\s\S]*?-->|<[^>]*>/g, '').trim(),
  );
}

describe("the login form, in the server's HTML (D-076)", () => {
  it('posts: method="post", so a submission the script does not stop sends no field in the URL', () => {
    expect(renderLoginForm().form.get('method')?.toLowerCase()).toBe('post');
  });

  it("posts to /login, never to the page's own URL with whatever query string it has", () => {
    expect(renderLoginForm().form.get('action')).toBe('/login');
  });

  it('keeps the default encoding: no enctype, as Next.js answers a multipart post with an error', () => {
    expect(renderLoginForm().form.has('enctype')).toBe(false);
  });

  it('sends its submit button disabled, so nothing is sent before the script runs', () => {
    const { submitButtons } = renderLoginForm();
    expect(submitButtons, 'the submit buttons').not.toHaveLength(0);
    for (const button of submitButtons) expect(button.has('disabled')).toBe(true);
  });

  it('has no enabled submit input either, which would send the form before the script runs', () => {
    // Tester, E00-T09: an enabled <input type="submit"> or "image" ahead of the disabled button
    // would become what Enter and a click use. None today; any one must be disabled too.
    for (const input of renderLoginForm().submitInputs) expect(input.has('disabled')).toBe(true);
  });

  it('says in a <noscript> line why logging in needs JavaScript', () => {
    const { noscripts } = renderLoginForm();
    expect(noscripts, 'the <noscript> elements').toHaveLength(1);
    expect(noscripts[0]).not.toBe('');
  });
});

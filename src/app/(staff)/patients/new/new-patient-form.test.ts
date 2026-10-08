import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import type { LikelyDuplicate } from '@/modules/patients';
import { DuplicateWarning, NewPatientForm } from './new-patient-form';

// E01-T02b, acceptance 2 (the form's text), 9 and 10: the new-patient form as the server sends it,
// inside the staff frame, with next-intl's provider as the root layout gives it: the message file,
// and the clinic's time zone. useActionState is replaced so that a test can choose the form's answer,
// as in demo-form.test.ts. The tester types in a browser. Every value is synthetic.

const form = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useActionState: (_bridge: unknown, initial: unknown) => [
      form.state ?? initial,
      () => undefined,
      false,
    ],
  };
});

// The router is Next.js's, which only a running app provides: the form only hands it the list.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}));

// The actions are server code: the form only hands them to StaffForm and the check.
vi.mock('./actions', () => ({ createPatient: vi.fn(), findLikelyDuplicates: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000c1';

beforeEach(() => {
  form.state = undefined;
});

/** What the server sends for this element, in a staff frame, with the clinic's zone. */
function render(element: ReactNode, timeZone = 'Europe/Skopje'): string {
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: element };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: 'en',
    messages,
    timeZone,
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

/** The form with the answer given, as the server sends it. */
function renderForm(answer?: FormAnswer<unknown>): string {
  if (answer) form.state = { answer, attempt: 1 };
  return render(createElement(NewPatientForm));
}

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

/** The first `tag` element whose attribute `name` is `value`. */
function find(html: string, tag: string, name: string, value: string): Map<string, string> {
  const found = tags(html, tag).find((attributes) => attributes.get(name) === value);
  if (!found) throw new Error(`no ${tag} with ${name}="${value}"`);
  return found;
}

/** The text of the label for the control whose id is `id`, without tags. */
function labelFor(html: string, id: string): string | undefined {
  const match = new RegExp(`<label\\b[^>]*\\bfor="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(html);
  return match?.[1] === undefined ? undefined : text(match[1]).trim();
}

/** The text of the element whose id is `id`, without tags. */
function textOfId(html: string, id: string): string | undefined {
  const match = new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  return match?.[2] === undefined ? undefined : text(match[2]).trim();
}

/** The page's text without its tags, with the entities React writes read, runs of spaces as one. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** The text of each role="alert" element, without tags. */
function alerts(html: string): string[] {
  return [...html.matchAll(/<(p|div)\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/\1>/g)].map(
    ([, , inside = '']) => text(inside).trim(),
  );
}

const t = messages.newPatient;

describe('the new-patient form, as the server sends it (E01-T02b)', () => {
  it('holds one submit button, Add patient, and no other button', () => {
    const buttons = tags(renderForm(), 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.get('type')).toBe('submit');
    expect(renderForm()).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${t.add}</button>`));
  });

  it('keeps nothing in the browser: autocomplete="off" on its form, and no field asks for it back (acceptance 10)', () => {
    const html = renderForm();
    const [attributes] = tags(html, 'form');
    expect(attributes?.get('autocomplete')).toBe('off');
    const fields = [...tags(html, 'input'), ...tags(html, 'textarea'), ...tags(html, 'select')];
    expect(fields).toHaveLength(8);
    for (const field of fields) expect(field.get('autocomplete') ?? 'off').toBe('off');
  });

  it('names each field by its label, under the name its action reads, of the kind it takes', () => {
    const html = renderForm();
    for (const [name, label, type] of [
      ['firstName', t.firstName, undefined],
      ['lastName', t.lastName, undefined],
      ['dateOfBirth', t.dateOfBirth, 'date'],
      ['phone', t.phone, 'tel'],
      ['email', t.email, 'email'],
      ['guardianName', t.guardianName, undefined],
    ] as const) {
      const input = find(html, 'input', 'name', name);
      expect(labelFor(html, input.get('id') ?? ''), name).toBe(label);
      expect(input.get('type'), name).toBe(type);
    }
    const language = find(html, 'select', 'name', 'language');
    expect(labelFor(html, language.get('id') ?? '')).toBe(t.language);
    const notes = find(html, 'textarea', 'name', 'notes');
    expect(labelFor(html, notes.get('id') ?? '')).toBe(t.notes);
    expect(t.notes).toContain('not a clinical record');
  });

  it("offers the message file's languages, the first one chosen, by its code", () => {
    const html = renderForm();
    const options = tags(html, 'option');
    expect(options.map((option) => option.get('value'))).toEqual(Object.keys(messages.languages));
    expect(options.filter((option) => option.has('selected')).map((o) => o.get('value'))).toEqual([
      'en',
    ]);
    expect(html).toContain(`>${messages.languages.en}</option>`);
  });

  it("says under the guardian's name that the phone and email are then the guardian's (D-033)", () => {
    const html = renderForm();
    const guardian = find(html, 'input', 'name', 'guardianName');
    expect(textOfId(html, guardian.get('aria-describedby') ?? '')).toBe(t.guardianHint);
    expect(t.guardianHint).toMatch(/phone and email/);
  });

  it("with a problem at the guardian's name: the problem read first, then the line", () => {
    const html = renderForm({ kind: 'invalid', fields: new Map([['guardianName', 'tooBig']]) });
    const guardian = find(html, 'input', 'name', 'guardianName');
    expect(guardian.get('aria-invalid')).toBe('true');
    const [problem, line] = (guardian.get('aria-describedby') ?? '').split(' ');
    expect(textOfId(html, problem ?? '')).toBe(messages.form.fieldErrors.tooBig);
    expect(textOfId(html, line ?? '')).toBe(t.guardianHint);
  });

  it('an impossible phone: a message above the button that names the phone (acceptance 2)', () => {
    const html = renderForm({ kind: 'refused', code: 'phone_impossible' });
    expect(alerts(html)).toEqual([t.phoneImpossible]);
    expect(t.phoneImpossible).toMatch(/phone number/);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('type="submit"'));
    // The phone field itself is not marked: a refusal shows above the button (D-098).
    expect(find(html, 'input', 'name', 'phone').has('aria-invalid')).toBe(false);
  });

  it('a name missing: at its field, as every staff form shows it', () => {
    const html = renderForm({ kind: 'invalid', fields: new Map([['firstName', 'missing']]) });
    const first = find(html, 'input', 'name', 'firstName');
    expect(first.get('aria-invalid')).toBe('true');
    expect(textOfId(html, first.get('aria-describedby') ?? '')).toBe(
      messages.form.fieldErrors.missing,
    );
  });

  it('holds the place of the warning above the button, empty, and is not disabled', () => {
    const html = renderForm();
    const status = html.indexOf('role="status"');
    expect(status).toBeGreaterThan(html.indexOf('name="notes"'));
    expect(status).toBeLessThan(html.indexOf('type="submit"'));
    expect(html).toMatch(/<div role="status"><\/div>/);
    expect(tags(html, 'fieldset')[0]?.has('disabled')).toBe(false);
  });
});

describe('the warning: who the patient being typed may already be (D-033)', () => {
  const born: LikelyDuplicate = {
    id: '01970000-0000-7000-8000-0000000000c2',
    firstName: 'Ana',
    lastName: 'Kodra',
    dateOfBirth: '1990-01-01',
  };

  // A date of birth is a calendar date (D-098): formatted in a zone behind UTC, 1 January would
  // show as 31 December 1989. Each case names its zone, behind and ahead of UTC, and none relies on
  // the computer's (CI runs them once, in UTC: D-099).
  it.each(['America/New_York', 'Pacific/Auckland', 'UTC', 'Europe/Skopje'])(
    'names the patient and their date of birth on its own day, in %s (acceptance 9)',
    (zone) => {
      const shown = text(render(createElement(DuplicateWarning, { duplicates: [born] }), zone));
      expect(shown).toContain(' Ana Kodra, born Jan 1, 1990 ');
      expect(shown).toContain(` ${t.duplicate.heading} `);
      expect(shown).toContain(` ${t.duplicate.addAnyway} `);
    },
  );

  it('a patient without a date of birth: named, and said so', () => {
    const shown = text(
      render(
        createElement(DuplicateWarning, {
          duplicates: [
            born,
            {
              id: '01970000-0000-7000-8000-0000000000c3',
              firstName: 'Ana',
              lastName: 'Kodra',
              dateOfBirth: null,
            },
          ],
        }),
      ),
    );
    expect(shown).toContain(' Ana Kodra, born Jan 1, 1990 ');
    expect(shown).toContain(' Ana Kodra, no date of birth ');
  });

  it('no one: the region is there, empty, so a screen reader reads what appears in it', () => {
    expect(render(createElement(DuplicateWarning, { duplicates: [] }))).toBe(
      '<div role="status"></div>',
    );
  });
});

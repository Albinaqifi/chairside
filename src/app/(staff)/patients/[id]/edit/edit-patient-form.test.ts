import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { PatientProfile } from '@/modules/patients';
import type { VisitAheadRow } from './actions';
import { EditPatientForm, VisitsAhead } from './edit-patient-form';
import { editValuesOf } from './edit-values';

// E01-T03b, acceptance 4 (a field the schema settles shows at its field, a refusal above the button)
// and 7 (no field has an autocomplete of its own): the edit form as the server sends it, inside the
// staff frame, with next-intl's provider as the root layout gives it. useActionState is replaced so
// that a test can choose the form's answer, as in new-patient-form.test.ts. Every value is invented.

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

// The router is Next.js's, which only a running app provides.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}));

// The actions are server code: the form only hands them to StaffForm.
vi.mock('./actions', () => ({ updatePatient: vi.fn(), readVisitsAhead: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000c1';
const PATIENT = '01970000-0000-7000-8000-0000000000a1';

const ANA: PatientProfile = {
  id: PATIENT,
  firstName: 'Ana',
  lastName: 'Brezovska',
  dateOfBirth: '1988-03-14',
  age: 38,
  phone: '070 000 101',
  email: 'ana.brezovska@example.test',
  language: 'mk',
  guardianName: 'Mimoza Shkëmbi',
  notes: 'Prefers morning visits.',
  status: 'archived',
  createdAt: '2026-03-01T23:30:00.000Z',
};

beforeEach(() => {
  form.state = undefined;
});

function render(element: ReactNode, timeZone = 'Europe/Skopje'): string {
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: element };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone,
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

function renderForm(answer?: FormAnswer<unknown>, profile: PatientProfile = ANA): string {
  if (answer) form.state = { answer, attempt: 1 };
  return render(
    createElement(EditPatientForm, {
      patientId: profile.id,
      values: editValuesOf(profile),
      status: profile.status,
    }),
  );
}

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

function find(html: string, tag: string, name: string, value: string): Map<string, string> {
  const found = tags(html, tag).find((attributes) => attributes.get(name) === value);
  if (!found) throw new Error(`no ${tag} with ${name}="${value}"`);
  return found;
}

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

function alerts(html: string): string[] {
  return [...html.matchAll(/<(p|div)\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/\1>/g)].map(
    ([, , inside = '']) => text(inside).trim(),
  );
}

const t = messages.editPatient;

describe('the edit form, as the server sends it (E01-T03b)', () => {
  it('holds one submit button, Save changes, and no other button', () => {
    const html = renderForm();
    const buttons = tags(html, 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.get('type')).toBe('submit');
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${t.save}</button>`));
  });

  it('keeps nothing in the browser: autocomplete="off" on its form, and no field asks for it back (acceptance 7)', () => {
    const html = renderForm();
    expect(tags(html, 'form')[0]?.get('autocomplete')).toBe('off');
    const fields = [...tags(html, 'input'), ...tags(html, 'textarea'), ...tags(html, 'select')];
    // The hidden patient id, six inputs, the notes, and the language and the status.
    expect(fields).toHaveLength(10);
    for (const field of fields) expect(field.get('autocomplete') ?? 'off').toBe('off');
  });

  it("is filled with the patient's stored values, the phone as the clinic writes it", () => {
    const html = renderForm();
    for (const [name, value] of [
      ['firstName', 'Ana'],
      ['lastName', 'Brezovska'],
      ['dateOfBirth', '1988-03-14'],
      ['phone', '070 000 101'],
      ['email', 'ana.brezovska@example.test'],
      ['guardianName', 'Mimoza Shkëmbi'],
    ]) {
      expect(find(html, 'input', 'name', name ?? '').get('value'), name).toBe(value);
    }
    expect(html).toContain('>Prefers morning visits.</textarea>');
    const chosen = tags(html, 'option').filter((option) => option.has('selected'));
    expect(chosen.map((option) => option.get('value'))).toEqual(['mk', 'archived']);
  });

  it('sends the patient it edits as a hidden id, and offers the three statuses', () => {
    const html = renderForm();
    expect(find(html, 'input', 'name', 'patientId').get('value')).toBe(PATIENT);
    expect(find(html, 'input', 'name', 'patientId').get('type')).toBe('hidden');
    const status = /<select[^>]*name="status"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? '';
    expect(text(status).trim()).toBe('Active Archived Deceased');
    expect(tags(status, 'option').map((option) => option.get('value'))).toEqual([
      'active',
      'archived',
      'deceased',
    ]);
  });

  it('a patient with nothing optional: the fields start empty, never a made-up value', () => {
    const html = renderForm(undefined, {
      ...ANA,
      dateOfBirth: null,
      phone: null,
      email: null,
      guardianName: null,
      notes: '',
      status: 'active',
    });
    for (const name of ['dateOfBirth', 'phone', 'email', 'guardianName']) {
      expect(find(html, 'input', 'name', name).get('value') ?? '', name).toBe('');
    }
    expect(html).toContain('></textarea>');
  });

  it.each([
    ['phone_impossible', t.phoneImpossible],
    ['nothing_changed', t.nothingChanged],
    ['visits_ahead', t.visitsAhead],
  ])('%s: its text above the button, and nothing marked at a field', (code, shown) => {
    const html = renderForm({ kind: 'refused', code });
    expect(alerts(html)).toEqual([shown]);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('type="submit"'));
    expect(tags(html, 'input').some((field) => field.has('aria-invalid'))).toBe(false);
  });

  it('a name missing, or an email that is no email: at its field, as every staff form shows it', () => {
    const html = renderForm({
      kind: 'invalid',
      fields: new Map([
        ['firstName', 'missing'],
        ['email', 'invalidFormat'],
      ]),
    });
    expect(find(html, 'input', 'name', 'firstName').get('aria-invalid')).toBe('true');
    expect(find(html, 'input', 'name', 'email').get('aria-invalid')).toBe('true');
  });

  it('holds the place of the visits ahead above the button, empty', () => {
    const html = renderForm();
    const status = html.indexOf('role="status"');
    expect(status).toBeGreaterThan(html.indexOf('name="status"'));
    expect(status).toBeLessThan(html.indexOf('type="submit"'));
    expect(html).toMatch(/<div role="status"><\/div>/);
  });
});

describe('the visits ahead that stand in the way (acceptance 8)', () => {
  const visit: VisitAheadRow = {
    id: '01970000-0000-7000-8000-0000000000b1',
    // 08:05 UTC on Friday 9 October 2026: 10:05 in Skopje, 21:05 in Auckland, 01:05 in Los Angeles.
    startsAt: '2026-10-09T08:05:00.000Z',
    what: 'Filling',
    providerName: 'Elena Planinska',
  };

  // A moment is shown in the clinic's zone and on the 24-hour clock; each case names its zone and
  // none relies on the computer's (D-098, D-099).
  it.each([
    ['Europe/Skopje', 'Fri, Oct 9, 10:05'],
    ['Pacific/Auckland', 'Fri, Oct 9, 21:05'],
    ['America/Los_Angeles', 'Fri, Oct 9, 01:05'],
  ])('lists the visit with its day, time, treatment and provider, in %s', (zone, when) => {
    const shown = text(render(createElement(VisitsAhead, { visits: [visit] }), zone));
    expect(shown).toContain(` ${t.ahead.heading} `);
    expect(shown).toContain(` ${when}: Filling with Elena Planinska `);
    expect(shown).toContain(` ${t.ahead.cancelFirst} `);
  });

  it('no visit: the region is there, empty, so a screen reader reads what appears in it', () => {
    expect(render(createElement(VisitsAhead, { visits: [] }))).toBe('<div role="status"></div>');
  });
});

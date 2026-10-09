import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import type { PatientList as List, PatientRow } from '@/modules/patients';
import { PatientList, PatientTable } from './patient-list';

// E01-T02a: the patient list as the server sends it, inside the staff frame, with next-intl's
// provider as the root layout gives it: the message file, and the time zone src/i18n/request.ts
// sets. React renders it as the server does; the tester types in a browser. Every value is
// synthetic: names from the invented lists, numbers from the seed's made-up block.

// The read is server code: the list only hands it to sendSearch.
vi.mock('./actions', () => ({ searchPatients: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000b1';

function row(fields: Partial<PatientRow> = {}): PatientRow {
  return {
    id: '01970000-0000-7000-8000-0000000000b2',
    firstName: 'Ana',
    lastName: 'Kodra',
    status: 'active',
    age: 38,
    phone: '070 001 234',
    lastVisit: null,
    nextVisit: null,
    ...fields,
  };
}

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

function list(fields: Partial<List> = {}): ReactNode {
  return createElement(PatientList, {
    initial: { total: 1, rows: [row()], more: false, ...fields },
    canImport: false,
  });
}

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

/** The page's text without its tags, with the narrow spaces Intl puts before AM and PM as spaces. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/[\s ]+/g, ' ');
}

describe('the search box (E01-T02a, D-095)', () => {
  it('keeps nothing in the browser: autocomplete="off", in no form, with no name', () => {
    const html = render(list());
    expect(html).not.toMatch(/<form\b/i);
    const inputs = tags(html, 'input');
    expect(inputs).toHaveLength(1);
    const [box] = inputs;
    expect(box?.get('type')).toBe('search');
    expect(box?.get('autocomplete')).toBe('off');
    expect(box?.has('name')).toBe(false);
    expect(box?.get('aria-label')).toBe('Search patients');
    expect(box?.get('maxlength')).toBe('100');
  });

  it('beside it the filter All, pressed; every button is type="button"', () => {
    const html = render(list());
    const buttons = tags(html, 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.get('type')).toBe('button');
    expect(buttons[0]?.get('aria-pressed')).toBe('true');
    expect(html).toMatch(/<button[^>]*>All<\/button>/);
  });
});

describe('above the rows', () => {
  it("the count of the clinic's patients", () => {
    expect(text(render(list({ total: 1 })))).toContain(' 1 patient ');
    expect(text(render(list({ total: 1146 })))).toContain(' 1,146 patients ');
  });

  it('and how many are shown, when more patients match than the rows hold', () => {
    const rows = Array.from({ length: 50 }, (_, n) =>
      row({ id: `01970000-0000-7000-8000-${String(n).padStart(12, '0')}` }),
    );
    expect(text(render(list({ total: 1146, rows, more: true })))).toContain(
      ' 1,146 patients · showing the first 50 ',
    );
  });

  it('Import from Excel, to the import page, for whoever the sidebar shows Import to', () => {
    const initial: List = { total: 1, rows: [row()], more: false };
    const shown = render(createElement(PatientList, { initial, canImport: true }));
    expect(shown).toMatch(/<a[^>]*href="\/import"[^>]*>Import from Excel<\/a>/);
    const hidden = render(createElement(PatientList, { initial, canImport: false }));
    expect(hidden).not.toContain('Import from Excel');
    expect(hidden).not.toContain('href="/import"');
  });
});

describe('the rows', () => {
  it('the name, and under it the age and the phone, or No phone', () => {
    const html = render(
      createElement(PatientTable, {
        query: '',
        rows: [
          row({ id: '01970000-0000-7000-8000-0000000000c1' }),
          row({ id: '01970000-0000-7000-8000-0000000000c2', age: 1, phone: null }),
          row({ id: '01970000-0000-7000-8000-0000000000c3', age: null, phone: null }),
          row({ id: '01970000-0000-7000-8000-0000000000c4', age: null }),
        ],
      }),
    );
    const shown = text(html);
    expect(shown).toContain(' Ana Kodra 38 years · 070 001 234 ');
    expect(shown).toContain(' Ana Kodra 1 year · No phone ');
    expect(shown).toContain(' Ana Kodra No phone ');
    expect(shown).toContain(' Ana Kodra 070 001 234 ');
  });

  it('an archived or a deceased patient is marked, an active one is not', () => {
    const html = render(
      createElement(PatientTable, {
        query: '',
        rows: [
          row({ id: '01970000-0000-7000-8000-0000000000d1', status: 'archived' }),
          row({ id: '01970000-0000-7000-8000-0000000000d2', status: 'deceased' }),
          row({ id: '01970000-0000-7000-8000-0000000000d3', status: 'active' }),
        ],
      }),
    );
    expect(html).toMatch(/<span[^>]*data-variant="archived"[^>]*>Archived<\/span>/);
    expect(html).toMatch(/<span[^>]*data-variant="deceased"[^>]*>Deceased<\/span>/);
    expect(tags(html, 'span').filter((span) => span.get('data-slot') === 'badge')).toHaveLength(2);
  });

  it('a dash where there is no visit', () => {
    const shown = text(render(createElement(PatientTable, { query: '', rows: [row()] })));
    expect(shown).toContain(' 070 001 234 — — ');
  });

  it('an empty state when nothing matches, and when the clinic has no patients yet', () => {
    expect(text(render(createElement(PatientTable, { query: 'Zz', rows: [] })))).toContain(
      'No patients match “Zz”.',
    );
    expect(text(render(createElement(PatientTable, { query: '', rows: [] })))).toContain(
      'No patients yet.',
    );
  });
});

describe("a visit's date and time, in the clinic's time zone whatever the computer's (E01-T02a)", () => {
  // The last visit at 23:30 UTC on 12 March: 13 March in Skopje and in Auckland. The next at 08:00
  // UTC on Friday 9 October: 10:00 in Skopje (summer time), 21:00 in Auckland (daylight time). The
  // computer runs in one zone only, so the three cases cannot all pass when the zone is the
  // computer's, wherever they run (CI runs them once, in UTC: D-099).
  const visits = row({
    lastVisit: '2026-03-12T23:30:00.000Z',
    nextVisit: '2026-10-09T08:00:00.000Z',
  });

  it.each([
    { zone: 'Europe/Skopje', last: 'Mar 13, 2026', next: 'Fri, Oct 9, 10:00 AM' },
    { zone: 'Pacific/Auckland', last: 'Mar 13, 2026', next: 'Fri, Oct 9, 9:00 PM' },
    { zone: 'UTC', last: 'Mar 12, 2026', next: 'Fri, Oct 9, 8:00 AM' },
  ])('a clinic in $zone: $last, and $next', ({ zone, last, next }) => {
    const shown = text(render(createElement(PatientTable, { query: '', rows: [visits] }), zone));
    expect(shown).toContain(` ${last} ${next} `);
  });
});

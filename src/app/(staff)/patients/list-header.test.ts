import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { PatientList as List } from '@/modules/patients';
import { PatientList } from './patient-list';

// E01-T02b: the patient list's header, as the server sends it, with New patient beside Import from
// Excel for whoever has patients.manage (every member, scope-v1.md). The rest of the list is
// patient-list.test.ts's. Every value is synthetic.

// The read is server code: the list only hands it to sendSearch.
vi.mock('./actions', () => ({ searchPatients: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000b1';
const INITIAL: List = { total: 0, rows: [], more: false };

function render(props: { canImport: boolean; canAdd?: boolean }): string {
  const list: ReactNode = createElement(PatientList, { initial: INITIAL, ...props });
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: list };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: 'Europe/Skopje',
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

const NEW_PATIENT = /<a[^>]*href="\/patients\/new"[^>]*>New patient<\/a>/;

describe('the header of the patient list (E01-T02b)', () => {
  it('New patient, to the new-patient page, for whoever has patients.manage', () => {
    expect(render({ canImport: false, canAdd: true })).toMatch(NEW_PATIENT);
  });

  it('beside Import from Excel, after it', () => {
    const html = render({ canImport: true, canAdd: true });
    expect(html).toMatch(NEW_PATIENT);
    expect(html.indexOf('href="/import"')).toBeLessThan(html.indexOf('href="/patients/new"'));
  });

  it('hidden without patients.manage, and when the page does not say', () => {
    for (const html of [render({ canImport: true, canAdd: false }), render({ canImport: true })]) {
      expect(html).not.toContain('href="/patients/new"');
      expect(html).toContain('href="/import"');
    }
  });

  it('a link, not a button: the list still holds one button, the filter All', () => {
    const html = render({ canImport: true, canAdd: true });
    expect(html.match(/<button\b/g)).toHaveLength(1);
  });
});

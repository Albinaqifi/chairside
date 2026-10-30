import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import { CANCEL_REASON_MAX } from '@/modules/scheduling';
import { Dialog } from '@/ui/dialog';
import { CancelDialogContent } from './cancel-dialog';
import { CANCEL_REASON_LIMIT } from './cancel-reason';

// E01-T06e: the cancel dialog's content as the server renders it, open, in the staff frame. The
// dialog opens in a portal, which renders nothing on the server: here Radix's Portal renders in
// place, as in appointment-drawer.test.ts. useActionState is replaced so a test can choose the
// form's answer. The press on Cancel, the focus, the held answer and the written row are in
// tests/e2e/appointment-cancel.spec.ts. The ids are made up.

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
beforeEach(() => {
  form.state = undefined;
});

// The action is server code: the form only hands it to StaffForm.
vi.mock('./appointment-actions', () => ({ changeAppointmentStatus: vi.fn() }));

vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('radix-ui')>();
  const inPlace = ({ children }: { children?: ReactNode }) => children ?? null;
  return { ...actual, Dialog: { ...actual.Dialog, Portal: inPlace } };
});

const CLINIC = '01970000-0000-7000-8000-0000000000f6';
const VISIT = '01970000-0000-7000-8000-0000000005a1';

function render(answer?: FormAnswer<unknown>): string {
  if (answer) form.state = { answer, attempt: 1 };
  const dialog = createElement(
    Dialog,
    { open: true },
    createElement(CancelDialogContent, {
      appointmentId: VISIT,
      onDone: vi.fn(),
      onCloseAutoFocus: vi.fn(),
    }),
  );
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: dialog };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: 'Europe/Skopje',
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

/** The page's text without its tags. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('the cancel dialog (acceptance 1 and 2)', () => {
  it('is a dialog named for the cancel, with one form that holds the visit and the cancel hidden', () => {
    const html = render();
    expect(html).toMatch(/role="dialog"/);
    expect(text(html)).toContain('Cancel this visit');
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(html).toContain(`name="appointmentId" value="${VISIT}"`);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="action"[^>]*value="cancel"/);
    // The one send of the dialog: a form posts to a function and keeps nothing in the browser.
    expect(html.match(/<button[^>]*type="submit"[^>]*>([^<]*)<\/button>/g)).toHaveLength(1);
    expect(html).toMatch(/autoComplete="off"|autocomplete="off"/i);
  });

  it('asks who cancelled with no choice made: an empty option first and selected, then the patient, then the clinic (D-123)', () => {
    const html = render();
    const select = /<select[^>]*name="cancelledBy"[^>]*>([\s\S]*?)<\/select>/.exec(html);
    expect(select, 'a select named cancelledBy').not.toBeNull();
    const options = [...(select?.[1] ?? '').matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(
      ([, attributes = '', label = '']) => ({
        value: /value="([^"]*)"/.exec(attributes)?.[1],
        label,
      }),
    );
    expect(options).toEqual([
      { value: '', label: 'Choose who cancelled' },
      { value: 'patient', label: 'The patient' },
      { value: 'staff', label: 'The clinic' },
    ]);
    // Nothing is preselected but the empty choice.
    expect(select?.[1]).not.toMatch(/<option[^>]*value="(patient|staff)"[^>]*selected/);
    expect(text(html)).toContain('Who cancelled');
  });

  it('has an optional reason, a textarea that takes at most what the action takes', () => {
    const html = render();
    const reason = /<textarea[^>]*name="reason"[^>]*>/.exec(html);
    expect(reason, 'a textarea named reason').not.toBeNull();
    expect(reason?.[0]).toContain(`maxLength="${CANCEL_REASON_LIMIT}"`);
    expect(reason?.[0]).not.toMatch(/required/);
    expect(text(html)).toContain('Reason (optional)');
  });

  it("the textarea's limit is the module's, which the action's schema checks", () => {
    expect(CANCEL_REASON_LIMIT).toBe(CANCEL_REASON_MAX);
  });

  it('a send with nothing chosen shows "Fill this in." at the field', () => {
    const html = render({ kind: 'invalid', fields: new Map([['cancelledBy', 'missing']]) });
    const select = /<select[^>]*name="cancelledBy"[^>]*>/.exec(html);
    expect(select?.[0]).toContain('aria-invalid="true"');
    expect(text(html)).toContain('Fill this in.');
  });

  it.each([
    ['not_allowed', 'This visit was changed meanwhile. Look at it again.'],
    ['not_found', 'This visit is no longer there.'],
  ])('%s shows its text above the button, the dialog as it is', (code, expected) => {
    const html = render({ kind: 'refused', code });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(expected);
  });
});

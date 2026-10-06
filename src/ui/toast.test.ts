import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TOAST_DURATION_MS, Toaster, useToast, type ShowToast } from './toast';

// E00-T04c: the toast. One at a time, the next replacing it, gone after 3.4 s, at the bottom
// centre: the tester checks these in a browser; here, what holds without one. Texts are their keys.

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string>) =>
    `${namespace}.${key}${values ? JSON.stringify(values) : ''}`,
}));

/** Hands the function useToast() gives to `found`. */
function Probe({ found }: { found: (show: ShowToast) => void }) {
  found(useToast());
  return null;
}

/** The toast function a component gets, rendered inside a Toaster or not. */
function toastFunction(inToaster: boolean): ShowToast | undefined {
  let shown: ShowToast | undefined;
  const probe = createElement(Probe, { found: (show) => (shown = show) });
  renderToString(inToaster ? toaster(probe) : probe);
  return shown;
}

function toaster(children: ReactNode) {
  // Toaster requires its children: built as props first, then handed to createElement.
  const props = { children };
  return createElement(Toaster, props);
}

describe('the toast', () => {
  it("lasts the demo's 3.4 seconds", () => {
    expect(TOAST_DURATION_MS).toBe(3400);
  });

  it('names its region from the message file, with the key that moves the focus to it', () => {
    const html = renderToString(toaster(null));
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="toast.region{&quot;hotkey&quot;:&quot;F8&quot;}"');
  });

  it('inside a Toaster, useToast gives a function that shows one', () => {
    const show = toastFunction(true);
    expect(show).toBeTypeOf('function');
    expect(() => show?.('Saved.')).not.toThrow(/no Toaster/);
  });

  it('without a Toaster, a component that shows toasts still renders, and showing one fails loudly', () => {
    const show = toastFunction(false);
    expect(show).toBeTypeOf('function');
    expect(() => show?.('Saved.')).toThrow(/no Toaster/);
  });
});

import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FrameClinic, framesAnotherClinic, PageClinic, useFrameClinic } from './frame-clinic';

// E00-T04c: the clinic the staff frame names, which every form sends (D-069), and the page-side
// check that refreshes a frame naming another clinic. The browser's side, two tabs and a sidebar
// link, is the tester's. Every value is synthetic.

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const CLINIC_A = '01970000-0000-7000-8000-0000000000a1';
const CLINIC_B = '01970000-0000-7000-8000-0000000000b1';

/** Renders the clinic id useFrameClinic() gives, as text. */
function Probe() {
  return useFrameClinic();
}

/** A frame for `clinicId` around `children`. */
function frame(clinicId: string, children: ReactNode) {
  // FrameClinic requires its children: built as props first, then handed to createElement.
  const props = { clinicId, children };
  return createElement(FrameClinic, props);
}

describe('the frame clinic', () => {
  it('is the clinic the staff layout rendered for', () => {
    expect(renderToString(frame(CLINIC_A, createElement(Probe)))).toBe(CLINIC_A);
  });

  it("is the innermost frame's when one sits in another", () => {
    const html = renderToString(frame(CLINIC_A, frame(CLINIC_B, createElement(Probe))));
    expect(html).toBe(CLINIC_B);
  });

  it('does not exist outside the staff layout: asking for it is an error', () => {
    expect(() => renderToString(createElement(Probe))).toThrow(/outside the staff layout/);
  });
});

describe('framesAnotherClinic: when a page refreshes its frame', () => {
  it.each([
    { frame: CLINIC_A, page: CLINIC_B, refresh: true },
    { frame: CLINIC_A, page: CLINIC_A, refresh: false },
    { frame: null, page: CLINIC_A, refresh: false },
  ])('frame $frame, page $page → $refresh', ({ frame, page, refresh }) => {
    expect(framesAnotherClinic(frame, page)).toBe(refresh);
  });
});

describe('PageClinic', () => {
  it('shows nothing', () => {
    const html = renderToString(frame(CLINIC_A, createElement(PageClinic, { clinicId: CLINIC_B })));
    expect(html).toBe('');
  });
});

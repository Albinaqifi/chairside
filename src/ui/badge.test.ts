import fs from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge, type BadgeVariant } from './badge';

// The status pill (E00-T04b). Tailwind makes no CSS for a class whose colour the theme lacks, and
// says nothing: each variant's classes must name colour tokens src/app/globals.css defines.

const theme = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const VARIANTS: BadgeVariant[] = [
  'booked',
  'no-reply',
  'confirmed',
  'arrived',
  'completed',
  'cancelled',
  'no-show',
  // E01-T02a: a patient's status, in the patient list.
  'archived',
  'deceased',
];

/** The class attribute of the badge as the server renders it. */
function classOf(variant: BadgeVariant, className?: string): string[] {
  const html = renderToString(createElement(Badge, { variant, className }, 'x'));
  return (/\bclass="([^"]*)"/.exec(html)?.[1] ?? '').split(' ');
}

describe('Badge, the status pill', () => {
  it.each(VARIANTS)(
    '%s: its background and text are the status colours the theme defines',
    (variant) => {
      const classes = classOf(variant);
      expect(classes).toContain(`bg-status-${variant}-bg`);
      expect(classes).toContain(`text-status-${variant}-fg`);
      expect(theme).toContain(`--color-status-${variant}-bg:`);
      expect(theme).toContain(`--color-status-${variant}-fg:`);
    },
  );

  it("is the demo's pill: a caption in weight 600 on the pill radius", () => {
    expect(classOf('booked')).toEqual(
      expect.arrayContaining(['rounded-pill', 'text-caption', 'font-semibold']),
    );
  });

  it("names its status, and takes a caller's class over its own", () => {
    const html = renderToString(createElement(Badge, { variant: 'confirmed' }, 'x'));
    expect(html).toContain('data-variant="confirmed"');
    expect(classOf('confirmed', 'text-small')).toContain('text-small');
    expect(classOf('confirmed', 'text-small')).not.toContain('text-caption');
  });
});

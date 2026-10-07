import fs from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger, type TabsTriggerProps } from './tabs';

// E00-T04e: the tabs, as the server renders them. That the arrow keys move between them, and how
// they look next to the demo's settings tab bar, are checked in a browser (the screenshots next to
// the handoff note); here, what holds without one. Tailwind makes no CSS for a class whose colour
// the theme lacks, and says nothing: each token the tabs' classes name must be in globals.css.

const theme = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const VALUES = ['first', 'second', 'third'] as const;

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

function classesOf(attributes: Map<string, string> | undefined): string[] {
  return (attributes?.get('class') ?? '').split(' ');
}

/**
 * Three tabs, the second chosen, inside a form as a staff form's tabs would be, as the server
 * renders them; `told` goes to every tab, past the type checker.
 */
function render(told: Record<string, unknown> = {}): string {
  const triggers = VALUES.map((value) =>
    createElement(TabsTrigger, { key: value, value, ...told } as TabsTriggerProps, `${value} tab`),
  );
  const contents = VALUES.map((value) =>
    createElement(TabsContent, { key: value, value }, `${value} content`),
  );
  const list = createElement(TabsList, { 'aria-label': 'demo tabs' }, ...triggers);
  return renderToString(
    createElement('form', null, createElement(Tabs, { defaultValue: 'second' }, list, ...contents)),
  );
}

/** The `tag` elements whose data-slot is `name`. */
function slot(html: string, tag: string, name: string): Map<string, string>[] {
  return tags(html, tag).filter((attributes) => attributes.get('data-slot') === name);
}

describe('Tabs', () => {
  it('makes each tab a button of role tab; the chosen one is selected and names its content', () => {
    const html = render();
    const tabs = tags(html, 'button');
    expect(tabs.map((tab) => tab.get('role'))).toEqual(['tab', 'tab', 'tab']);
    expect(tabs.map((tab) => tab.get('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs.map((tab) => tab.get('data-state'))).toEqual(['inactive', 'active', 'inactive']);
    expect(
      tags(html, 'div')
        .find((div) => div.get('role') === 'tablist')
        ?.get('aria-label'),
    ).toBe('demo tabs');
    const shown = tags(html, 'div').find((div) => div.get('data-state') === 'active');
    expect(shown?.get('role')).toBe('tabpanel');
    expect(shown?.get('id')).toBe(tabs[1]?.get('aria-controls'));
    expect(shown?.get('aria-labelledby')).toBe(tabs[1]?.get('id'));
  });

  it("holds only the chosen tab's content: another tab's is off the page, so a form never spans two tabs", () => {
    const html = render();
    expect(html).toContain('second content');
    expect(html).not.toContain('first content');
    expect(html).not.toContain('third content');
    const panels = tags(html, 'div').filter((div) => div.get('role') === 'tabpanel');
    expect(panels.map((panel) => panel.has('hidden'))).toEqual([true, false, true]);
  });

  it('never submits its form: each tab is type="button", even when a caller says otherwise', () => {
    expect(tags(render(), 'button').map((tab) => tab.get('type'))).toEqual([
      'button',
      'button',
      'button',
    ]);
    // `type` is not among a tab's props; past the type checker, each tab still says "button".
    const toldSubmit = tags(render({ type: 'submit' }), 'button');
    expect(toldSubmit.map((tab) => tab.get('type'))).toEqual(['button', 'button', 'button']);
  });

  it("is the demo's bar: a 1 px border line under it; the chosen tab in the text colour at 600 over a 2 px primary line, the others muted at 500", () => {
    const html = render();
    expect(classesOf(slot(html, 'div', 'tabs')[0])).toEqual(
      expect.arrayContaining(['flex', 'flex-col', 'gap-5']),
    );
    expect(classesOf(slot(html, 'div', 'tabs-list')[0])).toEqual(
      expect.arrayContaining(['flex', 'flex-wrap', 'gap-1', 'border-b', 'border-border']),
    );
    for (const tab of slot(html, 'button', 'tabs-trigger')) {
      expect(classesOf(tab)).toEqual(
        expect.arrayContaining([
          '-mb-px',
          'border-b-2',
          'border-transparent',
          'px-3.5',
          'py-2.5',
          'font-medium',
          'text-muted',
          'data-[state=active]:border-primary',
          'data-[state=active]:font-semibold',
          'data-[state=active]:text-text',
        ]),
      );
    }
    expectThemeDefines('--color-border', '--color-primary', '--color-text', '--color-muted');
  });

  it("shows keyboard focus on a tab and on its content as Button's outline, never the browser's own", () => {
    const html = render();
    const focusOutline = [
      'outline-none',
      'focus-visible:outline-2',
      'focus-visible:outline-offset-2',
      'focus-visible:outline-focus',
      'focus-visible:outline-solid',
    ];
    for (const tab of slot(html, 'button', 'tabs-trigger')) {
      expect(classesOf(tab)).toEqual(expect.arrayContaining(focusOutline));
    }
    const content = slot(html, 'div', 'tabs-content').find((div) => !div.has('hidden'));
    expect(content?.get('tabindex')).toBe('0');
    expect(classesOf(content)).toEqual(expect.arrayContaining(focusOutline));
    expectThemeDefines('--color-focus');
  });

  it('leaves out of its props what would break it: formAction, formMethod, type, forceMount, a vertical bar', () => {
    expectTypeOf<TabsTriggerProps>().not.toHaveProperty('formAction');
    expectTypeOf<TabsTriggerProps>().not.toHaveProperty('formMethod');
    expectTypeOf<TabsTriggerProps>().not.toHaveProperty('type');
    expectTypeOf<Parameters<typeof TabsContent>[0]>().not.toHaveProperty('forceMount');
    expectTypeOf<Parameters<typeof Tabs>[0]>().not.toHaveProperty('orientation');
  });
});

function expectThemeDefines(...tokens: string[]): void {
  for (const token of tokens) expect(theme, token).toContain(`${token}:`);
}

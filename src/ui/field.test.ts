import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field } from './field';
import { Input } from './input';

// E00-T04c: a field shows its label, its control and its error, tied together for screen readers.
// E00-T04d: horizontal, its label stands beside the control (a checkbox, a switch), with the same ties.

/** The attributes of the first `tag` element in `html`, by name. */
function first(html: string, tag: string): Map<string, string> {
  const inside = new RegExp(`<${tag}\\b([^>]*)>`, 'i').exec(html)?.[1] ?? '';
  const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
  return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
}

function render(error?: string): string {
  return renderToString(
    createElement(Field, {
      name: 'note',
      label: 'A note',
      error,
      render: (control) => createElement(Input, control),
    }),
  );
}

describe('Field', () => {
  it('gives the control the id its label names, and its name', () => {
    const html = render();
    const control = first(html, 'input');
    expect(control.get('id')).not.toBe('');
    expect(first(html, 'label').get('for')).toBe(control.get('id'));
    expect(control.get('name')).toBe('note');
  });

  it('without an error: the control is not invalid and describes nothing', () => {
    const control = first(render(), 'input');
    expect(control.has('aria-invalid')).toBe(false);
    expect(control.has('aria-describedby')).toBe(false);
    expect(render('')).not.toContain('field-error');
  });

  it('with an error: the control is invalid and is described by the error, shown under it', () => {
    const html = render('Fill this in.');
    const control = first(html, 'input');
    expect(control.get('aria-invalid')).toBe('true');
    const errorId = control.get('aria-describedby') ?? '';
    expect(html).toMatch(new RegExp(`<p id="${errorId}"[^>]*>Fill this in\\.</p>`));
    expect(html.indexOf('<input')).toBeLessThan(html.indexOf(`id="${errorId}"`));
  });

  it('vertical by default: the label above its control', () => {
    const html = render();
    expect(html).toContain('data-orientation="vertical"');
    expect(html.indexOf('<label')).toBeLessThan(html.indexOf('<input'));
  });

  it('horizontal (a checkbox, a switch): the label beside its control, after it, still naming it', () => {
    const html = renderToString(
      createElement(Field, {
        name: 'agreed',
        label: 'Agreed',
        orientation: 'horizontal',
        render: (control) => createElement(Input, { ...control, type: 'checkbox' }),
      }),
    );
    expect(html).toContain('data-orientation="horizontal"');
    const control = first(html, 'input');
    expect(first(html, 'label').get('for')).toBe(control.get('id'));
    expect(control.get('name')).toBe('agreed');
    expect(html.indexOf('<input')).toBeLessThan(html.indexOf('<label'));
  });

  it('horizontal with an error: the control is invalid and described by the error, under both', () => {
    const html = renderToString(
      createElement(Field, {
        label: 'Agreed',
        error: 'Tick this.',
        orientation: 'horizontal',
        render: (control) => createElement(Input, { ...control, type: 'checkbox' }),
      }),
    );
    const control = first(html, 'input');
    expect(control.get('aria-invalid')).toBe('true');
    const errorId = control.get('aria-describedby') ?? '';
    expect(html).toMatch(new RegExp(`<p id="${errorId}"[^>]*>Tick this\\.</p>`));
    expect(html.indexOf('</label>')).toBeLessThan(html.indexOf(`id="${errorId}"`));
  });

  it('gives two fields different ids', () => {
    const html = renderToString(
      createElement(
        'div',
        null,
        createElement(Field, { label: 'A', render: (c) => createElement(Input, c) }),
        createElement(Field, { label: 'B', render: (c) => createElement(Input, c) }),
      ),
    );
    const ids = [...html.matchAll(/<input\b[^>]*\bid="([^"]*)"/g)].map(([, id]) => id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

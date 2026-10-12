import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { ROLES } from '@/modules/auth';
import messages from './en.json';
import { LOCALE } from './locale';

/** Every text of the message file under its full key, such as ['login.title', 'Log in · Chairside']. */
function texts(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error(`${prefix} is neither a text nor a group of texts`);
  }
  return Object.entries(node).flatMap(([name, value]) =>
    texts(value, prefix ? `${prefix}.${name}` : name),
  );
}

describe('the message file, src/i18n/en.json', () => {
  it('names every role, and no role that does not exist', () => {
    expect(Object.keys(messages.roles).sort()).toEqual([...ROLES].sort());
  });

  it('holds only texts, none of them empty', () => {
    const all = texts(messages);
    expect(all.length).toBeGreaterThan(0);
    for (const [key, text] of all) expect(text.trim(), key).not.toBe('');
  });

  it('holds only messages next-intl can format: a broken one would fail its page', () => {
    const errors: string[] = [];
    const t = createTranslator({
      locale: LOCALE,
      messages,
      onError: (error) => errors.push(error.code),
    });
    for (const [key, text] of texts(messages)) {
      // A value for each {argument} the message takes.
      const values = Object.fromEntries(
        [...text.matchAll(/\{\s*(\w+)/g)].map(([, name = '']) => [name, 'x']),
      );
      expect(t(key as never, values as never), key).not.toBe('');
    }
    expect(errors).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CLINIC_NAMES,
  EMAIL_DOMAIN,
  fakeDataProblems,
  fakePhone,
  FIRST_NAMES,
  isFakeEmail,
  isFakeName,
  isFakePhone,
  LAST_NAMES,
  STAFF_NAMES,
} from './fake-data';
import { SEED_FILES, type SeedFile } from './seed-files';

// E00-T05a, acceptance 4: the fake-data rules, and every row of every seed file read against them.
// A later seed file is checked here as soon as it is in SEED_FILES, without a new test.

describe('every row each seed file writes keeps the fake-data rules', () => {
  it('there is a seed file to check', () => {
    expect(SEED_FILES.length).toBeGreaterThan(0);
  });

  it.each(SEED_FILES.map((file) => ({ title: file.title, file })))(
    'seed file "$title": every name, phone and email',
    ({ file }) => {
      expect(fakeDataProblems(file)).toEqual([]);
    },
  );
});

describe('the check finds a name, phone or email that breaks the rules', () => {
  const file: SeedFile = {
    title: 'a seed file made up for this test',
    tables: [
      {
        table: 'patients',
        rows: [{ id: 'p1', first_name: 'Ana', last_name: 'Kodra', phone: fakePhone(7) }],
      },
    ],
    people: [{ email: `desk@${EMAIL_DOMAIN}`, name: 'Front desk', memberships: [] }],
  };
  /** The file with one value changed, at a path of keys and indexes. */
  function withValue(path: (string | number)[], value: unknown): unknown {
    const copy = structuredClone(file) as unknown as Record<string | number, unknown>;
    let at = copy;
    for (const key of path.slice(0, -1)) at = at[key] as Record<string | number, unknown>;
    at[path.at(-1)!] = value;
    return copy;
  }

  it('passes the file as it is', () => {
    expect(fakeDataProblems(file)).toEqual([]);
  });

  it('a phone outside the block', () => {
    expect(fakeDataProblems(withValue(['tables', 0, 'rows', 0, 'phone'], '+38971000007'))).toEqual([
      'tables[0].rows[0].phone: a phone outside the block +3897000…',
    ]);
  });

  it('an email at another domain', () => {
    expect(fakeDataProblems(withValue(['people', 0, 'email'], 'desk@example.com'))).toEqual([
      'people[0].email: an email that is not at example.test',
    ]);
  });

  it('a name that is not in the invented lists, in a person and in a row', () => {
    expect(fakeDataProblems(withValue(['people', 0, 'name'], 'Someone Real'))).toEqual([
      'people[0].name: a name that is not in the invented lists',
    ]);
    expect(fakeDataProblems(withValue(['tables', 0, 'rows', 0, 'last_name'], 'Real'))).toEqual([
      'tables[0].rows[0].last_name: a name that is not in the invented lists',
    ]);
  });

  it('an email or a phone under a key that does not say so, also in a list', () => {
    const contact = withValue(['tables', 0, 'rows', 0, 'contact'], 'someone@example.com');
    expect(fakeDataProblems(contact)).toEqual([
      'tables[0].rows[0].contact: an email that is not at example.test',
    ]);
    const numbers = withValue(['tables', 0, 'rows', 0, 'numbers'], ['+389 71 000 007']);
    expect(fakeDataProblems(numbers)).toEqual([
      'tables[0].rows[0].numbers[0]: a phone outside the block +3897000…',
    ]);
  });

  it('names the path, never the value', () => {
    const problems = fakeDataProblems(withValue(['people', 0, 'email'], 'marker-9f3a@example.com'));
    expect(problems.join('\n')).not.toContain('marker-9f3a');
  });
});

describe('the phone block', () => {
  it('fakePhone gives the n-th number of the block, from 0 to 9999', () => {
    expect(fakePhone(0)).toBe('+38970000000');
    expect(fakePhone(42)).toBe('+38970000042');
    expect(fakePhone(9999)).toBe('+38970009999');
    for (const n of [-1, 10_000, 1.5, Number.NaN]) {
      expect(() => fakePhone(n), String(n)).toThrow(RangeError);
    }
  });

  it('holds the block, in E.164 form, and nothing else', () => {
    expect(isFakePhone(fakePhone(1))).toBe(true);
    for (const phone of [
      '+38970010000', // the next block
      '+38971000001', // another mobile prefix
      '+389700000001', // a digit too many
      '+3897000001', // a digit too few
      '38970000001', // no plus
      '+389 70 000 001', // spaces
      '+15550100',
    ]) {
      expect(isFakePhone(phone), phone).toBe(false);
    }
  });
});

describe('the email domain', () => {
  it('holds addresses at example.test and nothing else', () => {
    expect(isFakeEmail('owner@example.test')).toBe(true);
    expect(isFakeEmail('front-desk.2+x@example.test')).toBe(true);
    for (const email of [
      'owner@example.com',
      'owner@example.test.com',
      'owner@sub.example.test',
      'owner@EXAMPLE.TEST',
      '@example.test',
      'two words@example.test',
      'a@b@example.test',
      'owner',
    ]) {
      expect(isFakeEmail(email), email).toBe(false);
    }
  });
});

describe('the invented names', () => {
  it('hold staff and clinic names, first and last names, and a first and last name together', () => {
    for (const name of [
      'Owner',
      'Front desk',
      'Harbour Street Dental',
      'Забна клиника Сончоглед',
      'Ana',
      'Ана',
      'Ana Kodra',
      'Ана Каменов',
    ]) {
      expect(isFakeName(name), name).toBe(true);
    }
  });

  it('refuse any other name, and a first and last name in two kinds of letters', () => {
    for (const name of ['Someone', 'owner', 'Ana Каменов', 'Ана Kodra', 'Ana Kodra Lumi', '']) {
      expect(isFakeName(name), name).toBe(false);
    }
  });

  it('come in Latin and in Cyrillic letters, each list in its own letters only (D-049)', () => {
    const latin = /^[\p{Script=Latin} -]+$/u;
    const cyrillic = /^[\p{Script=Cyrillic} -]+$/u;
    for (const list of [FIRST_NAMES, LAST_NAMES]) {
      expect(list.latin.length).toBeGreaterThan(0);
      expect(list.cyrillic.length).toBeGreaterThan(0);
      for (const name of list.latin) expect(name, name).toMatch(latin);
      for (const name of list.cyrillic) expect(name, name).toMatch(cyrillic);
    }
    expect(CLINIC_NAMES.some((name) => cyrillic.test(name))).toBe(true);
    expect(CLINIC_NAMES.some((name) => latin.test(name))).toBe(true);
  });

  it('list each name once, and staff names are role words', () => {
    const all = [
      ...FIRST_NAMES.latin,
      ...FIRST_NAMES.cyrillic,
      ...LAST_NAMES.latin,
      ...LAST_NAMES.cyrillic,
      ...STAFF_NAMES,
      ...CLINIC_NAMES,
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(STAFF_NAMES).toEqual(['Owner', 'Dentist', 'Hygienist', 'Front desk']);
  });
});

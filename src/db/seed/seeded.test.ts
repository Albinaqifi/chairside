import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CalendarDay } from '@/lib/calendar-day';
import { SEED_FILES, type SeedFile } from './seed-files';
import { seededId } from './seeded';

// E01-T01b, acceptance 5: every row the seed writes has a fixed id of its own. A repeated id would
// drop the second row without a word (`on conflict (id) do nothing`), and the app's input checks
// (`z.uuid()`) refuse an id whose version or variant digit is 0 (E00-T05a tester note 2).

/** The seven days of one week: the rows made for a day are checked for each. */
const WEEK = [
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
];

/** The ids a seed file gives what it writes for a day: rows, people and their memberships. */
function idsOf(file: SeedFile, day: CalendarDay): string[] {
  const tables = [...(file.tables ?? []), ...(file.dayTables?.(day) ?? [])];
  return [
    ...tables.flatMap(({ rows }) => rows.map((row) => row.id)),
    ...(file.people ?? []).flatMap((person) => [
      person.id,
      ...person.memberships.map((membership) => membership.id),
    ]),
  ];
}

describe('the ids of every seed file', () => {
  it.each(WEEK)(
    'on %s, no id is used twice across the seed files, and each passes z.uuid()',
    (day) => {
      const ids = SEED_FILES.flatMap((file) => idsOf(file, day));
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
      expect(ids.filter((id) => !z.uuid().safeParse(id).success)).toEqual([]);
    },
  );

  it('are the same whatever the day, and all in the seeded form', () => {
    const ids = (day: CalendarDay) => SEED_FILES.flatMap((file) => idsOf(file, day));
    for (const day of WEEK) expect(ids(day), day).toEqual(ids(WEEK[0]!));
    const seededForm = /^019a0000-5eed-7000-8000-\d{12}$/;
    expect(ids(WEEK[0]!).filter((id) => !seededForm.test(id))).toEqual([]);
  });
});

describe('seededId', () => {
  it("gives the n-th id of the table's own block", () => {
    expect(seededId('provider_breaks', 1)).toBe('019a0000-5eed-7000-8000-000000000501');
    expect(seededId('patients', 45)).toBe('019a0000-5eed-7000-8000-000000001045');
    expect(seededId('appointments', 1)).toBe('019a0000-5eed-7000-8000-000000002001');
    expect(seededId('appointments', 999)).toBe('019a0000-5eed-7000-8000-000000002999');
  });

  it("refuses a number outside the block, whose id could be another table's", () => {
    for (const n of [0, -1, 1.5, 1000])
      expect(() => seededId('patients', n), String(n)).toThrow(RangeError);
    expect(() => seededId('provider_breaks', 100)).toThrow(RangeError);
  });
});

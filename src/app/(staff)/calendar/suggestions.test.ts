import { describe, expect, it } from 'vitest';
import type { PatientRow, PatientStatus } from '@/modules/patients';
import { canPick, moveActive, pickedByEnter, SUGGESTION_LIMIT, suggestionsOf } from './suggestions';

// E01-T05a: the patient field's suggestions and keys, without React. The field in a browser is in
// tests/e2e/booking.spec.ts; what it shows is in ./new-appointment.test.ts. Names are from the
// seed's invented lists; ids are made up.

let nextId = 1;
function row(firstName: string, lastName: string, status: PatientStatus = 'active'): PatientRow {
  return {
    id: `01970000-0000-7000-8000-0000000010${String(nextId++).padStart(2, '0')}`,
    firstName,
    lastName,
    status,
    age: null,
    phone: null,
    lastVisit: null,
    nextVisit: null,
  };
}

const ANA = row('Ana', 'Brezovska');
const ARCHIVED = row('Ana', 'Planinska', 'archived');
const DECEASED = row('Shpëtim', 'Lumi', 'deceased');
const ELENA = row('Elena', 'Brezovska');

describe('the suggestions: the search’s first five rows, of every status', () => {
  it('at most five', () => {
    const rows = Array.from({ length: 8 }, (_, n) => row('Ana', `Kodra ${n}`));
    expect(SUGGESTION_LIMIT).toBe(5);
    expect(suggestionsOf(rows)).toEqual(rows.slice(0, 5));
    expect(suggestionsOf([ARCHIVED, ANA])).toEqual([ARCHIVED, ANA]);
  });
});

describe('only an active patient can be picked (owner, D-113)', () => {
  it('active: yes; archived or deceased: no', () => {
    expect([ANA, ARCHIVED, DECEASED].map(canPick)).toEqual([true, false, false]);
  });

  it('Enter picks the active suggestion when it can be picked, never one that cannot, nor none', () => {
    const shown = [ANA, ARCHIVED, DECEASED, ELENA];
    expect(pickedByEnter(shown, 0)).toBe(ANA);
    expect(pickedByEnter(shown, 3)).toBe(ELENA);
    expect(pickedByEnter(shown, 1)).toBeNull();
    expect(pickedByEnter(shown, 2)).toBeNull();
    expect(pickedByEnter(shown, -1)).toBeNull();
    expect(pickedByEnter([], 0)).toBeNull();
  });
});

describe('the arrow keys move through the suggestions', () => {
  it('ArrowDown from none: the first; then each next, round to the first', () => {
    const steps: number[] = [];
    let active = -1;
    for (let n = 0; n < 5; n++) {
      active = moveActive(active, 4, 'ArrowDown');
      steps.push(active);
    }
    expect(steps).toEqual([0, 1, 2, 3, 0]);
  });

  it('ArrowUp from none: the last; then each one before, round to the last', () => {
    const steps: number[] = [];
    let active = -1;
    for (let n = 0; n < 5; n++) {
      active = moveActive(active, 4, 'ArrowUp');
      steps.push(active);
    }
    expect(steps).toEqual([3, 2, 1, 0, 3]);
  });

  it('one that cannot be picked is still reached, so its label is read out', () => {
    expect(moveActive(0, 3, 'ArrowDown')).toBe(1);
  });

  it('none when there are no suggestions; a place past the end starts again', () => {
    expect(moveActive(-1, 0, 'ArrowDown')).toBe(-1);
    expect(moveActive(2, 0, 'ArrowUp')).toBe(-1);
    expect(moveActive(7, 3, 'ArrowDown')).toBe(0);
  });
});

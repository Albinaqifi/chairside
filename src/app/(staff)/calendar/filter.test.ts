import { describe, expect, it } from 'vitest';
import { firstChoice, shownColumns, toggleColumn, type ColumnChoice } from './filter';

// E01-T04b: the provider filter's rules, without React: the choice a member opens with, the columns
// a day shows, and a chip's click. ./calendar-screen.tsx keeps the choice; the chips in a browser
// are in tests/e2e/calendar.spec.ts. Ids are made up.

const A = '01970000-0000-7000-8000-0000000004a1';
const B = '01970000-0000-7000-8000-0000000004b2';
const C = '01970000-0000-7000-8000-0000000004c3';
/** A provider who has a column on another day only: inactive, with a visit then. */
const D = '01970000-0000-7000-8000-0000000004d4';
const DAY = [A, B, C];

/** Clicks the chips of `ids` one after the other, on a day of `columns`. */
function click(choice: ColumnChoice, columns: readonly string[], ...ids: string[]): ColumnChoice {
  return ids.reduce((current, id) => toggleColumn(current, columns, id), choice);
}

describe('the choice the calendar opens with', () => {
  it('a member linked to no provider (the owner, the front desk): every column', () => {
    expect(shownColumns(firstChoice(null), DAY)).toEqual(DAY);
    expect(shownColumns(firstChoice(null), [...DAY, D])).toEqual([...DAY, D]);
  });

  it('a member linked to a provider (the dentist, the hygienist): their own column alone', () => {
    expect(shownColumns(firstChoice(B), DAY)).toEqual([B]);
    // Another day's extra column stays hidden too: the choice is the own column alone.
    expect(shownColumns(firstChoice(B), [...DAY, D])).toEqual([B]);
  });

  it('a day on which the choice would show none shows all: the own column is not on that day', () => {
    expect(shownColumns(firstChoice(D), DAY)).toEqual(DAY);
  });

  it('a day without columns shows none', () => {
    expect(shownColumns(firstChoice(null), [])).toEqual([]);
    expect(shownColumns(firstChoice(A), [])).toEqual([]);
  });
});

describe("a chip's click", () => {
  it("turns its column off, then on again, keeping the day's order", () => {
    const off = click(firstChoice(null), DAY, B);
    expect(shownColumns(off, DAY)).toEqual([A, C]);
    expect(shownColumns(click(off, DAY, B), DAY)).toEqual(DAY);
  });

  it('lets a linked member turn the others on', () => {
    const choice = click(firstChoice(B), DAY, A, C);
    expect(shownColumns(choice, DAY)).toEqual(DAY);
  });

  it('the last column on stays on: the choice comes back unchanged', () => {
    const one = click(firstChoice(null), DAY, A, B);
    expect(shownColumns(one, DAY)).toEqual([C]);
    expect(toggleColumn(one, DAY, C)).toBe(one);
    expect(shownColumns(click(one, DAY, C), DAY)).toEqual([C]);
    expect(toggleColumn(firstChoice(B), DAY, B)).toEqual(firstChoice(B));
  });

  it('a day of one column: its chip cannot turn it off', () => {
    expect(shownColumns(click(firstChoice(null), [A], A), [A])).toEqual([A]);
  });

  it('on a day shown whole because the choice showed none, turns off the column clicked', () => {
    const choice = click(firstChoice(D), DAY, A);
    expect(shownColumns(choice, DAY)).toEqual([B, C]);
  });

  it('a provider without a column on the day changes nothing', () => {
    const choice = firstChoice(null);
    expect(toggleColumn(choice, DAY, D)).toBe(choice);
  });

  it('never changes the choice it is given', () => {
    const choice = firstChoice(B);
    click(choice, DAY, A, C, B);
    expect(shownColumns(choice, DAY)).toEqual([B]);
  });
});

describe('the choice holds over other days (Previous, Today, Next)', () => {
  it('a column turned off stays off on another day; a new provider there follows the others', () => {
    const choice = click(firstChoice(null), DAY, B);
    expect(shownColumns(choice, [A, B, D])).toEqual([A, D]);
  });

  it('a linked member who turned one other on sees it on another day, and no new provider', () => {
    const choice = click(firstChoice(B), DAY, A);
    expect(shownColumns(choice, [A, B, C, D])).toEqual([A, B]);
  });

  it('a day where the choice shows none shows all, and coming back keeps the choice', () => {
    const choice = click(firstChoice(null), DAY, A, B);
    expect(shownColumns(choice, [A, B])).toEqual([A, B]);
    expect(shownColumns(choice, DAY)).toEqual([C]);
  });
});

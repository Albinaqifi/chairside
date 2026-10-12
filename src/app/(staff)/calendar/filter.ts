/*
 * The provider filter (E01-T04b, demo lines 228–232, logic line 2094): which of the day's columns
 * show. No React here, so the rules are unit-tested; ./calendar-screen.tsx keeps the choice, as the
 * page's state, keyed by the page's clinic (D-098): a reload starts again.
 */

/**
 * What the person chose: a provider turned on or off by its chip (`set`), and what every provider
 * no chip has touched does (`others`). A member linked to no provider opens on every column
 * (`others` on); one linked to a provider opens on that column alone (`others` off), and can turn
 * the others on. The choice holds over Previous, Today and Next: a provider who has a column on
 * another day is shown there as the choice says.
 */
export interface ColumnChoice {
  others: boolean;
  set: ReadonlyMap<string, boolean>;
}

/** The choice the calendar opens with: the member's own column alone, or every column. */
export function firstChoice(ownProviderId: string | null): ColumnChoice {
  return ownProviderId === null
    ? { others: true, set: new Map() }
    : { others: false, set: new Map([[ownProviderId, true]]) };
}

/**
 * The ids of the day's columns that show, in the day's order: those the choice turns on. At least
 * one column of the day always shows: a day on which the choice would show none shows all (a linked
 * provider's column is missing on a day when the provider is inactive and has nothing booked).
 */
export function shownColumns(choice: ColumnChoice, columnIds: readonly string[]): string[] {
  const on = columnIds.filter((id) => choice.set.get(id) ?? choice.others);
  return on.length > 0 ? on : [...columnIds];
}

/**
 * The choice after a chip's click: its column turned off when it shows, on when it does not, from
 * what the day shows. The last column on stays on: the choice comes back unchanged. Every column of
 * the day is then set as it shows, so a day shown whole because the choice showed none keeps what
 * the click left.
 */
export function toggleColumn(
  choice: ColumnChoice,
  columnIds: readonly string[],
  providerId: string,
): ColumnChoice {
  if (!columnIds.includes(providerId)) return choice;
  const shown = shownColumns(choice, columnIds);
  const isShown = shown.includes(providerId);
  if (isShown && shown.length === 1) return choice;
  const next = isShown ? shown.filter((id) => id !== providerId) : [...shown, providerId];
  const set = new Map(choice.set);
  for (const id of columnIds) set.set(id, next.includes(id));
  return { others: choice.others, set };
}

import type { PatientRow } from '@/modules/patients';

/*
 * The new-appointment drawer's patient field (E01-T05a, demo logic line 1961): what the patient search
 * (searchPatients, E01-T02a) brings, shown as up to five suggestions, and how the keyboard moves
 * through them. No React here, so the rules are unit-tested; ./patient-field.tsx shows them.
 */

/** The most suggestions the field shows: the search's first rows, by last name, then first name. */
export const SUGGESTION_LIMIT = 5;

/** The suggestions for a search's rows: its first SUGGESTION_LIMIT, of every status. */
export function suggestionsOf(rows: readonly PatientRow[]): PatientRow[] {
  return rows.slice(0, SUGGESTION_LIMIT);
}

/**
 * True for a patient a booking can take: an active one. An archived or deceased patient shows with
 * their label and cannot be picked (owner, D-113): E02 sends them nothing, so their booking would get
 * no reminder, silently.
 */
export function canPick(row: Pick<PatientRow, 'status'>): boolean {
  return row.status === 'active';
}

/** The keys that move through the suggestions. */
export type ArrowKey = 'ArrowDown' | 'ArrowUp';

/**
 * The suggestion active after an arrow key, of `count`: the next one down, or up, round from the last
 * to the first and back; from none (-1), ArrowDown the first and ArrowUp the last. One that cannot be
 * picked is still reached, so its label is read out. None (-1) when there are no suggestions.
 */
export function moveActive(active: number, count: number, key: ArrowKey): number {
  if (count <= 0) return -1;
  if (active < 0 || active >= count) return key === 'ArrowDown' ? 0 : count - 1;
  return key === 'ArrowDown' ? (active + 1) % count : (active - 1 + count) % count;
}

/** The suggestion Enter picks: the active one when it can be picked, else none (null). */
export function pickedByEnter(
  suggestions: readonly PatientRow[],
  active: number,
): PatientRow | null {
  const row = suggestions[active];
  return row !== undefined && canPick(row) ? row : null;
}

'use client';

import { useTranslations } from 'next-intl';
import { startTransition, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useFrameClinic } from '@/app/_lib/frame-clinic';
import type { PatientRow } from '@/modules/patients';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import type { FieldControlProps } from '@/ui/field';
import { Input } from '@/ui/input';
import { searchPatients } from '../patients/actions';
import { SEARCH_MAX_LENGTH, sendSearch, type SearchAnswer } from '../patients/search-answer';
import { canPick, moveActive, pickedByEnter, suggestionsOf } from './suggestions';

/** How long the field waits after the last key before it searches: the patient list's wait. */
const SEARCH_DELAY_MS = 250;

/** The patient a booking takes: their id, sent with the booking, and their name, shown. */
export interface PickedPatient {
  id: string;
  firstName: string;
  lastName: string;
}

/** What the last search brought: the suggestions for the text it searched, or why there are none. */
type Found =
  | { kind: 'found'; text: string; suggestions: PatientRow[] }
  | { kind: Exclude<SearchAnswer['kind'], 'found'> };

/** The id of a suggestion, for the field's aria-activedescendant. */
function optionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/**
 * The drawer's patient field (E01-T05a, demo lines 1329–1338): a combobox. What is typed goes, a
 * moment after the last key, to the patient search (searchPatients, as the patient list sends it):
 * in the request's body, with the frame's clinic (D-092, D-095), and an answer to an earlier search is
 * dropped. Up to five suggestions show under the field, each with its phone; an archived or deceased
 * patient with their label, and they cannot be picked (owner, D-113).
 *
 * The box has no name, so its words are no field of the booking; the patient picked is the hidden
 * `patientId`, the StaffField's name (D-095). It sits in the booking's StaffForm, whose
 * `autocomplete="off"` keeps nothing it holds in the browser, so it sets no `autocomplete` of its own.
 *
 * By keyboard: the arrow keys move through the suggestions, Enter picks the active one and never sends
 * the form, Tab leaves the field. Escape closes the list, then the drawer: Radix hears Escape first,
 * on the document, so the drawer asks whether the list is open (`listOpen`, kept by the drawer).
 * A click picks a suggestion on the pointer's press, the focus kept in the field.
 */
export function PatientField({
  field,
  picked,
  onPick,
  listOpen,
  onListOpen,
}: {
  /** The StaffField's control props: its id names the box, its name the hidden value. */
  field: FieldControlProps;
  picked: PickedPatient | null;
  onPick: (patient: PickedPatient | null) => void;
  listOpen: boolean;
  onListOpen: (open: boolean) => void;
}) {
  const t = useTranslations('calendar.booking');
  const names = useTranslations('patients');
  const form = useTranslations('form');
  const clinicId = useFrameClinic();
  const listId = useId();
  const box = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sent = useRef(0);
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [active, setActive] = useState(-1);
  const suggestions = found?.kind === 'found' ? found.suggestions : [];
  const shown = listOpen && suggestions.length > 0;

  // A search still waiting when the drawer closes is never sent.
  useEffect(() => () => clearTimeout(timer.current), []);

  function search(text: string) {
    clearTimeout(timer.current);
    const ticket = ++sent.current;
    setActive(-1);
    if (text.trim() === '') {
      setFound(null);
      onListOpen(false);
      return;
    }
    timer.current = setTimeout(() => {
      // In a transition, so Next.js's redirect after an ended session reaches its boundary.
      startTransition(async () => {
        const answer = await sendSearch(searchPatients, clinicId, text);
        if (ticket !== sent.current) return;
        if (answer.kind === 'found') {
          const rows = suggestionsOf(answer.list.rows);
          setFound({ kind: 'found', text: text.trim(), suggestions: rows });
          // Opened only while the field has the focus: not after the person moved on.
          onListOpen(rows.length > 0 && document.activeElement === box.current);
        } else {
          setFound({ kind: answer.kind });
          onListOpen(false);
        }
      });
    }, SEARCH_DELAY_MS);
  }

  function pick(row: PatientRow) {
    clearTimeout(timer.current);
    sent.current++; // an answer still on its way is dropped
    setTyped(names('fullName', { first: row.firstName, last: row.lastName }));
    setActive(-1);
    onListOpen(false);
    onPick({ id: row.id, firstName: row.firstName, lastName: row.lastName });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const key = event.key;
    if (key === 'Enter') {
      // Implicit submission would send the booking: here Enter picks the active suggestion, or
      // does nothing.
      event.preventDefault();
      const row = shown ? pickedByEnter(suggestions, active) : null;
      if (row) pick(row);
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setActive(moveActive(shown ? active : -1, suggestions.length, key));
      onListOpen(true);
    }
  }

  return (
    <>
      <Input
        ref={box}
        id={field.id}
        aria-invalid={field['aria-invalid']}
        aria-describedby={field['aria-describedby']}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? optionId(listId, active) : undefined}
        placeholder={t('patientPlaceholder')}
        spellCheck={false}
        maxLength={SEARCH_MAX_LENGTH}
        value={typed}
        onChange={(event) => {
          const text = event.currentTarget.value;
          setTyped(text);
          if (picked) onPick(null);
          search(text);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (!picked && suggestions.length > 0) onListOpen(true);
        }}
        onBlur={() => onListOpen(false)}
      />
      <input type="hidden" name={field.name} value={picked?.id ?? ''} />
      {/* -mt-2: no room between the field and the next one while nothing shows here. */}
      <div className="-mt-2">
        <SuggestionList
          listId={listId}
          suggestions={suggestions}
          active={active}
          shown={shown}
          onPick={pick}
        />
        {/* Always there, so a screen reader reads what appears in it. */}
        <div role="status">
          {found?.kind === 'found' && found.suggestions.length === 0 && !picked && (
            <p className="mt-2 text-small text-muted">{names('noMatch', { query: found.text })}</p>
          )}
          {found?.kind === 'failed' && (
            <p className="mt-2 rounded-control bg-error-bg px-3 py-2 text-error">
              {names('failed')}
            </p>
          )}
          {found?.kind === 'clinic_changed' && (
            <div className="mt-2 grid justify-items-start gap-2 rounded-control border border-warn-border bg-warn-bg px-3 py-2">
              <p>{names('clinicChanged')}</p>
              <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
                {form('reload')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The suggestions under the field (demo lines 1333–1338): each patient's name and phone, an archived
 * or deceased one with their label (as the patient list shows it), disabled: a press on them picks
 * nothing (owner, D-113). The active suggestion, moved by the arrow keys, is the field's
 * aria-activedescendant. A press keeps the focus in the field, so the list stays until it picks.
 */
export function SuggestionList({
  listId,
  suggestions,
  active,
  shown,
  onPick,
}: {
  listId: string;
  suggestions: readonly PatientRow[];
  active: number;
  shown: boolean;
  onPick: (row: PatientRow) => void;
}) {
  const t = useTranslations('calendar.booking');
  const names = useTranslations('patients');
  return (
    <ul
      id={listId}
      role="listbox"
      aria-label={t('suggestions')}
      hidden={!shown}
      className="mt-2 overflow-hidden rounded-control border border-border bg-surface"
    >
      {suggestions.map((row, index) => {
        const pickable = canPick(row);
        return (
          <li
            key={row.id}
            id={optionId(listId, index)}
            role="option"
            aria-selected={index === active}
            aria-disabled={pickable ? undefined : true}
            tabIndex={-1}
            onMouseDown={(event) => {
              event.preventDefault(); // the focus stays in the field
              if (pickable) onPick(row);
            }}
            className={cn(
              'flex items-center justify-between gap-2 border-t border-border px-3 py-2.25 first:border-t-0',
              pickable ? 'cursor-pointer hover:bg-primary-soft' : 'cursor-default text-muted',
              index === active && 'bg-primary-soft',
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">
                {names('fullName', { first: row.firstName, last: row.lastName })}
              </span>
              {row.status !== 'active' && <Badge variant={row.status}>{names(row.status)}</Badge>}
            </span>
            <span className="shrink-0 text-small text-muted">{row.phone ?? names('noPhone')}</span>
          </li>
        );
      })}
    </ul>
  );
}

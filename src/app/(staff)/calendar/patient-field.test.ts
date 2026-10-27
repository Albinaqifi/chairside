import { createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import type { PatientRow, PatientStatus } from '@/modules/patients';
import { PatientField, SuggestionList, type PickedPatient } from './patient-field';

// E01-T05a, acceptance 6 and 8: the patient field of the new-appointment drawer, and its suggestions,
// as the server renders them (the search itself runs in the browser: tests/e2e/booking.spec.ts). The
// texts are their keys, with their values. Names are from the seed's invented lists; ids made up.

vi.mock('next-intl', () => ({
  useTranslations:
    (namespace: string) =>
    (key: string, values?: Record<string, unknown>): string =>
      values ? `${namespace}.${key}(${Object.values(values).join(' ')})` : `${namespace}.${key}`,
}));

// The search is server code: the field only hands it to sendSearch.
vi.mock('../patients/actions', () => ({ searchPatients: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000e1';

let nextId = 1;
function row(
  firstName: string,
  lastName: string,
  status: PatientStatus = 'active',
  phone: string | null = '070 001 101',
): PatientRow {
  return {
    id: `01970000-0000-7000-8000-0000000011${String(nextId++).padStart(2, '0')}`,
    firstName,
    lastName,
    status,
    age: null,
    phone,
    lastVisit: null,
    nextVisit: null,
  };
}

const ANA = row('Ana', 'Brezovska');
const ARCHIVED = row('Ana', 'Planinska', 'archived', '070 001 122');
const DECEASED = row('Shpëtim', 'Lumi', 'deceased', null);

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

/** Each option's text, without tags. */
function optionTexts(html: string): string[] {
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, inside = '']) =>
    inside
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function list(
  props: Partial<ComponentProps<typeof SuggestionList>> = {},
): ComponentProps<typeof SuggestionList> {
  return {
    listId: 'patients-found',
    suggestions: [ANA, ARCHIVED, DECEASED],
    active: -1,
    shown: true,
    onPick: vi.fn(),
    ...props,
  };
}

describe('an archived or deceased patient shows with their label and cannot be picked (acceptance 6)', () => {
  it('each suggestion with its name and phone; the archived and the deceased with their label', () => {
    const html = renderToString(createElement(SuggestionList, list()));
    expect(optionTexts(html)).toEqual([
      'patients.fullName(Ana Brezovska) 070 001 101',
      'patients.fullName(Ana Planinska) patients.archived 070 001 122',
      'patients.fullName(Shpëtim Lumi) patients.deceased patients.noPhone',
    ]);
    const [archived, deceased] = tags(html, 'span').filter((span) => span.has('data-variant'));
    expect([archived?.get('data-variant'), deceased?.get('data-variant')]).toEqual([
      'archived',
      'deceased',
    ]);
  });

  it('the archived and the deceased are disabled options; the active one is not', () => {
    const options = tags(renderToString(createElement(SuggestionList, list())), 'li');
    expect(options.map((option) => option.get('role'))).toEqual(['option', 'option', 'option']);
    expect(options.map((option) => option.get('aria-disabled') ?? null)).toEqual([
      null,
      'true',
      'true',
    ]);
  });

  it('a press on them picks nothing; a press on the active patient picks them, the focus kept', () => {
    const onPick = vi.fn();
    // Called as React calls it: the list and its options, with the handlers they carry.
    const ul = SuggestionList(list({ onPick })) as ReactElement<{ children: ReactNode[] }>;
    const options = ul.props.children as ReactElement<{
      onMouseDown: (event: { preventDefault: () => void }) => void;
    }>[];
    for (const option of options) {
      const press = { preventDefault: vi.fn() };
      option.props.onMouseDown(press);
      expect(press.preventDefault).toHaveBeenCalledOnce();
    }
    expect(onPick).toHaveBeenCalledExactlyOnceWith(ANA);
  });

  it('the active suggestion is marked selected, and the list is hidden until it shows', () => {
    const active = tags(renderToString(createElement(SuggestionList, list({ active: 1 }))), 'li');
    expect(active.map((option) => option.get('aria-selected'))).toEqual(['false', 'true', 'false']);
    const [hidden] = tags(
      renderToString(createElement(SuggestionList, list({ shown: false }))),
      'ul',
    );
    expect(hidden?.has('hidden')).toBe(true);
  });
});

/** The field as the server renders it, in a staff frame, with the patient picked so far. */
function field(picked: PickedPatient | null = null): string {
  const element = createElement(PatientField, {
    field: { id: 'booking-patient', name: 'patientId' },
    picked,
    onPick: vi.fn(),
    listOpen: false,
    onListOpen: vi.fn(),
    onNewPatient: vi.fn(),
  });
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: element };
  return renderToString(createElement(FrameClinic, frame));
}

describe('the patient search keeps nothing in the browser (acceptance 8, D-095)', () => {
  it('the box: a combobox with no autocomplete of its own and no name, so its words are no field', () => {
    const [box] = tags(field(), 'input').filter((input) => input.get('role') === 'combobox');
    expect(box).toBeDefined();
    expect(box?.get('id')).toBe('booking-patient');
    expect(box?.has('autocomplete')).toBe(false);
    expect(box?.has('name')).toBe(false);
    expect(box?.get('aria-autocomplete')).toBe('list');
    expect(box?.get('aria-expanded')).toBe('false');
  });

  it("the booking's field is the hidden patientId: none until a patient is picked, then their id", () => {
    const hiddenOf = (html: string) =>
      tags(html, 'input').filter((input) => input.get('type') === 'hidden');
    expect(hiddenOf(field()).map((input) => [input.get('name'), input.get('value')])).toEqual([
      ['patientId', ''],
    ]);
    const picked = { id: ANA.id, firstName: 'Ana', lastName: 'Brezovska' };
    expect(hiddenOf(field(picked)).map((input) => [input.get('name'), input.get('value')])).toEqual(
      [['patientId', ANA.id]],
    );
  });

  it('the list it controls is on the page, hidden while closed', () => {
    const html = field();
    const [box] = tags(html, 'input').filter((input) => input.get('role') === 'combobox');
    const [listbox] = tags(html, 'ul');
    expect(listbox?.get('id')).toBe(box?.get('aria-controls'));
    expect(listbox?.has('hidden')).toBe(true);
  });
});

// E01-T05d, acceptance 2: "Add “…” as new patient", the suggestions' last option.

/** The field made with `initialText`, as it is made again back from the new patient's fields. */
function fieldWith(initialText: string, picked: PickedPatient | null = null): string {
  const element = createElement(PatientField, {
    field: { id: 'booking-patient', name: 'patientId' },
    picked,
    onPick: vi.fn(),
    listOpen: false,
    onListOpen: vi.fn(),
    initialText,
    onNewPatient: vi.fn(),
  });
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: element };
  return renderToString(createElement(FrameClinic, frame));
}

describe('"Add … as new patient": the last option, from the third character (E01-T05d, acceptance 2)', () => {
  it('after the suggestions, its own option, the text typed in it', () => {
    const html = renderToString(
      createElement(SuggestionList, list({ newPatient: 'Ana Bre', onNewPatient: vi.fn() })),
    );
    const options = tags(html, 'li');
    expect(options.map((option) => option.get('role'))).toEqual([
      'option',
      'option',
      'option',
      'option',
    ]);
    expect(options.map((option) => option.get('id'))).toEqual([
      'patients-found-option-0',
      'patients-found-option-1',
      'patients-found-option-2',
      'patients-found-option-3',
    ]);
    expect(optionTexts(html).at(-1)).toBe('calendar.booking.addNewPatient(Ana Bre)');
    expect(options.at(-1)?.has('aria-disabled')).toBe(false);
  });

  it('with no suggestions, the only option', () => {
    const html = renderToString(
      createElement(SuggestionList, list({ suggestions: [], newPatient: 'Vesna' })),
    );
    expect(optionTexts(html)).toEqual(['calendar.booking.addNewPatient(Vesna)']);
    expect(tags(html, 'li')[0]?.get('id')).toBe('patients-found-option-0');
  });

  it('not offered: no such option', () => {
    expect(optionTexts(renderToString(createElement(SuggestionList, list())))).toHaveLength(3);
  });

  it('reached by the arrow keys: marked selected when active, as a suggestion is', () => {
    const html = renderToString(
      createElement(SuggestionList, list({ newPatient: 'Ana Bre', active: 3 })),
    );
    expect(tags(html, 'li').map((option) => option.get('aria-selected'))).toEqual([
      'false',
      'false',
      'false',
      'true',
    ]);
  });

  it('a press takes it, the focus kept in the field until the new fields take it', () => {
    const onNewPatient = vi.fn();
    const onPick = vi.fn();
    const ul = SuggestionList(
      list({ newPatient: 'Ana Bre', onNewPatient, onPick }),
    ) as ReactElement<{ children: ReactNode[] }>;
    const options = ul.props.children as ReactElement<{
      onMouseDown: (event: { preventDefault: () => void }) => void;
    }>[];
    const press = { preventDefault: vi.fn() };
    options.at(-1)?.props.onMouseDown(press);
    expect(press.preventDefault).toHaveBeenCalledOnce();
    expect(onNewPatient).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });

  // Review, required change 1: the server renders the field before any search has answered, so it
  // offers nothing, from the third character either; once an answer comes, the list shows it after
  // the matches (the SuggestionList cases above; showsNewPatient in new-patient.test.ts; the e2e check).
  it('the field offers it not before the search for the text typed has answered, from the third character either', () => {
    expect(optionTexts(fieldWith('An'))).toEqual([]);
    expect(optionTexts(fieldWith('Ana'))).toEqual([]);
    expect(optionTexts(fieldWith('  Ana Bre '))).toEqual([]);
    const picked = { id: ANA.id, firstName: 'Ana', lastName: 'Brezovska' };
    expect(optionTexts(fieldWith('Ana Brezovska', picked))).toEqual([]);
  });

  it('back from the new patient: the box holds the text typed again, and no patient is picked', () => {
    const html = fieldWith('Ana Bre');
    const [box] = tags(html, 'input').filter((input) => input.get('role') === 'combobox');
    expect(box?.get('value')).toBe('Ana Bre');
    const hidden = tags(html, 'input').filter((input) => input.get('type') === 'hidden');
    expect(hidden.map((input) => [input.get('name'), input.get('value')])).toEqual([
      ['patientId', ''],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  NEW_PATIENT_FROM,
  newPatientByEnter,
  newPatientFrom,
  offersNewPatient,
  showsNewPatient,
  unreachable,
} from './new-patient';
import { moveActive } from './suggestions';

// E01-T05d, acceptance 2 and 3 (the rules): when the patient field offers "Add “…” as new patient",
// how the arrow keys and Enter reach it, what the words typed fill in, and when a new patient has no
// way to be reached. Names are from the seed's invented lists; phones from its made-up block.

describe('"Add … as new patient" is offered from the third character (acceptance 2)', () => {
  it('three characters, spaces around them aside', () => {
    expect(NEW_PATIENT_FROM).toBe(3);
    expect(offersNewPatient('', false)).toBe(false);
    expect(offersNewPatient('An', false)).toBe(false);
    expect(offersNewPatient('  An  ', false)).toBe(false);
    expect(offersNewPatient('Ana', false)).toBe(true);
    expect(offersNewPatient(' Ana ', false)).toBe(true);
    expect(offersNewPatient('070', false)).toBe(true);
  });

  it('not while a patient is picked', () => {
    expect(offersNewPatient('Ana Brezovska', true)).toBe(false);
  });
});

describe('"Add … as new patient" shows only once the search for the text typed has answered (review, required change 1)', () => {
  it('before any answer, or after a failed or clinic_changed one (no text answered): not shown', () => {
    expect(showsNewPatient('Mimoza K', false, null)).toBe(false);
  });

  it('the answer for the text typed, found or not: shown, spaces around the text aside', () => {
    expect(showsNewPatient('Mimoza K', false, 'Mimoza K')).toBe(true);
    expect(showsNewPatient(' Mimoza K ', false, 'Mimoza K')).toBe(true);
  });

  it('the answer for an earlier text, still on show while the next search runs: not shown', () => {
    expect(showsNewPatient('Mimoza Ko', false, 'Mimoza K')).toBe(false);
    expect(showsNewPatient('Mimoza', false, 'Mimoza K')).toBe(false);
  });

  it('answered, but under three characters or with a patient picked: not shown', () => {
    expect(showsNewPatient('An', false, 'An')).toBe(false);
    expect(showsNewPatient('Mimoza Kodra', true, 'Mimoza Kodra')).toBe(false);
  });
});

describe('the arrow keys reach it as the last option, and Enter takes it (acceptance 2)', () => {
  it('with suggestions: down past the last suggestion to it, then round to the first; up from none to it', () => {
    const suggestions = 2;
    const options = suggestions + 1;
    expect(moveActive(-1, options, 'ArrowDown')).toBe(0);
    expect(moveActive(1, options, 'ArrowDown')).toBe(2);
    expect(newPatientByEnter(suggestions, 2, true)).toBe(true);
    expect(moveActive(2, options, 'ArrowDown')).toBe(0);
    expect(moveActive(-1, options, 'ArrowUp')).toBe(2);
  });

  it('without suggestions: it is the only option', () => {
    expect(moveActive(-1, 1, 'ArrowDown')).toBe(0);
    expect(newPatientByEnter(0, 0, true)).toBe(true);
  });

  it('Enter on a suggestion, on none, or when it is not offered takes it not', () => {
    expect(newPatientByEnter(2, 1, true)).toBe(false);
    expect(newPatientByEnter(2, -1, true)).toBe(false);
    expect(newPatientByEnter(2, 2, false)).toBe(false);
  });
});

describe('what was typed fills the fields (acceptance 2)', () => {
  it.each([
    ['Ana', { firstName: 'Ana', lastName: '', phone: '' }],
    ['Ana Brezovska', { firstName: 'Ana', lastName: 'Brezovska', phone: '' }],
    ['  Ana   Brezovska  ', { firstName: 'Ana', lastName: 'Brezovska', phone: '' }],
    ['Ana Marija Brezovska', { firstName: 'Ana Marija', lastName: 'Brezovska', phone: '' }],
    ['Shpëtim Lumi', { firstName: 'Shpëtim', lastName: 'Lumi', phone: '' }],
    ['Ана Брезовска', { firstName: 'Ана', lastName: 'Брезовска', phone: '' }],
    ['', { firstName: '', lastName: '', phone: '' }],
  ])('the words %j: the last the last name, the rest the first name', (typed, fields) => {
    expect(newPatientFrom(typed)).toEqual(fields);
  });

  it.each([
    ['070 001 234', '070 001 234'],
    ['+389 70 001 234', '+389 70 001 234'],
    ['(070) 001-234', '(070) 001-234'],
    [' 070001234 ', '070001234'],
  ])('a phone searched for, %j: the phone field, the names empty', (typed, phone) => {
    expect(newPatientFrom(typed)).toEqual({ firstName: '', lastName: '', phone });
  });

  it('signs without a digit, or digits among letters, are names', () => {
    expect(newPatientFrom('+ - ()')).toEqual({ firstName: '+ -', lastName: '()', phone: '' });
    expect(newPatientFrom('Ana 070')).toEqual({ firstName: 'Ana', lastName: '070', phone: '' });
  });
});

describe('a new patient without a phone and an email cannot be reached (acceptance 3)', () => {
  it('neither, or both blank: unreachable; either one: reachable', () => {
    expect(unreachable('', '')).toBe(true);
    expect(unreachable('  ', ' ')).toBe(true);
    expect(unreachable('070 001 234', '')).toBe(false);
    expect(unreachable('', 'ana.brezovska@example.test')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  hoursFieldNames,
  minutesOfTimeValue,
  timeChoices,
  timeValue,
  WEEKDAY_FIELDS,
  weekValues,
} from './opening-hours';

// E01-T08b, acceptance 1 (the form's side): the times the Opening hours tab offers and the values it
// starts with. No React, no database, no clock: the values hold no zone.

describe('a time and its value', () => {
  it.each([
    { value: '00:00', minutes: 0 },
    { value: '08:00', minutes: 480 },
    { value: '08:10', minutes: 490 },
    { value: '08:10:30', minutes: 490.5 },
    { value: '23:45', minutes: 1425 },
    { value: '23:59:59', minutes: 1440 - 1 / 60 },
    { value: '24:00', minutes: 1440 },
  ])('$value is $minutes minutes from midnight, and back', ({ value, minutes }) => {
    expect(minutesOfTimeValue(value)).toBe(minutes);
    expect(timeValue(minutes)).toBe(value);
  });

  it('24:00:00, as PostgreSQL may write it, is the end of the day too', () => {
    expect(minutesOfTimeValue('24:00:00')).toBe(1440);
  });

  it.each([
    '',
    '8:00',
    '08:0',
    '24:15',
    '24:00:01',
    '25:00',
    '08:60',
    '08:00:60',
    'noon',
    ' 08:00',
  ])('%j is no time', (value) => {
    expect(minutesOfTimeValue(value)).toBeNull();
  });
});

describe('the times a select offers', () => {
  it('every 15 minutes from 00:00 to 23:45, as values HH:MM', () => {
    const choices = timeChoices('08:00');
    expect(choices).toHaveLength(96);
    expect(choices.slice(0, 5)).toEqual(['00:00', '00:15', '00:30', '00:45', '01:00']);
    expect(choices.at(-1)).toBe('23:45');
    expect(timeChoices('')).toEqual(choices);
  });

  it('a stored time the steps lack is offered as it is, where it falls in the day', () => {
    const choices = timeChoices('08:10');
    expect(choices).toHaveLength(97);
    expect(choices.slice(choices.indexOf('08:00'), choices.indexOf('08:00') + 3)).toEqual([
      '08:00',
      '08:10',
      '08:15',
    ]);
    expect(timeChoices('08:10:30')).toContain('08:10:30');
    expect(timeChoices('24:00').at(-1)).toBe('24:00');
    expect(timeChoices('00:05').slice(0, 3)).toEqual(['00:00', '00:05', '00:15']);
  });
});

describe('the week as the form starts with it', () => {
  it('Monday first, each weekday with its fields; a weekday without a row is closed, with no time', () => {
    expect(WEEKDAY_FIELDS.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(hoursFieldNames('monday')).toEqual({
      open: 'mondayOpen',
      opens: 'mondayOpens',
      closes: 'mondayCloses',
    });
    expect(
      weekValues([
        { weekday: 3, opens: 490, closes: 1200 },
        { weekday: 1, opens: 480, closes: 1080 },
      ]),
    ).toEqual([
      { weekday: 1, key: 'monday', open: true, opens: '08:00', closes: '18:00' },
      { weekday: 2, key: 'tuesday', open: false, opens: '', closes: '' },
      { weekday: 3, key: 'wednesday', open: true, opens: '08:10', closes: '20:00' },
      { weekday: 4, key: 'thursday', open: false, opens: '', closes: '' },
      { weekday: 5, key: 'friday', open: false, opens: '', closes: '' },
      { weekday: 6, key: 'saturday', open: false, opens: '', closes: '' },
      { weekday: 7, key: 'sunday', open: false, opens: '', closes: '' },
    ]);
  });
});

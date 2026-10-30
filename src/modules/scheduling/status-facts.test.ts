import { describe, expect, it } from 'vitest';
import type { AppointmentStatus } from './appointments';
import {
  allowedActions,
  statusFactsOf,
  type StatusAction,
  type StatusFacts,
} from './status-machine';

// E01-T06b: the facts of a visit at a moment (the one function the change and the calendar's buttons
// share) and the actions the state machine allows from them. Pure: the zones are named in each case,
// never the computer's (CI runs once, in UTC: D-099). The change and the buttons together, on the
// database, are tests/integration/appointment-actions.test.ts.

const SKOPJE = 'Europe/Skopje';
const NEW_YORK = 'America/New_York';
const NOW = new Date('2031-03-03T10:00:00Z');

const at = (iso: string) => new Date(iso);

describe('statusFactsOf: started', () => {
  const start = (startsAt: string) =>
    statusFactsOf({ startsAt: at(startsAt), confirmedAt: null, completedAt: null }, NOW, SKOPJE)
      .started;

  it('is false before the start, true at the start exactly and after', () => {
    expect(start('2031-03-03T10:00:00.001Z')).toBe(false);
    expect(start('2031-03-03T10:00:00.000Z')).toBe(true);
    expect(start('2031-03-03T09:59:59.999Z')).toBe(true);
  });
});

describe('statusFactsOf: confirmed, aftercare and the cut-off', () => {
  const facts = (confirmedAt: Date | null, beforeCutoff?: boolean) =>
    statusFactsOf(
      { startsAt: NOW, confirmedAt, completedAt: null },
      NOW,
      SKOPJE,
      ...(beforeCutoff === undefined ? [] : [beforeCutoff]),
    );

  it('is confirmed when the confirmation has a moment', () => {
    expect(facts(null).confirmed).toBe(false);
    expect(facts(at('2031-03-01T08:00:00Z')).confirmed).toBe(true);
  });

  it('has no aftercare yet (E06), and the cut-off is false unless the caller says it is before it', () => {
    expect(facts(null).aftercareSent).toBe(false);
    expect(facts(null).beforeCutoff).toBe(false);
    expect(facts(null, true).beforeCutoff).toBe(true);
  });
});

describe('statusFactsOf: sameDay is the clinic calendar day of the completion', () => {
  const same = (zone: string, now: string, completedAt: string | null) =>
    statusFactsOf(
      {
        startsAt: at(now),
        confirmedAt: null,
        completedAt: completedAt === null ? null : at(completedAt),
      },
      at(now),
      zone,
    ).sameDay;

  it('is false for a visit never completed', () => {
    expect(same(SKOPJE, '2031-03-03T10:00:00Z', null)).toBe(false);
  });

  it('in Skopje: 23:30 UTC the day before is the next local day already (UTC+1)', () => {
    // 00:30 local on 3 March is 23:30 UTC on 2 March.
    expect(same(SKOPJE, '2031-03-03T10:00:00Z', '2031-03-02T23:30:00Z')).toBe(true);
    // 23:30 local on 2 March is 22:30 UTC: a calendar day earlier, only 11.5 hours before.
    expect(same(SKOPJE, '2031-03-03T10:00:00Z', '2031-03-02T22:30:00Z')).toBe(false);
  });

  it('in New York on a day of 23 hours (9 March 2031): the day runs 05:00 to 04:00 UTC', () => {
    const now = '2031-03-10T03:30:00Z'; // 23:30 local, 9 March
    expect(same(NEW_YORK, now, '2031-03-09T05:00:00Z')).toBe(true); // 00:00 local, 22.5 h earlier
    expect(same(NEW_YORK, now, '2031-03-09T04:59:00Z')).toBe(false); // 23:59 local, 8 March
  });

  it('in New York on a day of 25 hours (2 November 2031): the day runs 04:00 to 05:00 UTC the next', () => {
    const now = '2031-11-03T04:30:00Z'; // 23:30 local, 2 November
    expect(same(NEW_YORK, now, '2031-11-02T04:00:00Z')).toBe(true); // 00:00 local, 24.5 h earlier
    expect(same(NEW_YORK, now, '2031-11-02T03:59:00Z')).toBe(false); // 23:59 local, 1 November
  });
});

describe('allowedActions: the buttons the state machine allows a staff member', () => {
  const FACTS: StatusFacts = {
    started: false,
    confirmed: false,
    sameDay: false,
    aftercareSent: false,
    beforeCutoff: false,
  };
  const allowed = (status: AppointmentStatus, change: Partial<StatusFacts> = {}) =>
    allowedActions(status, { ...FACTS, ...change });

  it.each<[AppointmentStatus, Partial<StatusFacts>, StatusAction[]]>([
    ['booked', {}, ['confirm', 'arrive', 'complete', 'cancel']],
    ['booked', { started: true }, ['confirm', 'arrive', 'complete', 'no_show', 'cancel']],
    ['confirmed', {}, ['arrive', 'complete', 'cancel']],
    ['confirmed', { started: true }, ['arrive', 'complete', 'no_show', 'cancel']],
    ['arrived', { started: true }, ['complete', 'undo_arrival']],
    ['completed', {}, []],
    ['completed', { sameDay: true }, ['undo_completion']],
    ['cancelled', { started: true }, ['restore']],
    ['no_show', { started: true }, ['restore']],
  ])('%s with %j: %j', (status, change, actions) => {
    expect(allowed(status, change)).toEqual(actions);
  });

  it('never offers a patient-only change, and never undo_completion once aftercare is sent', () => {
    expect(allowedActions('completed', { ...FACTS, sameDay: true, aftercareSent: true })).toEqual(
      [],
    );
    expect(allowed('booked', { beforeCutoff: true })).toEqual(allowed('booked'));
  });
});

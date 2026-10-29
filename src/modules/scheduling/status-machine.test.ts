import { describe, expect, it } from 'vitest';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from './appointments';
import {
  nextAppointmentStatus,
  STATUS_ACTIONS,
  type StatusAction,
  type StatusActor,
  type StatusFacts,
} from './status-machine';

// E01-T06a, acceptance 1: the appointment state machine, every status x action x actor x fact. The
// expected answers are written from the table in data-model.md ("Appointment state machine"), one row
// a transition, and not from the function: a row is allowed when its status, action and actor match
// and its condition on the facts holds; every other combination is `not_allowed`, but a no-show of a
// visit that has not started, which is `too_early`. Pure: no database, no clock, no zone.

interface Row {
  from: AppointmentStatus[];
  action: StatusAction;
  actors: StatusActor[];
  /** The table's condition on the facts, if it has one. */
  when?: (facts: StatusFacts) => boolean;
  to: (facts: StatusFacts) => AppointmentStatus;
}

const OPEN: AppointmentStatus[] = ['booked', 'confirmed'];

/** data-model.md, "Appointment state machine", row by row. */
const TABLE: Row[] = [
  // booked -> confirmed: patient (link) or staff
  { from: ['booked'], action: 'confirm', actors: ['staff', 'patient'], to: () => 'confirmed' },
  // booked, confirmed -> arrived: staff
  { from: OPEN, action: 'arrive', actors: ['staff'], to: () => 'arrived' },
  // booked, confirmed -> cancelled: staff; patient only before the cut-off
  { from: OPEN, action: 'cancel', actors: ['staff'], to: () => 'cancelled' },
  {
    from: OPEN,
    action: 'cancel',
    actors: ['patient'],
    when: (facts) => facts.beforeCutoff,
    to: () => 'cancelled',
  },
  // booked, confirmed -> no_show: staff, only after the start time
  {
    from: OPEN,
    action: 'no_show',
    actors: ['staff'],
    when: (facts) => facts.started,
    to: () => 'no_show',
  },
  // booked, confirmed, arrived -> completed: staff
  {
    from: [...OPEN, 'arrived'],
    action: 'complete',
    actors: ['staff'],
    to: () => 'completed',
  },
  // arrived -> booked or confirmed (undo): staff; confirmed if it was confirmed
  {
    from: ['arrived'],
    action: 'undo_arrival',
    actors: ['staff'],
    to: (facts) => (facts.confirmed ? 'confirmed' : 'booked'),
  },
  // cancelled, no_show -> booked (restore): staff
  { from: ['cancelled', 'no_show'], action: 'restore', actors: ['staff'], to: () => 'booked' },
  // completed -> arrived (undo): staff, same day, and only while no aftercare was sent
  {
    from: ['completed'],
    action: 'undo_completion',
    actors: ['staff'],
    when: (facts) => facts.sameDay && !facts.aftercareSent,
    to: () => 'arrived',
  },
];

/** Every combination of the five facts: 32. */
const FACTS: StatusFacts[] = Array.from({ length: 32 }, (_, bits) => ({
  started: (bits & 1) !== 0,
  confirmed: (bits & 2) !== 0,
  sameDay: (bits & 4) !== 0,
  aftercareSent: (bits & 8) !== 0,
  beforeCutoff: (bits & 16) !== 0,
}));

const ACTORS: StatusActor[] = ['staff', 'patient'];

/** What the table says for one combination. */
function expected(
  from: AppointmentStatus,
  action: StatusAction,
  actor: StatusActor,
  facts: StatusFacts,
) {
  const row = TABLE.find(
    (candidate) =>
      candidate.from.includes(from) &&
      candidate.action === action &&
      candidate.actors.includes(actor) &&
      (candidate.when?.(facts) ?? true),
  );
  if (row) return { ok: true, to: row.to(facts) };
  // A no-show the table has for a staff member and an open visit, but not yet: too early, not "no".
  if (action === 'no_show' && actor === 'staff' && OPEN.includes(from)) {
    return { ok: false, code: 'too_early' };
  }
  return { ok: false, code: 'not_allowed' };
}

describe('nextAppointmentStatus (E01-T06a)', () => {
  it('knows the statuses and actions the table is written for', () => {
    expect([...APPOINTMENT_STATUSES].sort()).toEqual(
      ['arrived', 'booked', 'cancelled', 'completed', 'confirmed', 'no_show'].sort(),
    );
    expect([...STATUS_ACTIONS].sort()).toEqual(
      [
        'arrive',
        'cancel',
        'complete',
        'confirm',
        'no_show',
        'restore',
        'undo_arrival',
        'undo_completion',
      ].sort(),
    );
  });

  it.each(APPOINTMENT_STATUSES.map((status) => ({ status })))(
    'from $status: every action, actor and fact answers as the table says',
    ({ status }) => {
      let allowed = 0;
      for (const action of STATUS_ACTIONS) {
        for (const actor of ACTORS) {
          for (const facts of FACTS) {
            const answer = nextAppointmentStatus(status, action, actor, facts);
            expect(answer, `${status} ${action} ${actor} ${JSON.stringify(facts)}`).toEqual(
              expected(status, action, actor, facts),
            );
            if (answer.ok) allowed += 1;
          }
        }
      }
      // The table is not empty for any status: a loop that checks nothing would pass the lines above.
      expect(allowed).toBeGreaterThan(0);
    },
  );

  it('allows a transition of the table at all (the loop checks something)', () => {
    const facts = FACTS[31]!;
    expect(nextAppointmentStatus('booked', 'confirm', 'staff', facts)).toEqual({
      ok: true,
      to: 'confirmed',
    });
  });

  it('a no-show before the start is too_early; at the start exactly, and after, it is allowed', () => {
    const base: StatusFacts = {
      started: false,
      confirmed: false,
      sameDay: false,
      aftercareSent: false,
      beforeCutoff: false,
    };
    for (const status of OPEN) {
      expect(nextAppointmentStatus(status, 'no_show', 'staff', base)).toEqual({
        ok: false,
        code: 'too_early',
      });
      expect(nextAppointmentStatus(status, 'no_show', 'staff', { ...base, started: true })).toEqual(
        {
          ok: true,
          to: 'no_show',
        },
      );
    }
    // Not for a visit already arrived, completed or cancelled, started or not.
    for (const status of ['arrived', 'completed', 'cancelled', 'no_show'] as const) {
      expect(nextAppointmentStatus(status, 'no_show', 'staff', { ...base, started: true })).toEqual(
        { ok: false, code: 'not_allowed' },
      );
    }
  });

  it('a patient may only confirm and cancel, and cancel only before the cut-off', () => {
    const facts = FACTS[31]!;
    for (const action of STATUS_ACTIONS) {
      const answer = nextAppointmentStatus('booked', action, 'patient', facts);
      expect(answer.ok, action).toBe(action === 'confirm' || action === 'cancel');
    }
    expect(
      nextAppointmentStatus('confirmed', 'cancel', 'patient', { ...facts, beforeCutoff: false }),
    ).toEqual({ ok: false, code: 'not_allowed' });
  });

  it('an undone arrival returns to confirmed if the visit was confirmed, else to booked', () => {
    const facts = FACTS[0]!;
    expect(
      nextAppointmentStatus('arrived', 'undo_arrival', 'staff', { ...facts, confirmed: true }),
    ).toEqual({ ok: true, to: 'confirmed' });
    expect(
      nextAppointmentStatus('arrived', 'undo_arrival', 'staff', { ...facts, confirmed: false }),
    ).toEqual({ ok: true, to: 'booked' });
  });

  it('an undone completion is for the same day and while no aftercare was sent', () => {
    const facts = FACTS[0]!;
    const undo = (change: Partial<StatusFacts>) =>
      nextAppointmentStatus('completed', 'undo_completion', 'staff', { ...facts, ...change });
    expect(undo({ sameDay: true })).toEqual({ ok: true, to: 'arrived' });
    expect(undo({ sameDay: false })).toEqual({ ok: false, code: 'not_allowed' });
    expect(undo({ sameDay: true, aftercareSent: true })).toEqual({
      ok: false,
      code: 'not_allowed',
    });
  });
});

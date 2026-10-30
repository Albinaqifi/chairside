import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readDay } from '@/app/(staff)/calendar/read-day';
import type { AppointmentBlock } from '@/app/(staff)/calendar/day';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { dayInZone } from '@/lib/calendar-day';
import { newId } from '@/lib/ids';
import * as patients from '@/modules/patients';
import * as scheduling from '@/modules/scheduling';
import { insertClinic, migratorPool } from './fixtures';
import { insertRow, insertUser } from './scheduling-fixtures';

// E01-T06b, acceptance 1 and the read: the buttons of the appointment drawer are exactly the changes
// the module accepts. For a visit of every status, before its start, at it and after it, completed
// today and on an earlier day of the clinic's zone (Skopje, and New York on a day of 23 and a day of
// 25 hours), appointmentsOnDay's `actions` are compared with the actions changeAppointmentStatus
// accepts for a staff actor on copies of that visit, one copy per action (a change writes, so each
// has its own). `restore` is judged by the table alone: every copy has a provider of its own, so the
// chair never decides. Run as the app role in the clinic's own transaction, under Row-Level Security;
// rows are written as the migration role. Moments are written in UTC and each place names its zone,
// so neither the computer's zone nor the database session's plays a part (D-099). Synthetic data.

const admin = migratorPool();
const SKOPJE = 'Europe/Skopje';
const NEW_YORK = 'America/New_York';
const ACTIONS = scheduling.STATUS_ACTIONS;

interface Place {
  clinic: string;
  zone: string;
  patient: string;
}

let creator: string;
let skopje: Place;
let newYork: Place;

async function clinicIn(zone: string): Promise<Place> {
  const clinic = await insertClinic(admin);
  await admin.query('update clinics set timezone = $2 where id = $1', [clinic, zone]);
  const patient = newId();
  await insertRow(admin, 'patients', {
    id: patient,
    clinic_id: clinic,
    first_name: 'Ana',
    last_name: 'Brezovska',
    language: 'en',
  });
  return { clinic, zone, patient };
}

beforeAll(async () => {
  creator = await insertUser(admin);
  skopje = await clinicIn(SKOPJE);
  newYork = await clinicIn(NEW_YORK);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

/** A provider of its own: no copy meets another in the chair. */
async function provider(place: Place): Promise<string> {
  const id = newId();
  await insertRow(admin, 'providers', {
    id,
    clinic_id: place.clinic,
    name: 'Elena Planinska',
    short_name: 'Planinska',
    kind: 'dentist',
    chair_label: 'Chair 1',
    color_hue: 195,
    sort_order: 1,
  });
  return id;
}

interface Visit {
  status: string;
  startsAt: string;
  confirmedAt?: string | null;
  completedAt?: string | null;
}

async function insertVisit(place: Place, visit: Visit): Promise<string> {
  const id = newId();
  const cancelled = visit.status === 'cancelled';
  await admin.query(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, overlap_ok, source, created_by, confirmed_at, confirmed_via,
                               cancelled_at, cancelled_by, completed_at)
     values ($1, $2, $3, $4, 'Checkup', $5::timestamptz, $5::timestamptz + make_interval(mins => 30),
             $6, false, 'staff', $7, $8, $9, $10, $11, $12)`,
    [
      id,
      place.clinic,
      place.patient,
      await provider(place),
      visit.startsAt,
      visit.status,
      creator,
      visit.confirmedAt ?? null,
      visit.confirmedAt ? 'staff' : null,
      cancelled ? visit.startsAt : null,
      cancelled ? 'staff' : null,
      visit.completedAt ?? null,
    ],
  );
  return id;
}

/** What the module accepts of one copy of the visit: the actions whose change is `ok`. */
async function accepted(place: Place, visit: Visit, now: Date): Promise<string[]> {
  const done: string[] = [];
  for (const action of ACTIONS) {
    const id = await insertVisit(place, visit);
    const common = { appointmentId: id, actor: 'staff', timeZone: place.zone } as const;
    const result = await withTenant(place.clinic, (tx) => {
      switch (action) {
        case 'cancel':
          return scheduling.changeAppointmentStatus(
            tx,
            { ...common, action, cancelledBy: 'staff', reason: null },
            now,
          );
        case 'restore':
          return scheduling.changeAppointmentStatus(
            tx,
            {
              ...common,
              action,
              anyway: false,
              patientIsActive: async (patientId) =>
                (await patients.patientStatus(tx, patientId)) === 'active',
            },
            now,
          );
        default:
          return scheduling.changeAppointmentStatus(tx, { ...common, action }, now);
      }
    });
    if (result.ok) done.push(action);
  }
  return done.sort();
}

/** What the calendar's read gives the visit as its buttons. */
async function offered(place: Place, visit: Visit, now: Date): Promise<string[]> {
  const id = await insertVisit(place, visit);
  const day = dayInZone(new Date(visit.startsAt), place.zone);
  const found = await withTenant(place.clinic, (tx) =>
    scheduling.appointmentsOnDay(tx, day, place.zone, now),
  );
  const mine = found.find((appointment) => appointment.id === id);
  if (!mine) throw new Error('the visit is not on its day');
  return [...mine.actions].sort();
}

interface Case {
  /** What it shows in the test's name. */
  name: string;
  place: () => Place;
  now: string;
  /** Two moments of the completion: on the clinic's day of `now`, and on the day before it. */
  completedToday: string;
  completedEarlier: string;
}

const CASES: Case[] = [
  {
    name: 'Skopje, a day of 24 hours',
    place: () => skopje,
    now: '2031-03-03T10:00:00Z', // 11:00 local
    completedToday: '2031-03-02T23:30:00Z', // 00:30 local on 3 March, 10.5 hours before
    completedEarlier: '2031-03-02T22:30:00Z', // 23:30 local on 2 March, 11.5 hours before
  },
  {
    name: 'New York, a day of 23 hours (9 March 2031)',
    place: () => newYork,
    now: '2031-03-10T03:30:00Z', // 23:30 local on 9 March
    completedToday: '2031-03-09T05:00:00Z', // 00:00 local, 22.5 hours before
    completedEarlier: '2031-03-09T04:59:00Z', // 23:59 local on 8 March, 22.5 hours before
  },
  {
    name: 'New York, a day of 25 hours (2 November 2031)',
    place: () => newYork,
    now: '2031-11-03T04:30:00Z', // 23:30 local on 2 November
    completedToday: '2031-11-02T04:00:00Z', // 00:00 local, 24.5 hours before
    completedEarlier: '2031-11-02T03:59:00Z', // 23:59 local on 1 November, 24.5 hours before
  },
];

const MINUTE = 60_000;

/** A start before, at and after `now`, and the visits of every status that start there. */
function visitsAround(found: Case) {
  const now = new Date(found.now).getTime();
  const starts = {
    after: new Date(now + 60 * MINUTE).toISOString(),
    at: new Date(now).toISOString(),
    before: new Date(now - 60 * MINUTE).toISOString(),
  };
  const confirmedAt = new Date(now - 24 * 60 * MINUTE).toISOString();
  const list: { name: string; visit: Visit }[] = [];
  for (const [when, startsAt] of Object.entries(starts)) {
    list.push({ name: `booked, start ${when} now`, visit: { status: 'booked', startsAt } });
    list.push({
      name: `confirmed, start ${when} now`,
      visit: { status: 'confirmed', startsAt, confirmedAt },
    });
    list.push({
      name: `arrived (was confirmed), start ${when} now`,
      visit: { status: 'arrived', startsAt, confirmedAt },
    });
    list.push({ name: `arrived, start ${when} now`, visit: { status: 'arrived', startsAt } });
    list.push({ name: `cancelled, start ${when} now`, visit: { status: 'cancelled', startsAt } });
    list.push({ name: `no_show, start ${when} now`, visit: { status: 'no_show', startsAt } });
    list.push({
      name: `completed today, start ${when} now`,
      visit: { status: 'completed', startsAt, completedAt: found.completedToday },
    });
    list.push({
      name: `completed on an earlier day, start ${when} now`,
      visit: { status: 'completed', startsAt, completedAt: found.completedEarlier },
    });
  }
  return list;
}

describe('the buttons are exactly the changes the module accepts (acceptance 1)', () => {
  it.each(CASES)(
    '$name: every status, before, at and after the start, completed today and earlier',
    async (found) => {
      const place = found.place();
      const now = new Date(found.now);
      const seen: string[] = [];
      for (const { name, visit } of visitsAround(found)) {
        const buttons = await offered(place, visit, now);
        const changes = await accepted(place, visit, now);
        expect(buttons, name).toEqual(changes);
        seen.push(`${name}: ${buttons.join(',')}`);
      }
      // The loop checked something: some visit offers no-show and some undo_completion, and some
      // visit offers neither (so a function that answers the same for all would fail).
      expect(seen.some((line) => line.includes('no_show,') || line.endsWith('no_show'))).toBe(true);
      expect(seen.some((line) => line.includes('undo_completion'))).toBe(true);
      expect(
        seen.some((line) => line.startsWith('completed on an earlier day') && line.endsWith(': ')),
      ).toBe(true);
    },
    120_000,
  );
});

describe('the read gives the buttons and what the drawer needs (acceptance 1, 3)', () => {
  it('appointmentsOnDay gives actions but not the confirmation or completion moments', async () => {
    const now = new Date('2031-03-03T10:00:00Z');
    const id = await insertVisit(skopje, {
      status: 'completed',
      startsAt: '2031-03-03T09:00:00Z',
      confirmedAt: '2031-03-01T08:00:00Z',
      completedAt: '2031-03-03T09:45:00Z',
    });
    const found = await withTenant(skopje.clinic, (tx) =>
      scheduling.appointmentsOnDay(tx, '2031-03-03', SKOPJE, now),
    );
    const mine = found.find((appointment) => appointment.id === id);
    expect(mine?.actions).toEqual(['undo_completion']);
    expect(mine).not.toHaveProperty('confirmedAt');
    expect(mine).not.toHaveProperty('completedAt');
  });

  it("the calendar's block carries the patient's id and the actions", async () => {
    const now = new Date('2031-03-10T10:00:00Z');
    const id = await insertVisit(skopje, { status: 'booked', startsAt: '2031-03-10T09:00:00Z' });
    const view = await withTenant(skopje.clinic, (tx) => readDay(tx, '2031-03-10', now));
    const blocks = view.columns.flatMap((column) => column.blocks);
    const block = blocks.find(
      (found): found is AppointmentBlock => found.kind === 'appointment' && found.id === id,
    );
    expect(block?.patientId).toBe(skopje.patient);
    expect(block?.actions).toEqual(['confirm', 'arrive', 'complete', 'no_show', 'cancel']);
  });

  it('another clinic reads nothing of this one (Row-Level Security)', async () => {
    const id = await insertVisit(skopje, { status: 'booked', startsAt: '2031-03-17T09:00:00Z' });
    const seen = await withTenant(newYork.clinic, (tx) =>
      scheduling.appointmentsOnDay(tx, '2031-03-17', NEW_YORK, new Date('2031-03-17T10:00:00Z')),
    );
    expect(seen.map((appointment) => appointment.id)).not.toContain(id);
  });
});

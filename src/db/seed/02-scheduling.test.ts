import { describe, expect, it } from 'vitest';
import { clinicsAndStaff } from './01-clinics-and-staff';
import { MIDDAY, scheduling } from './02-scheduling';
import { isoWeekday, minutesOf, type CalendarDay } from './seed-day';
import type { SeedRow } from './seed-files';
import {
  SEEDED_CLINICS,
  SEEDED_MEMBERSHIPS,
  SEEDED_PEOPLE,
  SEEDED_PROVIDERS,
  SEEDED_TIME_ZONE,
} from './seeded';

// E01-T01b, acceptance 2 and 4: the rows the scheduling seed file makes for a fixed day, read
// without a database. CI runs these tests again in Pacific/Auckland: the rows must not change with
// the computer's time zone. The days are those of one week; the clocks go back on its Sunday.

const WEEK = [
  { day: '2026-10-19', name: 'Monday' },
  { day: '2026-10-20', name: 'Tuesday' },
  { day: '2026-10-21', name: 'Wednesday' },
  { day: '2026-10-22', name: 'Thursday' },
  { day: '2026-10-23', name: 'Friday' },
  { day: '2026-10-24', name: 'Saturday' },
  { day: '2026-10-25', name: 'Sunday' },
];
const ITS_WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
const NEXT_WEEK = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];

const STATUSES = ['booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'];
/** The statuses that fit a visit: on a day before the seed's day, its morning, after it. */
const DONE = ['completed', 'no_show', 'cancelled'];
const MORNING = ['completed', 'no_show', 'arrived'];
const TO_COME = ['booked', 'confirmed', 'cancelled'];

const HARBOUR_STREET = SEEDED_CLINICS.harbourStreet;
const SONCOGLED = SEEDED_CLINICS.soncogled;

/** The file's rows of one table, those made for the day included. */
function rows(table: string, day: CalendarDay = ITS_WEEK[0]!): readonly SeedRow[] {
  return [...(scheduling.tables ?? []), ...(scheduling.dayTables?.(day) ?? [])]
    .filter((rowsOf) => rowsOf.table === table)
    .flatMap((rowsOf) => rowsOf.rows);
}

/** A moment the file wrote, `2026-10-19 08:00 Europe/Skopje`, read back. */
function moment(value: unknown): { date: CalendarDay; time: string } {
  const [date = '', time = '', zone, ...rest] = String(value).split(' ');
  expect([zone, ...rest], 'the zone of the seeded clinics, and nothing after it').toEqual([
    SEEDED_TIME_ZONE,
  ]);
  return { date, time };
}

interface Visit {
  row: SeedRow;
  date: CalendarDay;
  startTime: string;
  start: number;
  end: number;
}

/** The appointments the file makes for the day, with their dates and times in minutes. */
function visitsFor(day: CalendarDay): Visit[] {
  return rows('appointments', day).map((row) => {
    const starts = moment(row.starts_at);
    const ends = moment(row.ends_at);
    expect(ends.date, `${row.id} ends on the day it starts`).toBe(starts.date);
    return {
      row,
      date: starts.date,
      startTime: starts.time,
      start: minutesOf(starts.time),
      end: minutesOf(ends.time),
    };
  });
}

const distinct = (values: readonly unknown[]) => [...new Set(values)].sort();

describe.each(WEEK.slice(0, 5))('for a $name ($day)', ({ day }) => {
  it('the appointments are that week, Monday to Friday, some of them on the day itself', () => {
    const visits = visitsFor(day);
    expect(distinct(visits.map((visit) => visit.date))).toEqual(ITS_WEEK);
    expect(visits.filter((visit) => visit.date === day).length).toBeGreaterThan(0);
  });

  it('they hold every status, and so does the day itself', () => {
    const visits = visitsFor(day);
    expect(distinct(visits.map((visit) => visit.row.status))).toEqual([...STATUSES].sort());
    const onTheDay = visits.filter((visit) => visit.date === day);
    expect(distinct(onTheDay.map((visit) => visit.row.status))).toEqual([...STATUSES].sort());
  });

  it('each status fits where its day falls: before the day, its morning and afternoon, after it', () => {
    const misfits = visitsFor(day).flatMap(({ row, date, startTime }) => {
      let fits = TO_COME;
      if (date < day) fits = DONE;
      else if (date === day && startTime < MIDDAY) fits = MORNING;
      return fits.includes(String(row.status)) ? [] : [`${row.id}: ${String(row.status)}`];
    });
    expect(misfits).toEqual([]);
  });
});

describe.each(WEEK.slice(5))('for a $name ($day)', ({ day }) => {
  it('the appointments are the next week, Monday to Friday, all still to come', () => {
    const visits = visitsFor(day);
    expect(distinct(visits.map((visit) => visit.date))).toEqual(NEXT_WEEK);
    expect(distinct(visits.map((visit) => visit.row.status))).toEqual([...TO_COME].sort());
  });
});

describe.each(WEEK)('the week made for a $name ($day)', ({ day }) => {
  it("has no two visits of one provider that overlap unless one is booked anyway, none outside opening hours, on a closed day or in its provider's break", () => {
    const visits = visitsFor(day);
    const hours = rows('clinic_hours');
    const breaks = rows('provider_breaks');
    const closed = rows('closed_days', day);
    const problems: string[] = [];
    for (const visit of visits) {
      const { row, date, start, end } = visit;
      const weekday = isoWeekday(date);
      for (const other of visits) {
        const overlaps = other.start < end && start < other.end;
        if (
          other.row.id > row.id &&
          other.row.provider_id === row.provider_id &&
          other.date === date &&
          overlaps &&
          !row.overlap_ok &&
          !other.row.overlap_ok
        ) {
          problems.push(`${row.id} overlaps ${other.row.id}`);
        }
      }
      const open = hours.find((h) => h.clinic_id === row.clinic_id && h.weekday === weekday);
      if (!open) problems.push(`${row.id} is on a day its clinic is not open`);
      else if (start < minutesOf(String(open.opens)) || end > minutesOf(String(open.closes))) {
        problems.push(`${row.id} lies outside opening hours`);
      }
      if (closed.some((c) => c.clinic_id === row.clinic_id && c.date === date)) {
        problems.push(`${row.id} is on a closed day`);
      }
      for (const lunch of breaks) {
        if (lunch.provider_id !== row.provider_id || lunch.weekday !== weekday) continue;
        if (start < minutesOf(String(lunch.ends)) && minutesOf(String(lunch.starts)) < end) {
          problems.push(`${row.id} lies in its provider's break`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('sets the moments its status leaves, taken from the days, and no others', () => {
    const problems: string[] = [];
    for (const { row, date } of visitsFor(day)) {
      const status = String(row.status);
      const set = (column: string) => row[column] !== null;
      // As the state machine leaves them: a visit confirmed first may since have arrived, been
      // completed, cancelled or missed, and keeps its confirmation; a booked one has none.
      const rules: [boolean, string][] = [
        [
          set('confirmed_at') === set('confirmed_via'),
          'confirmed_at and confirmed_via go together',
        ],
        [status !== 'confirmed' || set('confirmed_at'), 'a confirmed visit has confirmed_at'],
        [status !== 'booked' || !set('confirmed_at'), 'a booked visit has no confirmed_at'],
        [set('cancelled_at') === (status === 'cancelled'), 'cancelled_at only when cancelled'],
        [set('cancelled_by') === (status === 'cancelled'), 'cancelled_by only when cancelled'],
        [set('completed_at') === (status === 'completed'), 'completed_at only when completed'],
        [!set('completed_at') || row.completed_at === row.ends_at, 'completed as it ended'],
      ];
      // Confirmed and cancelled on a day before the visit's, and before the seed's day.
      const before = date < day ? date : day;
      for (const column of ['confirmed_at', 'cancelled_at']) {
        if (set(column)) rules.push([moment(row[column]).date < before, `${column} comes first`]);
      }
      for (const [kept, rule] of rules) if (!kept) problems.push(`${row.id}: ${rule}`);
    }
    expect(problems).toEqual([]);
  });

  it('has a closed day after the week, on a weekday the clinic is otherwise open', () => {
    const [closed, ...others] = rows('closed_days', day);
    expect(others).toEqual([]);
    const weekEnd = day < '2026-10-24' ? ITS_WEEK[4]! : NEXT_WEEK[4]!;
    expect(String(closed?.date) > weekEnd).toBe(true);
    expect(
      rows('clinic_hours').some(
        (h) => h.clinic_id === closed?.clinic_id && h.weekday === isoWeekday(String(closed?.date)),
      ),
    ).toBe(true);
  });
});

describe('the rows depend on the day only', () => {
  it('the same day gives the same rows, and every day of the week the same ids and times', () => {
    expect(scheduling.dayTables?.('2026-10-21')).toEqual(scheduling.dayTables?.('2026-10-21'));
    const idsAndTimes = (day: CalendarDay) =>
      rows('appointments', day).map(({ id, starts_at, ends_at }) => [id, starts_at, ends_at]);
    for (const { day } of WEEK.slice(1, 5)) {
      expect(idsAndTimes(day), day).toEqual(idsAndTimes(ITS_WEEK[0]!));
    }
  });

  it('one visit is booked anyway: it overlaps another of its provider, which is not', () => {
    const visits = visitsFor(ITS_WEEK[0]!);
    const anyway = visits.filter((visit) => visit.row.overlap_ok);
    expect(anyway).toHaveLength(1);
    const [squeezed] = anyway;
    const under = visits.filter(
      (visit) =>
        visit !== squeezed &&
        visit.row.provider_id === squeezed?.row.provider_id &&
        visit.date === squeezed?.date &&
        visit.start < squeezed.end &&
        squeezed.start < visit.end,
    );
    expect(under.map((visit) => visit.row.overlap_ok)).toEqual([false]);
  });
});

describe('the patients', () => {
  const patients = rows('patients');
  const harbourStreet = patients.filter((patient) => patient.clinic_id === HARBOUR_STREET);
  const latin = /^[\p{Script=Latin}]+$/u;
  const cyrillic = /^[\p{Script=Cyrillic}]+$/u;
  const inOneScript = (patient: SeedRow, script: RegExp) =>
    script.test(String(patient.first_name)) && script.test(String(patient.last_name));

  it('40 at Harbour Street and five at the second clinic', () => {
    expect(harbourStreet).toHaveLength(40);
    expect(patients.filter((patient) => patient.clinic_id === SONCOGLED)).toHaveLength(5);
  });

  it('include one without a phone, one archived, one with a guardian, two siblings sharing a phone, and names in both scripts', () => {
    expect(harbourStreet.some((patient) => patient.phone_e164 === null)).toBe(true);
    expect(harbourStreet.some((patient) => patient.status === 'archived')).toBe(true);
    expect(harbourStreet.some((patient) => patient.guardian_name !== null)).toBe(true);

    const phones = harbourStreet.map((patient) => patient.phone_e164).filter(Boolean);
    const shared = phones.filter((phone, index) => phones.indexOf(phone) !== index);
    expect(shared).toHaveLength(1);
    const siblings = harbourStreet.filter((patient) => patient.phone_e164 === shared[0]);
    expect(siblings).toHaveLength(2);
    expect(distinct(siblings.map((sibling) => sibling.last_name))).toHaveLength(1);

    expect(harbourStreet.some((patient) => inOneScript(patient, latin))).toBe(true);
    expect(harbourStreet.some((patient) => inOneScript(patient, cyrillic))).toBe(true);
    for (const patient of patients) {
      expect(inOneScript(patient, latin) || inOneScript(patient, cyrillic), patient.id).toBe(true);
    }
  });

  it('write messages in English (D-053), and are active unless archived', () => {
    expect(distinct(patients.map((patient) => patient.language))).toEqual(['en']);
    expect(distinct(patients.map((patient) => patient.status))).toEqual(['active', 'archived']);
  });
});

describe('the appointments, whatever the day', () => {
  it.each(WEEK)(
    'on a $name, each points at a patient, a provider and a treatment type of its own clinic',
    ({ day }) => {
      const clinicOf = (table: string) =>
        new Map(rows(table).map((row) => [row.id, row.clinic_id]));
      const patients = clinicOf('patients');
      const providers = clinicOf('providers');
      const treatmentTypes = clinicOf('treatment_types');
      const problems = rows('appointments', day).flatMap((row) => [
        ...(patients.get(row.patient_id as string) === row.clinic_id ? [] : [`${row.id}: patient`]),
        ...(providers.get(row.provider_id as string) === row.clinic_id
          ? []
          : [`${row.id}: provider`]),
        ...(row.treatment_type_id === null ||
        treatmentTypes.get(row.treatment_type_id as string) === row.clinic_id
          ? []
          : [`${row.id}: treatment type`]),
      ]);
      expect(problems).toEqual([]);
    },
  );

  it('the archived patient has none, and no patient is in two places at once', () => {
    const visits = visitsFor(ITS_WEEK[0]!);
    const archived = rows('patients').filter((patient) => patient.status === 'archived');
    for (const patient of archived) {
      expect(visits.filter((visit) => visit.row.patient_id === patient.id)).toEqual([]);
    }
    const clashes = visits.flatMap((visit) =>
      visits
        .filter(
          (other) =>
            other.row.id > visit.row.id &&
            other.row.patient_id === visit.row.patient_id &&
            other.date === visit.date &&
            other.start < visit.end &&
            visit.start < other.end,
        )
        .map((other) => `${visit.row.id} and ${other.row.id}`),
    );
    expect(clashes).toEqual([]);
  });

  it("Harbour Street's point at its treatment types, booked by its front desk; the second clinic's at none", () => {
    const appointments = rows('appointments');
    const of = (clinic: string) => appointments.filter((row) => row.clinic_id === clinic);
    expect(of(HARBOUR_STREET).every((row) => row.treatment_type_id !== null)).toBe(true);
    expect(distinct(of(HARBOUR_STREET).map((row) => row.created_by))).toEqual([
      SEEDED_PEOPLE.frontDesk.id,
    ]);
    expect(distinct(of(SONCOGLED).map((row) => row.treatment_type_id))).toEqual([null]);
    expect(distinct(of(SONCOGLED).map((row) => row.created_by))).toEqual([
      SEEDED_PEOPLE.soncogledFrontDesk.id,
    ]);
  });
});

describe('the clinics, their providers and their catalogue', () => {
  it("Harbour Street has the demo's three providers, with their chairs and hues and a lunch break every working day; the second clinic one dentist", () => {
    const providers = rows('providers');
    const at = (clinic: string) => providers.filter((provider) => provider.clinic_id === clinic);
    expect(
      at(HARBOUR_STREET).map((p) => [p.kind, p.chair_label, p.color_hue, p.sort_order]),
    ).toEqual([
      ['dentist', 'Chair 1', 195, 1],
      ['dentist', 'Chair 2', 290, 2],
      ['hygienist', 'Chair 3', 55, 3],
    ]);
    for (const provider of at(HARBOUR_STREET)) {
      const lunches = rows('provider_breaks').filter((row) => row.provider_id === provider.id);
      expect(lunches.map((row) => [row.weekday, row.label])).toEqual(
        [1, 2, 3, 4, 5].map((weekday) => [weekday, 'Lunch']),
      );
    }
    expect(at(SONCOGLED).map((p) => p.kind)).toEqual(['dentist']);
  });

  it("Harbour Street's catalogue is the demo's ten treatment types with their lengths", () => {
    const treatmentTypes = rows('treatment_types');
    expect(distinct(treatmentTypes.map((row) => row.clinic_id))).toEqual([HARBOUR_STREET]);
    expect(treatmentTypes.map((row) => [row.name, row.default_duration_min])).toEqual([
      ['Checkup', 30],
      ['Cleaning', 45],
      ['Filling', 45],
      ['Crown prep', 90],
      ['Crown fit', 60],
      ['Root canal', 90],
      ['Extraction', 45],
      ['Consultation', 30],
      ['Emergency', 30],
      ['Whitening', 60],
    ]);
  });

  it('both clinics open Monday to Friday, 08:00 to 18:00', () => {
    for (const clinic of [HARBOUR_STREET, SONCOGLED]) {
      const hours = rows('clinic_hours').filter((row) => row.clinic_id === clinic);
      expect(hours.map((row) => [row.weekday, row.opens, row.closes])).toEqual(
        [1, 2, 3, 4, 5].map((weekday) => [weekday, '08:00', '18:00']),
      );
    }
  });

  it('are in the time zone the seed takes its day in', () => {
    const clinics = clinicsAndStaff.tables?.find((rowsOf) => rowsOf.table === 'clinics')?.rows;
    expect(clinics?.map((clinic) => clinic.timezone)).toEqual([SEEDED_TIME_ZONE, SEEDED_TIME_ZONE]);
  });

  it("links the seeded dentist and hygienist to their own clinic's providers of their kinds, and not the owner", () => {
    const providers = new Map(rows('providers').map((row) => [row.id, row]));
    expect(
      scheduling.providerLinks?.map(({ membershipId, providerId }) => [
        membershipId,
        providers.get(providerId)?.kind,
        providers.get(providerId)?.clinic_id,
      ]),
    ).toEqual([
      [SEEDED_MEMBERSHIPS.harbourStreetDentist, 'dentist', HARBOUR_STREET],
      [SEEDED_MEMBERSHIPS.harbourStreetHygienist, 'hygienist', HARBOUR_STREET],
    ]);
    expect(scheduling.providerLinks?.map((link) => link.providerId)).toEqual([
      SEEDED_PROVIDERS.harbourStreetDentist,
      SEEDED_PROVIDERS.harbourStreetHygienist,
    ]);
  });
});

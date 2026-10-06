import { EMAIL_DOMAIN, fakePhone } from './fake-data';
import { addDays, addMinutes, localMoment, seedWeek, type CalendarDay } from './seed-day';
import type { SeedFile, SeedRow } from './seed-files';
import {
  SEEDED_CLINICS,
  SEEDED_MEMBERSHIPS,
  SEEDED_PEOPLE,
  SEEDED_PROVIDERS,
  SEEDED_TIME_ZONE,
  seededId,
} from './seeded';

/*
 * The second seed file (E01-T01b): Harbour Street Dental as a working week. Its three providers
 * (two dentists and a hygienist, the demo's chairs and hues, a lunch break each), opening hours, a
 * closed day after the week, the demo's ten treatment types, 40 patients and a week of
 * appointments. The second clinic has the same hours, one dentist, five patients and a few
 * appointments; it keeps no catalogue, so its appointments have no treatment type. The seeded
 * dentist and hygienist are linked to their columns; the owner stays unlinked.
 *
 * The week is Monday to Friday of the seed's day (of the next week on a Saturday or a Sunday), in
 * the seeded clinics' zone. An appointment's status follows from where its day falls and from its
 * mark in the plan: the rows depend on the day only, never on the hour the seed runs.
 */

/** A seeded clinic: who books its appointments, and whether they point at its treatment types. */
interface Clinic {
  id: string;
  bookedBy: string;
  catalogue: boolean;
}

const HARBOUR_STREET: Clinic = {
  id: SEEDED_CLINICS.harbourStreet,
  bookedBy: SEEDED_PEOPLE.frontDesk.id,
  catalogue: true,
};
const SONCOGLED: Clinic = {
  id: SEEDED_CLINICS.soncogled,
  bookedBy: SEEDED_PEOPLE.soncogledFrontDesk.id,
  catalogue: false,
};

/** Both clinics' working days (ISO, Monday to Friday) and hours. */
const WORKING_DAYS = [1, 2, 3, 4, 5] as const;
const OPENS = '08:00';
const CLOSES = '18:00';

/**
 * The time the seed's day stands at: on that day, a visit that starts before it is over or under
 * way, and one that starts from it on is still to come.
 */
export const MIDDAY = '12:00';

/** The demo's ten treatments (line 1518), lengths in minutes: Harbour Street's catalogue. */
const TREATMENTS = {
  checkup: { n: 1, name: 'Checkup', minutes: 30 },
  cleaning: { n: 2, name: 'Cleaning', minutes: 45 },
  filling: { n: 3, name: 'Filling', minutes: 45 },
  crownPrep: { n: 4, name: 'Crown prep', minutes: 90 },
  crownFit: { n: 5, name: 'Crown fit', minutes: 60 },
  rootCanal: { n: 6, name: 'Root canal', minutes: 90 },
  extraction: { n: 7, name: 'Extraction', minutes: 45 },
  consultation: { n: 8, name: 'Consultation', minutes: 30 },
  emergency: { n: 9, name: 'Emergency', minutes: 30 },
  whitening: { n: 10, name: 'Whitening', minutes: 60 },
} as const;
type Treatment = keyof typeof TREATMENTS;

/**
 * What becomes of a visit besides being booked, by where its day falls (statusOf):
 * - `confirmed`: confirmed ahead, and completed once over;
 * - `in_chair`: arrived on the seed's day; completed on a day before it, booked on one after;
 * - `no_show`: a no-show once over, booked until then;
 * - `cancelled`: cancelled, whatever the day;
 * - `booked_anyway`: booked over another visit of its provider (`overlap_ok`, D-020), otherwise as
 *   a visit without a mark.
 * Only a visit that starts before MIDDAY is `in_chair` or `no_show`, and only one from MIDDAY on is
 * `cancelled`: on the seed's day the morning holds completed, no-show and arrived visits, the
 * afternoon booked, confirmed and cancelled ones (02-scheduling.test.ts checks it).
 */
type Mark = 'confirmed' | 'in_chair' | 'no_show' | 'cancelled' | 'booked_anyway';

/** A visit of the plan: when it starts, the treatment, the patient's number and its mark. */
type Visit = readonly [start: string, treatment: Treatment, patient: number, mark?: Mark];

/** One provider's plan: the visits of each day from Monday to Friday. */
type Week = readonly [Visit[], Visit[], Visit[], Visit[], Visit[]];

interface Provider {
  id: string;
  clinic: Clinic;
  name: string;
  shortName: string;
  kind: 'dentist' | 'hygienist';
  chair: string;
  hue: number;
  sortOrder: number;
  /** The lunch break of every working day: from, to. */
  lunch: readonly [string, string] | null;
  week: Week;
}

/**
 * The providers and their weeks. Harbour Street's are the demo's three (lines 1369–1373): chairs
 * 1 to 3, hues 195, 290 and 55; their names come from the invented lists. A visit's patient is the
 * number of their line in PATIENTS.
 */
const PROVIDERS: readonly Provider[] = [
  {
    id: SEEDED_PROVIDERS.harbourStreetDentist,
    clinic: HARBOUR_STREET,
    name: 'Elena Planinska',
    shortName: 'Dr. Planinska',
    kind: 'dentist',
    chair: 'Chair 1',
    hue: 195,
    sortOrder: 1,
    lunch: ['12:00', '13:00'],
    week: [
      [
        ['08:00', 'checkup', 1],
        ['08:45', 'filling', 2, 'confirmed'],
        ['10:00', 'rootCanal', 3],
        ['13:00', 'crownPrep', 5, 'confirmed'],
        ['15:00', 'extraction', 7, 'cancelled'],
      ],
      [
        ['08:00', 'consultation', 10],
        ['08:45', 'filling', 11, 'no_show'],
        ['10:00', 'crownPrep', 24, 'confirmed'],
        ['13:00', 'filling', 25],
        ['14:30', 'extraction', 26, 'confirmed'],
      ],
      [
        ['08:00', 'filling', 35],
        ['09:00', 'checkup', 36, 'confirmed'],
        ['09:45', 'rootCanal', 37],
        ['13:00', 'filling', 38, 'cancelled'],
        ['14:30', 'crownPrep', 39, 'confirmed'],
      ],
      [
        ['08:00', 'checkup', 16],
        ['09:00', 'filling', 3, 'confirmed'],
        ['10:00', 'extraction', 27, 'no_show'],
        ['13:00', 'rootCanal', 28, 'confirmed'],
        ['15:00', 'filling', 31],
      ],
      [
        ['08:00', 'filling', 39, 'confirmed'],
        ['09:00', 'extraction', 40],
        ['10:00', 'rootCanal', 11, 'no_show'],
        ['13:00', 'crownFit', 5, 'confirmed'],
        ['14:30', 'filling', 17],
      ],
    ],
  },
  {
    id: SEEDED_PROVIDERS.harbourStreetSecondDentist,
    clinic: HARBOUR_STREET,
    name: 'Arben Kodra',
    shortName: 'Dr. Kodra',
    kind: 'dentist',
    chair: 'Chair 2',
    hue: 290,
    sortOrder: 2,
    lunch: ['13:00', '14:00'],
    week: [
      [
        ['08:30', 'filling', 8, 'no_show'],
        ['10:00', 'crownFit', 9, 'confirmed'],
        ['11:30', 'filling', 12, 'in_chair'],
        ['14:00', 'whitening', 13, 'confirmed'],
        ['15:30', 'checkup', 14],
      ],
      [
        ['08:00', 'checkup', 27, 'confirmed'],
        ['09:00', 'rootCanal', 28],
        ['11:30', 'filling', 17, 'in_chair'],
        ['14:00', 'crownFit', 29, 'cancelled'],
        ['15:30', 'filling', 23, 'confirmed'],
      ],
      [
        ['08:30', 'extraction', 40, 'no_show'],
        ['09:30', 'rootCanal', 30],
        // An emergency squeezed in during the root canal: booked anyway.
        ['10:00', 'emergency', 2, 'booked_anyway'],
        ['11:30', 'filling', 9, 'in_chair'],
        ['14:00', 'whitening', 6, 'confirmed'],
        ['15:30', 'consultation', 14],
      ],
      [
        ['08:30', 'consultation', 32, 'confirmed'],
        ['09:15', 'filling', 33],
        ['11:30', 'crownFit', 24, 'in_chair'],
        ['14:00', 'filling', 34, 'cancelled'],
        ['15:30', 'whitening', 35, 'confirmed'],
      ],
      [
        ['08:00', 'checkup', 18],
        ['08:45', 'checkup', 26, 'confirmed'],
        ['11:30', 'filling', 29, 'in_chair'],
        ['14:00', 'consultation', 30, 'cancelled'],
        ['15:00', 'crownPrep', 1, 'confirmed'],
      ],
    ],
  },
  {
    id: SEEDED_PROVIDERS.harbourStreetHygienist,
    clinic: HARBOUR_STREET,
    name: 'Mimoza Lumi',
    shortName: 'M. Lumi',
    kind: 'hygienist',
    chair: 'Chair 3',
    hue: 55,
    sortOrder: 3,
    lunch: ['12:30', '13:15'],
    week: [
      [
        ['08:00', 'cleaning', 4],
        ['09:00', 'cleaning', 6, 'confirmed'],
        ['11:45', 'cleaning', 16, 'in_chair'],
        ['14:00', 'cleaning', 15],
        ['16:00', 'cleaning', 18, 'confirmed'],
      ],
      [
        ['08:00', 'cleaning', 31, 'confirmed'],
        ['09:00', 'cleaning', 32],
        ['11:45', 'cleaning', 33, 'in_chair'],
        ['13:30', 'cleaning', 34, 'confirmed'],
        ['15:30', 'checkup', 19],
      ],
      [
        ['08:00', 'cleaning', 7, 'confirmed'],
        ['09:00', 'cleaning', 8],
        ['11:45', 'cleaning', 10, 'in_chair'],
        ['13:15', 'cleaning', 12, 'confirmed'],
        ['15:00', 'checkup', 15],
      ],
      [
        ['08:00', 'cleaning', 36],
        ['09:00', 'cleaning', 37, 'confirmed'],
        ['11:45', 'cleaning', 38, 'in_chair'],
        // The two siblings, one after the other.
        ['15:00', 'checkup', 20],
        ['15:30', 'checkup', 21, 'confirmed'],
      ],
      [
        ['08:00', 'cleaning', 13, 'confirmed'],
        ['09:00', 'cleaning', 14],
        ['11:45', 'cleaning', 23, 'in_chair'],
        ['13:15', 'cleaning', 25],
        ['14:30', 'checkup', 4],
      ],
    ],
  },
  {
    id: SEEDED_PROVIDERS.soncogledDentist,
    clinic: SONCOGLED,
    name: 'Љубица Ќошкова',
    shortName: 'Д-р Ќошкова',
    kind: 'dentist',
    chair: 'Chair 1',
    hue: 160,
    sortOrder: 1,
    lunch: null,
    week: [
      [
        ['09:00', 'checkup', 41],
        ['14:00', 'filling', 42, 'confirmed'],
      ],
      [
        ['10:00', 'extraction', 43, 'no_show'],
        ['15:00', 'consultation', 44, 'cancelled'],
      ],
      [
        ['09:30', 'filling', 45, 'confirmed'],
        ['13:00', 'checkup', 41],
      ],
      [
        ['11:30', 'crownPrep', 42, 'in_chair'],
        ['16:00', 'checkup', 43],
      ],
      [
        ['08:30', 'cleaning', 44],
        ['14:30', 'filling', 45, 'confirmed'],
      ],
    ],
  },
];

/**
 * A patient: number (their id is seededId('patients', n)), first and last name, date of birth,
 * phone (the n-th number of the block) and email (before the @), each or null, and what else is
 * true of them.
 */
type PatientLine = readonly [
  n: number,
  first: string,
  last: string,
  born: string,
  phone: number | null,
  email: string | null,
  extra?: { guardian?: string; status?: 'archived' },
];

/**
 * The patients, a line each: 1–40 at Harbour Street, 41–45 at the second clinic. Names from the
 * invented lists, in Latin and in Cyrillic letters (D-049). Three have no phone, one of them no
 * email either. A child's phone and email are their guardian's (D-033): one child, and two
 * siblings who share their guardian's phone. One patient is archived and has no appointments.
 */
const PATIENTS: readonly (readonly [Clinic, readonly PatientLine[]])[] = [
  [
    HARBOUR_STREET,
    [
      [1, 'Ana', 'Brezovska', '1988-03-14', 101, 'ana.brezovska'],
      [2, 'Bojan', 'Kamenov', '1975-11-02', 102, null],
      [3, 'Elena', 'Kodra', '1992-06-21', 103, 'elena.kodra'],
      [4, 'Marko', 'Ezerovski', '1983-01-30', 104, 'marko.ezerovski'],
      [5, 'Arben', 'Dardha', '1969-09-08', 105, null],
      [6, 'Blerina', 'Shkëmbi', '1996-12-17', 106, 'blerina.shkembi'],
      [7, 'Shpëtim', 'Lumi', '1958-04-25', 107, null],
      [8, 'Mimoza', 'Kodra', '2001-07-11', 108, 'mimoza.kodra'],
      [9, 'Ana', 'Lumi', '1990-02-03', 109, 'ana.lumi'],
      [10, 'Bojan', 'Ezerovski', '1985-10-19', 110, null],
      [11, 'Elena', 'Brezovska', '1979-05-28', null, 'elena.brezovska'],
      [12, 'Marko', 'Kamenov', '1994-08-07', 112, 'marko.kamenov'],
      [13, 'Arben', 'Shkëmbi', '1987-03-22', 113, null],
      [14, 'Blerina', 'Dardha', '1998-01-09', 114, 'blerina.dardha'],
      [15, 'Shpëtim', 'Kodra', '1972-11-15', 115, null],
      [16, 'Mimoza', 'Dardha', '1951-06-30', 116, null],
      [17, 'Ana', 'Dardha', '1980-09-12', 117, 'ana.dardha'],
      [18, 'Elena', 'Shkëmbi', '1993-04-04', null, null],
      [
        19,
        'Shpëtim',
        'Shkëmbi',
        '2016-02-11',
        119,
        'mimoza.shkembi',
        { guardian: 'Mimoza Shkëmbi' },
      ],
      [20, 'Arben', 'Lumi', '2014-09-03', 120, 'elena.lumi', { guardian: 'Elena Lumi' }],
      [21, 'Blerina', 'Lumi', '2017-03-27', 120, 'elena.lumi', { guardian: 'Elena Lumi' }],
      [22, 'Ana', 'Planinska', '1965-12-01', 122, null, { status: 'archived' }],
      [23, 'Јована', 'Лозанова', '1991-07-19', 123, 'jovana.lozanova'],
      [24, 'Ѓорѓи', 'Каменов', '1966-03-05', 124, null],
      [25, 'Љубица', 'Брезовска', '1984-10-23', 125, 'ljubica.brezovska'],
      [26, 'Стефан', 'Њивовски', '1999-01-14', 126, 'stefan.njivovski'],
      [27, 'Ана', 'Ќошкова', '1977-08-29', 127, null],
      [28, 'Бојан', 'Ѕвездовски', '1989-05-02', 128, 'bojan.dzvezdovski'],
      [29, 'Елена', 'Лозанова', '1962-02-17', 129, null],
      [30, 'Марко', 'Њивовски', '1995-11-08', null, 'marko.njivovski'],
      [31, 'Јована', 'Планинска', '1986-06-06', 131, 'jovana.planinska'],
      [32, 'Ѓорѓи', 'Езеровски', '1970-12-24', 132, null],
      [33, 'Љубица', 'Планинска', '1997-09-15', 133, 'ljubica.planinska'],
      [34, 'Стефан', 'Езеровски', '1981-04-18', 134, null],
      [35, 'Ана', 'Лозанова', '2003-01-27', 135, 'ana.lozanova'],
      [36, 'Марко', 'Ѕвездовски', '1964-07-03', 136, null],
      [37, 'Елена', 'Ќошкова', '1990-10-10', 137, 'elena.kjoshkova'],
      [38, 'Ѓорѓи', 'Ѕвездовски', '1955-02-28', 138, null],
      [39, 'Јована', 'Брезовска', '2000-05-21', 139, 'jovana.brezovska'],
      [40, 'Стефан', 'Ѕвездовски', '1976-08-16', 140, 'stefan.dzvezdovski'],
    ],
  ],
  [
    SONCOGLED,
    [
      [41, 'Јована', 'Ќошкова', '1993-03-09', 141, 'jovana.kjoshkova'],
      [42, 'Бојан', 'Њивовски', '1971-10-30', 142, null],
      [43, 'Љубица', 'Лозанова', '1985-12-12', 143, 'ljubica.lozanova'],
      [44, 'Ѓорѓи', 'Њивовски', '2004-04-07', 144, null],
      [45, 'Стефан', 'Каменов', '1960-06-19', 145, 'stefan.kamenov'],
    ],
  ],
];

const providerRows: SeedRow[] = PROVIDERS.map((provider) => ({
  id: provider.id,
  clinic_id: provider.clinic.id,
  name: provider.name,
  short_name: provider.shortName,
  kind: provider.kind,
  chair_label: provider.chair,
  color_hue: provider.hue,
  sort_order: provider.sortOrder,
}));

const breakRows: SeedRow[] = PROVIDERS.flatMap(({ id, clinic, lunch }) =>
  lunch === null
    ? []
    : WORKING_DAYS.map((weekday) => ({
        clinic_id: clinic.id,
        provider_id: id,
        weekday,
        starts: lunch[0],
        ends: lunch[1],
        label: 'Lunch',
      })),
).map((row, index) => ({ id: seededId('provider_breaks', index + 1), ...row }));

const treatmentTypeRows: SeedRow[] = Object.values(TREATMENTS).map(({ n, name, minutes }) => ({
  id: seededId('treatment_types', n),
  clinic_id: HARBOUR_STREET.id,
  name,
  default_duration_min: minutes,
}));

const clinicHoursRows: SeedRow[] = [HARBOUR_STREET, SONCOGLED]
  .flatMap((clinic) =>
    WORKING_DAYS.map((weekday) => ({
      clinic_id: clinic.id,
      weekday,
      opens: OPENS,
      closes: CLOSES,
    })),
  )
  .map((row, index) => ({ id: seededId('clinic_hours', index + 1), ...row }));

const patientRows: SeedRow[] = PATIENTS.flatMap(([clinic, lines]) =>
  lines.map(([n, first, last, born, phone, email, extra]) => ({
    id: seededId('patients', n),
    clinic_id: clinic.id,
    first_name: first,
    last_name: last,
    date_of_birth: born,
    phone_e164: phone === null ? null : fakePhone(phone),
    email: email === null ? null : `${email}@${EMAIL_DOMAIN}`,
    language: 'en',
    guardian_name: extra?.guardian ?? null,
    status: extra?.status ?? 'active',
  })),
);

/** A visit's status on the seed's day, from where the visit's own day falls and its mark. */
function statusOf(visitDay: CalendarDay, start: string, mark: Mark | undefined, day: CalendarDay) {
  if (mark === 'cancelled') return 'cancelled';
  const over = visitDay < day || (visitDay === day && start < MIDDAY);
  if (!over) return mark === 'confirmed' ? 'confirmed' : 'booked';
  if (mark === 'no_show') return 'no_show';
  if (mark === 'in_chair' && visitDay === day) return 'arrived';
  return 'completed';
}

/** Alternates between two values along the plan, so both of a column's values are seeded. */
function alternate<T>(n: number, odd: T, even: T): T {
  return n % 2 === 1 ? odd : even;
}

/**
 * The week's appointments for the seed's day, numbered in the plan's order: the same day gives the
 * same rows, and every day the same ids. The moments a status leaves come from the days, as the
 * state machine leaves them: a visit is confirmed at 18:30 and cancelled at 10:15 on the day
 * before its own, or before the seed's day when that comes first; it is completed when it ends.
 */
function appointmentRows(day: CalendarDay): SeedRow[] {
  const week = seedWeek(day);
  const at = (date: CalendarDay, time: string) => localMoment(date, time, SEEDED_TIME_ZONE);
  let n = 0;
  return PROVIDERS.flatMap((provider) =>
    provider.week.flatMap((visits, weekdayIndex) =>
      visits.map(([start, key, patient, mark]) => {
        n += 1;
        const visitDay = week[weekdayIndex]!;
        const treatment = TREATMENTS[key];
        const end = addMinutes(start, treatment.minutes);
        const status = statusOf(visitDay, start, mark, day);
        const dayBefore = addDays(visitDay < day ? visitDay : day, -1);
        const confirmed =
          mark === 'confirmed' && (status === 'confirmed' || status === 'completed');
        const cancelled = status === 'cancelled';
        return {
          id: seededId('appointments', n),
          clinic_id: provider.clinic.id,
          patient_id: seededId('patients', patient),
          provider_id: provider.id,
          treatment_type_id: provider.clinic.catalogue
            ? seededId('treatment_types', treatment.n)
            : null,
          title: treatment.name,
          starts_at: at(visitDay, start),
          ends_at: at(visitDay, end),
          status,
          overlap_ok: mark === 'booked_anyway',
          source: 'staff',
          confirmed_at: confirmed ? at(dayBefore, '18:30') : null,
          confirmed_via: confirmed ? alternate(n, 'link', 'staff') : null,
          cancelled_at: cancelled ? at(dayBefore, '10:15') : null,
          cancelled_by: cancelled ? alternate(n, 'patient', 'staff') : null,
          completed_at: status === 'completed' ? at(visitDay, end) : null,
          created_by: provider.clinic.bookedBy,
        };
      }),
    ),
  );
}

export const scheduling: SeedFile = {
  title: 'scheduling',
  tables: [
    { table: 'providers', rows: providerRows },
    { table: 'provider_breaks', rows: breakRows },
    { table: 'treatment_types', rows: treatmentTypeRows },
    { table: 'clinic_hours', rows: clinicHoursRows },
    { table: 'patients', rows: patientRows },
  ],
  dayTables: (day) => [
    {
      table: 'closed_days',
      rows: [
        {
          id: seededId('closed_days', 1),
          clinic_id: HARBOUR_STREET.id,
          // The Monday after the seeded week.
          date: addDays(seedWeek(day)[0]!, 7),
          label: 'Staff training day',
        },
      ],
    },
    { table: 'appointments', rows: appointmentRows(day) },
  ],
  providerLinks: [
    {
      membershipId: SEEDED_MEMBERSHIPS.harbourStreetDentist,
      providerId: SEEDED_PROVIDERS.harbourStreetDentist,
    },
    {
      membershipId: SEEDED_MEMBERSHIPS.harbourStreetHygienist,
      providerId: SEEDED_PROVIDERS.harbourStreetHygienist,
    },
  ],
};

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { fakePhone } from '@/db/seed/fake-data';
import { withTenant } from '@/db/tenant';
import { expectPgError, insertClinic, insertMembership, migratorPool, PG } from './fixtures';
import {
  insertClinicRefs,
  insertProvider,
  insertRow,
  insertSql,
  insertUser,
  validRow,
  type ClinicRefs,
  type Row,
  type SchedulingTable,
} from './scheduling-fixtures';

// E01-T01a, acceptances 3 and 4: a row of one clinic can point only at rows of that clinic, and a
// value outside each list is refused. Rows are written as the migration role, which Row-Level
// Security does not hold, so only the tables' own constraints can refuse them; one case writes as
// the app role inside clinic A. Every value is synthetic.

const admin = migratorPool();
let a: ClinicRefs;
let b: ClinicRefs;

beforeAll(async () => {
  const userId = await insertUser(admin);
  a = await insertClinicRefs(admin, await insertClinic(admin), userId);
  b = await insertClinicRefs(admin, await insertClinic(admin), userId);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

let slots = 0;
/** A row of clinic A whose appointment, weekday or date no other row of this file takes. */
function rowOfA(table: SchedulingTable, change: Row = {}): Row {
  slots += 1;
  return { ...validRow(table, a, slots), ...change };
}

const insert = (table: SchedulingTable, row: Row) => insertRow(admin, table, row);

describe('a row points only at rows of its own clinic (acceptance 3)', () => {
  it('an appointment with its own clinic’s patient, provider and treatment type is accepted', async () => {
    await insert('appointments', rowOfA('appointments'));
  });

  it.each([
    {
      what: 'patient',
      column: 'patient_id',
      ref: 'patientId',
      constraint: 'appointments_patient_id_fk',
    },
    {
      what: 'provider',
      column: 'provider_id',
      ref: 'providerId',
      constraint: 'appointments_provider_id_fk',
    },
    {
      what: 'treatment type',
      column: 'treatment_type_id',
      ref: 'treatmentTypeId',
      constraint: 'appointments_treatment_type_id_fk',
    },
  ] as const)(
    "an appointment of clinic A cannot point at clinic B's $what",
    async ({ column, ref, constraint }) => {
      await expectPgError(
        insert('appointments', rowOfA('appointments', { [column]: b[ref] })),
        PG.foreignKeyViolation,
        constraint,
      );
    },
  );

  it("an appointment cannot be changed to point at clinic B's patient or provider", async () => {
    const row = rowOfA('appointments');
    await insert('appointments', row);
    await expectPgError(
      admin.query('update appointments set patient_id = $1 where id = $2', [b.patientId, row.id]),
      PG.foreignKeyViolation,
      'appointments_patient_id_fk',
    );
    await expectPgError(
      admin.query('update appointments set provider_id = $1 where id = $2', [b.providerId, row.id]),
      PG.foreignKeyViolation,
      'appointments_provider_id_fk',
    );
  });

  it('an appointment without a treatment type is accepted: the optional link is not checked', async () => {
    await insert('appointments', rowOfA('appointments', { treatment_type_id: null }));
  });

  it("the app role inside clinic A gets the same answer for clinic B's patient", async () => {
    await expectPgError(
      withTenant(a.clinicId, (tx) =>
        tx.execute(insertSql('appointments', rowOfA('appointments', { patient_id: b.patientId }))),
      ),
      PG.foreignKeyViolation,
      'appointments_patient_id_fk',
    );
  });

  it("a break of clinic A cannot point at clinic B's provider", async () => {
    await insert('provider_breaks', rowOfA('provider_breaks'));
    await expectPgError(
      insert('provider_breaks', rowOfA('provider_breaks', { provider_id: b.providerId })),
      PG.foreignKeyViolation,
      'provider_breaks_provider_id_fk',
    );
  });

  it("a membership in clinic A can be linked to clinic A's provider, never to clinic B's", async () => {
    const userId = await insertUser(admin);
    const membershipId = await insertMembership(admin, {
      clinicId: a.clinicId,
      userId,
      providerId: a.providerId,
    });
    await expectPgError(
      insertMembership(admin, {
        clinicId: a.clinicId,
        userId: await insertUser(admin),
        providerId: b.providerId,
      }),
      PG.foreignKeyViolation,
      'memberships_provider_id_fk',
    );
    await expectPgError(
      admin.query('update memberships set provider_id = $1 where id = $2', [
        b.providerId,
        membershipId,
      ]),
      PG.foreignKeyViolation,
      'memberships_provider_id_fk',
    );
    const { rows } = await admin.query('select provider_id from memberships where id = $1', [
      membershipId,
    ]);
    expect(rows).toEqual([{ provider_id: a.providerId }]);
  });
});

/** A column whose values come from a list: every allowed one is accepted, the others refused. */
interface ListCase {
  table: SchedulingTable;
  column: string;
  allowed: unknown[];
  refused: unknown[];
}

const LISTS: ListCase[] = [
  {
    table: 'providers',
    column: 'kind',
    allowed: ['dentist', 'hygienist', 'other'],
    refused: ['assistant', 'Dentist', ''],
  },
  {
    table: 'patients',
    column: 'status',
    allowed: ['active', 'archived', 'deceased'],
    refused: ['deleted', 'Active'],
  },
  {
    table: 'patients',
    column: 'whatsapp_status',
    allowed: ['unknown', 'available', 'unavailable'],
    refused: ['yes', 'opted_out'],
  },
  {
    // D-018. "No reply yet" is derived, never stored.
    table: 'appointments',
    column: 'status',
    allowed: ['booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'],
    refused: ['no_reply', 'pending', 'canceled', 'Booked'],
  },
  {
    table: 'appointments',
    column: 'source',
    allowed: ['staff', 'recall_link', 'patient_request', 'walk_in'],
    refused: ['online', 'phone'],
  },
  {
    table: 'appointments',
    column: 'confirmed_via',
    allowed: ['link', 'staff', null],
    refused: ['sms', 'whatsapp'],
  },
  {
    table: 'appointments',
    column: 'cancelled_by',
    allowed: ['patient', 'staff', null],
    refused: ['system', 'clinic'],
  },
];

describe('a value outside each list is refused by the database (acceptance 4)', () => {
  it.each(LISTS)(
    '$table.$column accepts each of its values',
    async ({ table, column, allowed }) => {
      for (const value of allowed) await insert(table, rowOfA(table, { [column]: value }));
    },
  );

  it.each(LISTS)('$table.$column refuses any other value', async ({ table, column, refused }) => {
    for (const value of refused) {
      await expectPgError(
        insert(table, rowOfA(table, { [column]: value })),
        PG.checkViolation,
        `${table}_${column}_check`,
      );
    }
  });
});

/** A value of the wrong form, out of range, or a time that ends before it starts. */
interface CheckCase {
  what: string;
  table: SchedulingTable;
  constraint: string;
  /** The columns that break it, given the valid row they replace. */
  change: (row: Row) => Row;
}

const before = (iso: unknown, minutes: number) =>
  new Date(Date.parse(iso as string) - minutes * 60_000).toISOString();

const CHECKS: CheckCase[] = [
  ...['eng', 'EN', 'e', ''].map((language) => ({
    what: `a language that is not a two-letter code (${JSON.stringify(language)})`,
    table: 'patients' as const,
    constraint: 'patients_language_check',
    change: () => ({ language }),
  })),
  ...[fakePhone(1).slice(1), `${fakePhone(1)} `, '+0700000001', 'phone'].map((phone, index) => ({
    what: `a phone number not in E.164 form (case ${index + 1})`,
    table: 'patients' as const,
    constraint: 'patients_phone_e164_check',
    change: () => ({ phone_e164: phone }),
  })),
  {
    what: 'an email with capital letters',
    table: 'patients',
    constraint: 'patients_email_check',
    change: () => ({ email: 'Patient@Example.test' }),
  },
  ...[-1, 360].map((hue) => ({
    what: `a colour hue of ${hue}`,
    table: 'providers' as const,
    constraint: 'providers_color_hue_check',
    change: () => ({ color_hue: hue }),
  })),
  {
    what: 'a treatment of zero minutes',
    table: 'treatment_types',
    constraint: 'treatment_types_default_duration_min_check',
    change: () => ({ default_duration_min: 0 }),
  },
  {
    what: 'a negative price',
    table: 'treatment_types',
    constraint: 'treatment_types_default_price_check',
    change: () => ({ default_price: -1 }),
  },
  ...(['provider_breaks', 'clinic_hours'] as const).flatMap((table) =>
    [0, 8].map((weekday) => ({
      what: `weekday ${weekday}`,
      table,
      constraint: `${table}_weekday_check`,
      change: () => ({ weekday }),
    })),
  ),
  {
    what: 'a break that ends before it starts',
    table: 'provider_breaks',
    constraint: 'provider_breaks_starts_check',
    change: () => ({ starts: '13:00', ends: '12:00' }),
  },
  {
    what: 'a break that ends when it starts',
    table: 'provider_breaks',
    constraint: 'provider_breaks_starts_check',
    change: () => ({ starts: '12:00', ends: '12:00' }),
  },
  {
    what: 'opening hours that close before they open',
    table: 'clinic_hours',
    constraint: 'clinic_hours_opens_check',
    change: () => ({ opens: '16:00', closes: '08:00' }),
  },
  {
    what: 'an appointment that ends when it starts',
    table: 'appointments',
    constraint: 'appointments_starts_at_check',
    change: (row) => ({ ends_at: row.starts_at }),
  },
  {
    what: 'an appointment that ends before it starts',
    table: 'appointments',
    constraint: 'appointments_starts_at_check',
    change: (row) => ({ ends_at: before(row.starts_at, 30) }),
  },
  {
    what: 'a cancelled appointment that ends before it starts',
    table: 'appointments',
    constraint: 'appointments_starts_at_check',
    change: (row) => ({ status: 'cancelled', ends_at: before(row.starts_at, 30) }),
  },
];

describe('values of the wrong form or out of range are refused too', () => {
  it.each(CHECKS)('$table: $what', async ({ table, constraint, change }) => {
    const row = rowOfA(table);
    await expectPgError(insert(table, { ...row, ...change(row) }), PG.checkViolation, constraint);
  });

  it('accepts the edges of each range and a value of the right form', async () => {
    await insert('patients', rowOfA('patients', { language: 'mk', phone_e164: fakePhone(1) }));
    await insert('patients', rowOfA('patients', { email: 'patient@example.test' }));
    for (const hue of [0, 359]) await insert('providers', rowOfA('providers', { color_hue: hue }));
    await insert('treatment_types', rowOfA('treatment_types', { default_price: 0 }));
    await insert('treatment_types', rowOfA('treatment_types', { default_price: null }));
    const clinicId = await insertClinic(admin); // its opening hours take each weekday once
    const providerId = await insertProvider(admin, clinicId);
    for (const weekday of [1, 7]) {
      const refs = { ...a, clinicId, providerId };
      await insert('clinic_hours', { ...validRow('clinic_hours', refs), weekday });
      await insert('provider_breaks', { ...validRow('provider_breaks', refs), weekday });
    }
  });
});

describe('opening hours and closed days', () => {
  it('hold one row per weekday and one per date in a clinic, and the same again in another', async () => {
    const [one, other] = [await insertClinic(admin), await insertClinic(admin)];
    const hours = (clinicId: string) => validRow('clinic_hours', { ...a, clinicId }, 2);
    const closed = (clinicId: string) => validRow('closed_days', { ...a, clinicId }, 2);
    await insert('clinic_hours', hours(one));
    await insert('closed_days', closed(one));
    await expectPgError(
      insert('clinic_hours', hours(one)),
      PG.uniqueViolation,
      'clinic_hours_clinic_id_weekday_key',
    );
    await expectPgError(
      insert('closed_days', closed(one)),
      PG.uniqueViolation,
      'closed_days_clinic_id_date_key',
    );
    await insert('clinic_hours', hours(other));
    await insert('closed_days', closed(other));
  });
});

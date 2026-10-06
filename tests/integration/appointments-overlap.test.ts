import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { expectPgError, insertClinic, migratorPool, PG, pgErrorConstraint } from './fixtures';
import {
  insertClinicRefs,
  insertProvider,
  insertSql,
  insertUser,
  slot,
  validRow,
  type ClinicRefs,
  type Row,
} from './scheduling-fixtures';

// E01-T01a, acceptance 2: no double booking (D-020, data-model.md). Every appointment is booked and
// changed as the app does it: as the app role, inside withTenant for the clinic. Each test books in
// hours of its own, far from the others'. Every value is synthetic.

const NO_DOUBLE_BOOKING = 'appointments_no_double_booking';

const admin = migratorPool();
let clinic: ClinicRefs;
let otherProvider: string;

beforeAll(async () => {
  clinic = await insertClinicRefs(admin, await insertClinic(admin), await insertUser(admin));
  otherProvider = await insertProvider(admin, clinic.clinicId, 'hygienist');
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

let hours = 0;
/** An hour of the calendar no other test books in. */
const freshHour = () => (hours += 10);

/** An appointment of the first provider in `hour`, from minute `from` to minute `to`. */
function visit(hour: number, from: number, to: number, change: Row = {}): Row {
  return {
    ...validRow('appointments', clinic),
    starts_at: slot(hour, from),
    ends_at: slot(hour, to),
    ...change,
  };
}

/** Books it as the front desk would: one transaction in the clinic. */
async function book(row: Row): Promise<void> {
  await withTenant(clinic.clinicId, (tx) => tx.execute(insertSql('appointments', row)));
}

/** Changes it in one transaction in the clinic, as a status change or a move would. */
async function change(id: unknown, set: Row): Promise<void> {
  const columns = sql.join(
    Object.entries(set).map(([column, value]) => sql`${sql.identifier(column)} = ${value}`),
    sql`, `,
  );
  await withTenant(clinic.clinicId, (tx) =>
    tx.execute(sql`update appointments set ${columns} where id = ${id}`),
  );
}

const refused = (promise: Promise<unknown>) =>
  expectPgError(promise, PG.exclusionViolation, NO_DOUBLE_BOOKING);

describe('no double booking (D-020)', () => {
  it('refuses a second appointment of the same provider at an overlapping time', async () => {
    const hour = freshHour();
    await book(visit(hour, 0, 30));
    // Over its end, over its start, inside it, around it, at the same time.
    for (const [from, to] of [
      [15, 45],
      [-15, 15],
      [5, 25],
      [-10, 40],
      [0, 30],
    ] as const) {
      await refused(book(visit(hour, from, to)));
    }
  });

  it('allows back to back: one visit ends at the minute the next one starts', async () => {
    const hour = freshHour();
    await book(visit(hour, 0, 30));
    await book(visit(hour, 30, 60));
    await book(visit(hour, -30, 0));
  });

  it('allows the same time for two providers', async () => {
    const hour = freshHour();
    await book(visit(hour, 0, 30));
    await book(visit(hour, 0, 30, { provider_id: otherProvider }));
  });

  it.each(['cancelled', 'no_show'])('allows an overlap with a %s appointment', async (status) => {
    const hour = freshHour();
    await book(visit(hour, 0, 30, { status }));
    await book(visit(hour, 0, 30));
    await book(visit(hour, 10, 40, { status })); // and a cancelled one never blocks either
  });

  it.each(['booked', 'confirmed', 'arrived', 'completed'])(
    'refuses an overlap with a %s appointment',
    async (status) => {
      const hour = freshHour();
      await book(visit(hour, 0, 30, { status }));
      await refused(book(visit(hour, 15, 45)));
    },
  );

  it('allows an overlap the staff booked anyway (overlap_ok), for that one appointment', async () => {
    const hour = freshHour();
    await book(visit(hour, 0, 30));
    await book(visit(hour, 0, 30, { overlap_ok: true }));
    // The first appointment still holds its time against every other booking.
    await refused(book(visit(hour, 15, 45)));
  });

  it.each(['cancelled', 'no_show'])(
    'refuses restoring a %s appointment into an overlap, and allows it when the time is free',
    async (status) => {
      const hour = freshHour();
      const restored = visit(hour, 0, 30, { status });
      await book(restored);
      await book(visit(hour, 15, 45));
      await refused(change(restored.id, { status: 'booked' }));

      const free = visit(freshHour(), 0, 30, { status });
      await book(free);
      await change(free.id, { status: 'booked' });
    },
  );

  it('refuses moving an appointment onto another, to another provider who is busy, or clearing overlap_ok', async () => {
    const hour = freshHour();
    await book(visit(hour, 0, 30));
    const later = visit(hour, 60, 90);
    await book(later);
    await refused(change(later.id, { starts_at: slot(hour, 15), ends_at: slot(hour, 45) }));

    const atTheOther = visit(hour, 0, 30, { provider_id: otherProvider });
    await book(atTheOther);
    await refused(change(atTheOther.id, { provider_id: clinic.providerId }));

    const anyway = visit(hour, 0, 30, { overlap_ok: true });
    await book(anyway);
    await refused(change(anyway.id, { overlap_ok: false }));
  });

  it('two bookings of the same time at the same moment: the second waits for the first, then is refused', async () => {
    const hour = freshHour();
    let firstBooked!: () => void;
    const booked = new Promise<void>((resolve) => {
      firstBooked = resolve;
    });
    // The first receptionist's transaction stays open while the second one books.
    const first = withTenant(clinic.clinicId, async (tx) => {
      await tx.execute(insertSql('appointments', visit(hour, 0, 30)));
      firstBooked();
      await tx.execute(sql`select pg_sleep(0.5)`);
    });
    await booked;
    const second = book(visit(hour, 15, 45));

    const [one, two] = await Promise.allSettled([first, second]);
    expect(one.status).toBe('fulfilled');
    expect(two.status).toBe('rejected');
    expect(pgErrorConstraint((two as PromiseRejectedResult).reason)).toBe(NO_DOUBLE_BOOKING);
  });
});

describe('the night the clocks go back (E01-T01a, tester)', () => {
  // 25 October 2026 in a clinic on Central European time: 02:00 to 03:00 comes twice, first in
  // summer time (+02:00), then in winter time (+01:00). The rule compares real moments, not the
  // clock on the wall.
  const summer = (time: string) => `2026-10-25T${time}:00+02:00`;
  const winter = (time: string) => `2026-10-25T${time}:00+01:00`;
  const at = (starts: string, ends: string) =>
    visit(0, 0, 30, { starts_at: starts, ends_at: ends });

  it('the same clock time an hour apart does not overlap; a visit across the change is checked in real time', async () => {
    await book(at(summer('02:15'), summer('02:45')));
    await book(at(winter('02:15'), winter('02:45'))); // the same clock time, an hour later
    // 02:40 summer time to 02:10 winter time is 30 minutes, though the clock goes back.
    await refused(book(at(summer('02:40'), winter('02:10')))); // over the end of the first
    await book(at(summer('02:50'), winter('02:10'))); // between the two
  });
});

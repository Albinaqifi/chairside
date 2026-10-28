import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { newId } from '@/lib/ids';
import * as scheduling from '@/modules/scheduling';
import { insertClinic, migratorPool } from './fixtures';
import { insertRow, insertUser, validRow, type ClinicRefs } from './scheduling-fixtures';

// E01-T09c, the tester's case (acceptance 3, wider): a move at once with the other writers of a
// provider's row, a booking (which locks the provider), a change and Make inactive, and several moves.
// The lock order must not deadlock (a wait longer than the 5 s lock timeout fails the test), no write
// may be lost (the change and the state survive a move that waited), and the clinic's places stay
// 0 ... n-1, each once. Synthetic names only.

const admin = migratorPool();
let clinic: string;
let bookerId: string;
let patient: string;
let treatment: string;

const NOW = new Date('2026-10-28T08:00:00Z');

beforeAll(async () => {
  clinic = await insertClinic(admin);
  bookerId = await insertUser(admin);
  const p = validRow('patients', { clinicId: clinic } as ClinicRefs);
  await insertRow(admin, 'patients', p);
  patient = p.id as string;
  const t = validRow('treatment_types', { clinicId: clinic } as ClinicRefs);
  await insertRow(admin, 'treatment_types', t);
  treatment = t.id as string;
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(async () => {
  await admin.query('delete from appointments where clinic_id = $1', [clinic]);
  await admin.query('delete from providers where clinic_id = $1', [clinic]);
});

async function setUp(name: string, place: number): Promise<string> {
  const id = newId();
  await insertRow(admin, 'providers', {
    ...validRow('providers', { clinicId: clinic } as ClinicRefs),
    id,
    name,
    short_name: name,
    kind: 'dentist',
    chair_label: 'Chair 9',
    color_hue: 120,
    active: true,
    sort_order: place,
  });
  return id;
}

const move = (providerId: string, direction: 'up' | 'down') =>
  withTenant(clinic, (tx) => scheduling.moveProvider(tx, { providerId, direction }, NOW));

describe('a move at once with the other writers of the provider rows', () => {
  it('moves, a booking, a change and Make inactive at once: none deadlocks, none is lost, the places are 0 ... n-1', async () => {
    const ids = [] as string[];
    for (const [place, name] of ['Ana', 'Boris', 'Cveta', 'Dime', 'Elena'].entries()) {
      ids.push(await setUp(name, place));
    }
    const [ana, boris, cveta, dime, elena] = ids as [string, string, string, string, string];
    const answers = await Promise.all([
      move(boris, 'up'),
      move(elena, 'up'),
      move(dime, 'down'),
      move(cveta, 'up'),
      withTenant(clinic, (tx) =>
        scheduling.createAppointment(
          tx,
          {
            patientId: patient,
            providerId: cveta,
            treatmentTypeId: treatment,
            day: '2031-03-17',
            startMinute: 9 * 60,
            lengthMinutes: 30,
            timeZone: 'Europe/Skopje',
            createdBy: bookerId,
            anyway: false,
          },
          NOW,
        ),
      ),
      withTenant(clinic, (tx) =>
        scheduling.changeProvider(
          tx,
          ana,
          {
            name: 'Ana Renamed',
            shortName: 'Ana R',
            kind: 'dentist',
            chairLabel: 'Chair 2',
            colorHue: 33,
          },
          NOW,
          { kindLocked: false },
        ),
      ),
      withTenant(clinic, (tx) => scheduling.setProviderActive(tx, boris, false, NOW)),
    ]);
    // Dime's Down may meet Elena's Up first and then has no place to go; everything else goes through.
    const refused = answers.flatMap((a, i) => (a.ok ? [] : [[i, 'code' in a ? a.code : '']]));
    expect(refused.every(([i, code]) => i === 2 && code === 'already_last')).toBe(true);
    const { rows } = await admin.query<{
      name: string;
      active: boolean;
      sort_order: number;
      chair_label: string;
    }>(
      'select name, active, sort_order, chair_label from providers where clinic_id = $1 order by sort_order, name, id',
      [clinic],
    );
    // No write is lost: the rename and the new chair, and Boris inactive, survived the moves.
    expect(rows.find((r) => r.name === 'Ana Renamed')?.chair_label).toBe('Chair 2');
    expect(rows.find((r) => r.name === 'Boris')?.active).toBe(false);
    expect(rows.find((r) => r.name === 'Ana')).toBeUndefined();
    // Every place is held once: the moves renumber the clinic 0 ... n-1.
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3, 4]);
    // The booking is kept.
    const visits = await admin.query('select provider_id from appointments where clinic_id = $1', [
      clinic,
    ]);
    expect(visits.rows).toEqual([{ provider_id: cveta }]);
  });

  it('twenty moves at once over six providers: every provider in one place, 0 ... n-1, no deadlock', async () => {
    const ids = [] as string[];
    for (const [place, name] of ['A', 'B', 'C', 'D', 'E', 'F'].entries()) {
      ids.push(await setUp(name, place));
    }
    const moves = Array.from({ length: 20 }, (_, i) =>
      move(ids[i % ids.length]!, i % 3 === 0 ? 'down' : 'up'),
    );
    const answers = await Promise.all(moves);
    for (const a of answers) {
      if (!a.ok) expect(['already_first', 'already_last']).toContain(a.code);
    }
    const { rows } = await admin.query<{ sort_order: number }>(
      'select sort_order from providers where clinic_id = $1 order by sort_order',
      [clinic],
    );
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { newId } from '@/lib/ids';
import * as audit from '@/modules/audit';
import { insertClinic, migratorPool } from './fixtures';

// audit.record(): one row in the clinic of the transaction it is given (E00-T03).
const admin = migratorPool();
let clinicA: string;
let clinicB: string;

beforeAll(async () => {
  [clinicA, clinicB] = await Promise.all([insertClinic(admin), insertClinic(admin)]);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

const entry = (overrides: Partial<audit.AuditEntry> = {}): audit.AuditEntry => ({
  at: new Date('2026-03-10T09:15:30.456Z'),
  actorType: 'user',
  actorId: newId(),
  action: 'patient.updated',
  entityType: 'patient',
  entityId: newId(),
  metadata: { fields: ['firstName', 'phone'], count: 2 },
  ...overrides,
});

async function rowsFor(entityId: string) {
  const { rows } = await admin.query(
    `select clinic_id, at, actor_type, actor_id, action, entity_type, entity_id, metadata
       from audit_log where entity_id = $1`,
    [entityId],
  );
  return rows;
}

describe('audit.record', () => {
  it("writes one row in the transaction's clinic, with every field as given", async () => {
    const written = entry();
    const id = await withTenant(clinicA, (tx) => audit.record(tx, written));

    expect(await rowsFor(written.entityId!)).toEqual([
      {
        clinic_id: clinicA,
        at: written.at,
        actor_type: 'user',
        actor_id: written.actorId,
        action: 'patient.updated',
        entity_type: 'patient',
        entity_id: written.entityId,
        metadata: { fields: ['firstName', 'phone'], count: 2 },
      },
    ]);
    const { rows } = await admin.query('select entity_id from audit_log where id = $1', [id]);
    expect(rows).toEqual([{ entity_id: written.entityId }]);
  });

  it('writes into the clinic of the transaction only: there is no clinic to pass', async () => {
    const written = entry();
    await withTenant(clinicB, (tx) => audit.record(tx, written));
    expect((await rowsFor(written.entityId!)).map((row) => row.clinic_id)).toEqual([clinicB]);
  });

  it('writes a system event without an actor id, and an event without an entity', async () => {
    const system = entry({ actorType: 'system', actorId: null });
    await withTenant(clinicA, (tx) => audit.record(tx, system));
    expect(await rowsFor(system.entityId!)).toMatchObject([
      { actor_type: 'system', actor_id: null },
    ]);

    const action = `test.no_entity_${newId().slice(-6)}`.replace(/-/g, '_');
    await withTenant(clinicA, (tx) =>
      audit.record(tx, entry({ action, entityType: null, entityId: null, metadata: undefined })),
    );
    const { rows } = await admin.query(
      'select entity_type, entity_id, metadata from audit_log where action = $1',
      [action],
    );
    expect(rows).toEqual([{ entity_type: null, entity_id: null, metadata: {} }]);
  });

  it('refuses a personal field in the metadata, and the whole transaction rolls back', async () => {
    const kept = entry();
    const refused = entry({ metadata: { changes: [{ patientEmail: 'x@example.test' }] } });

    await expect(
      withTenant(clinicA, async (tx) => {
        await audit.record(tx, kept);
        await audit.record(tx, refused);
      }),
    ).rejects.toThrow(/personal field/);

    expect(await rowsFor(kept.entityId!), 'the first row went with the rollback').toEqual([]);
    expect(await rowsFor(refused.entityId!)).toEqual([]);
  });
});

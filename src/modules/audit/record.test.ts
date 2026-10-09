import { describe, expect, it } from 'vitest';
import { newId } from '@/lib/ids';
import { checkedEntry, type AuditEntry, type AuditMetadata } from './record';

// What audit.record() refuses before anything is written. Values are synthetic; a marker in an
// error message would mean the message repeats what it refused.
const MARKER = 'MARKER-a7d3';

const valid: AuditEntry = {
  at: new Date('2026-03-10T09:00:00.123Z'),
  actorType: 'user',
  actorId: newId(),
  action: 'patient.updated',
  entityType: 'patient',
  entityId: newId(),
  metadata: { fields: ['email', 'phone'], count: 2, changed: true, previous: null },
};

/** The error checkedEntry throws for this metadata, or undefined. */
function refusalOf(metadata: unknown): Error | undefined {
  try {
    checkedEntry({ ...valid, metadata: metadata as AuditMetadata });
    return undefined;
  } catch (error) {
    return error as Error;
  }
}

describe('audit entry metadata', () => {
  it('accepts ids, codes, counts and field names given as values', () => {
    expect(checkedEntry(valid)).toEqual(valid.metadata);
    expect(checkedEntry({ ...valid, metadata: undefined })).toEqual({});
  });

  it.each([
    ['at the top', { email: MARKER }],
    ['in another spelling', { Patient_Phone: MARKER }],
    ['nested in an object', { changes: { firstName: MARKER } }],
    ['in an object inside a list', { rows: [{ id: 1 }, { notes: MARKER }] }],
    ['deep down', { a: { b: [[{ c: { dateOfBirth: MARKER } }]] } }],
  ])('refuses a personal field name %s, naming neither the key nor the value', (_, metadata) => {
    const refusal = refusalOf(metadata);
    expect(refusal?.message).toMatch(/personal field/);
    expect(refusal?.message).not.toContain(MARKER);
    expect(refusal?.message).not.toMatch(/email|phone|firstName|notes|dateOfBirth/i);
  });

  // E00-T05b: the plurals personal-fields.ts adds. Metadata holds ids and codes, so a plural is
  // refused whatever it holds, a list of records too (the logger cleans those record by record).
  it.each([
    ['a list of values', { phones: [MARKER] }],
    ['a list of records', { recipients: [{ id: 'recipient-1' }] }],
    ['nested', { changes: [{ treatmentTypes: [MARKER] }] }],
  ])('refuses a personal field name in the plural, holding %s', (_, metadata) => {
    const refusal = refusalOf(metadata);
    expect(refusal?.message).toMatch(/personal field/);
    expect(refusal?.message).not.toContain(MARKER);
  });

  it('checks what will be stored, so toJSON, getters and class instances cannot hide a key', () => {
    class Changes {
      email: string;
      constructor(email: string) {
        this.email = email;
      }
    }
    const cases = [
      { when: { toJSON: () => ({ email: MARKER }) } },
      Object.defineProperty({}, 'phone', { get: () => MARKER, enumerable: true }),
      { changes: new Changes(MARKER) },
    ];
    for (const metadata of cases) expect(refusalOf(metadata)?.message).toMatch(/personal field/);
  });

  it('refuses metadata that is not a JSON object', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    for (const metadata of [[1, 2], 'text', { big: BigInt(10) }, loop]) {
      expect(refusalOf(metadata), JSON.stringify(typeof metadata)).toBeInstanceOf(TypeError);
    }
  });
});

describe('audit entry fields', () => {
  const refused = (change: Partial<Record<keyof AuditEntry, unknown>>) => () =>
    checkedEntry({ ...valid, ...change } as AuditEntry);

  it('takes a valid time, and ids that are UUIDs', () => {
    expect(refused({ at: new Date(Number.NaN) })).toThrow(/at/);
    expect(refused({ at: '2026-03-10T09:00:00Z' })).toThrow(/at/);
    expect(refused({ actorId: 'staff-1' })).toThrow(/actorId/);
    expect(refused({ entityId: MARKER })).toThrow(/entityId/);
    expect(refused({ entityId: undefined })).toThrow(/entityId/);
  });

  it('needs an actor id for a user or a patient link, and allows none for the system', () => {
    expect(refused({ actorId: null })).toThrow(/actorId/);
    expect(refused({ actorType: 'patient_link', actorId: null })).toThrow(/actorId/);
    expect(refused({ actorType: 'admin' })).toThrow(/actor type/);
    expect(checkedEntry({ ...valid, actorType: 'system', actorId: null })).toBeDefined();
  });

  it('takes the action and entity type as codes, never free text', () => {
    for (const action of ['patient', 'Patient.Created', `patient viewed ${MARKER}`, '', 'a..b']) {
      expect(refused({ action }), action).toThrow(/action/);
    }
    for (const entityType of ['Patient', `patient ${MARKER}`, '', undefined]) {
      expect(refused({ entityType }), String(entityType)).toThrow(/entityType/);
    }
    expect(
      checkedEntry({ ...valid, action: 'user.logged_in', entityType: null, entityId: null }),
    ).toBeDefined();
  });
});

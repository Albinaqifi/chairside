import { describe, expect, it } from 'vitest';
import { resolveClinic, type ClinicChoice } from './resolve-clinic';

const a: ClinicChoice = {
  membershipId: '0199a000-0000-7000-8000-0000000000a1',
  clinicId: '0199a000-0000-7000-8000-00000000000a',
  clinicName: 'A',
  role: 'owner',
  extraPermissions: [],
  providerKind: null,
};
const b: ClinicChoice = {
  membershipId: '0199a000-0000-7000-8000-0000000000b1',
  clinicId: '0199a000-0000-7000-8000-00000000000b',
  clinicName: 'B',
  role: 'dentist',
  extraPermissions: ['import'],
  providerKind: 'dentist',
};
const c = '0199a000-0000-7000-8000-00000000000c'; // no membership there

describe('resolveClinic', () => {
  it('uses the picked clinic when it is one of the choices', () => {
    expect(resolveClinic([a, b], b.clinicId)).toEqual({ kind: 'clinic', choice: b });
  });

  it('asks the user to choose when they have several and picked none, or picked a clinic they cannot enter', () => {
    expect(resolveClinic([a, b], undefined)).toEqual({ kind: 'choose', choices: [a, b] });
    expect(resolveClinic([a, b], c)).toEqual({ kind: 'choose', choices: [a, b] });
  });

  it('takes the only clinic, whatever was picked', () => {
    expect(resolveClinic([a], undefined)).toEqual({ kind: 'clinic', choice: a });
    expect(resolveClinic([a], c)).toEqual({ kind: 'clinic', choice: a });
  });

  it('reports no clinic for a user without active memberships, even with a picked id', () => {
    expect(resolveClinic([], undefined)).toEqual({ kind: 'none' });
    expect(resolveClinic([], a.clinicId)).toEqual({ kind: 'none' });
  });
});

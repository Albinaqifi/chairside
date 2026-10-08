import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { logger } from '@/lib/logger';
import { createPatient, findLikelyDuplicates } from './actions';

// E01-T02b, acceptance 3 (and the action's side of 1, 2, 4 and 6): what the new-patient actions take
// from a form and hand the patients module, what they answer, and the audit row they ask for. They
// are the real wrapper-made actions; only who is asking (currentStaff), the transaction, the audit
// log, the patients module and next/cache are stand-ins, as no database or Next.js runs here. The
// module's work against real rows is in tests/integration/patients-create.test.ts. Every value is
// synthetic: names from the invented lists, the seed's made-up phone block, example.test.

const CLINIC = '01970000-0000-7000-8000-0000000000e1';
const PATIENT = '01970000-0000-7000-8000-0000000000e2';
const USER = '01970000-0000-7000-8000-0000000000e3';
const TX = { stand: 'in for the transaction' };

const request = vi.hoisted(() => ({ staff: undefined as Staff | undefined }));
vi.mock('@/app/_lib/auth', () => ({
  currentStaff: () => Promise.resolve(request.staff),
  requireUser: () => Promise.reject(new Error('the new-patient actions are staff actions')),
}));

const db = vi.hoisted(() => ({ opened: 0 }));
vi.mock('@/db/tenant', () => ({
  withTenant: async (_clinicId: string, work: (tx: unknown) => Promise<unknown>) => {
    db.opened += 1;
    return work(TX);
  },
}));

const audit = vi.hoisted(() => ({ record: vi.fn(() => Promise.resolve('row')) }));
vi.mock('@/modules/audit', () => ({ record: audit.record }));

const patients = vi.hoisted(() => ({ create: vi.fn(), likelyDuplicates: vi.fn() }));
vi.mock('@/modules/patients', () => patients);

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);

function frontDesk(): Staff {
  return {
    user: { id: USER, name: 'Front desk', email: 'front-desk-new-patient@example.test' },
    clinic: {
      membershipId: '01970000-0000-7000-8000-0000000000e4',
      clinicId: CLINIC,
      clinicName: 'Test clinic (synthetic)',
      role: 'front_desk',
      extraPermissions: [],
      providerKind: null,
    },
    clinicCount: 1,
  };
}

/** The form's data: every field, as the browser sends it, with those given in place of these. */
function sent(fields: Record<string, string | undefined> = {}): FormData {
  const all: Record<string, string | undefined> = {
    firstName: 'Ana',
    lastName: 'Kodra',
    dateOfBirth: '1990-01-01',
    language: 'en',
    phone: '070 001 234',
    email: 'ana.kodra@example.test',
    guardianName: '',
    notes: '',
    ...fields,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(all))
    if (value !== undefined) data.append(name, value);
  return data;
}

beforeEach(() => {
  request.staff = frontDesk();
  db.opened = 0;
  audit.record.mockClear();
  patients.create.mockReset();
  patients.create.mockResolvedValue({ ok: true, id: PATIENT });
  patients.likelyDuplicates.mockReset();
  patients.likelyDuplicates.mockResolvedValue([]);
  cache.revalidatePath.mockReset();
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPatient: what it hands patients.create', () => {
  it('names and notes trimmed, the email trimmed and lower-cased, a blank field as none', async () => {
    const result = await createPatient(
      CLINIC,
      sent({
        firstName: '  Ana ',
        lastName: 'Kodra  ',
        email: ' Ana.Kodra@Example.TEST ',
        guardianName: '   ',
        notes: '  Prefers mornings.  ',
      }),
    );
    expect(result).toEqual({ ok: true, value: { id: PATIENT } });
    expect(patients.create).toHaveBeenCalledExactlyOnceWith(
      TX,
      {
        firstName: 'Ana',
        lastName: 'Kodra',
        dateOfBirth: '1990-01-01',
        phone: '070 001 234',
        email: 'ana.kodra@example.test',
        language: 'en',
        guardianName: null,
        notes: 'Prefers mornings.',
      },
      expect.any(Date),
    );
  });

  it('optional fields left empty, or not sent at all: none (null), notes empty, and no field problem', async () => {
    for (const data of [
      sent({ dateOfBirth: '', phone: '', email: '', guardianName: '', notes: '' }),
      sent({ dateOfBirth: undefined, phone: undefined, email: undefined, guardianName: undefined }),
    ]) {
      patients.create.mockClear();
      expect(await createPatient(CLINIC, data)).toEqual({ ok: true, value: { id: PATIENT } });
      expect(patients.create).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({
          dateOfBirth: null,
          phone: null,
          email: null,
          guardianName: null,
          notes: '',
        }),
        expect.any(Date),
      );
    }
  });

  it('a guardian named: their name, trimmed, with the phone and email as typed', async () => {
    await createPatient(CLINIC, sent({ guardianName: ' Elena Kodra ' }));
    expect(patients.create).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ guardianName: 'Elena Kodra', phone: '070 001 234' }),
      expect.any(Date),
    );
  });

  it('the date field sends a half-typed date as empty: stored as none, by design', async () => {
    expect(await createPatient(CLINIC, sent({ dateOfBirth: '' }))).toMatchObject({ ok: true });
    expect(patients.create).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ dateOfBirth: null }),
      expect.any(Date),
    );
  });
});

describe('createPatient: what the input alone settles is refused at its field, before any transaction (D-098)', () => {
  it.each([
    {
      what: 'an email that is no email',
      fields: { email: 'ana.kodra' },
      path: 'email',
      code: 'invalid_format',
    },
    {
      what: 'an email with no domain name',
      fields: { email: 'ana@kodra' },
      path: 'email',
      code: 'invalid_format',
    },
    {
      what: 'a first name missing',
      fields: { firstName: '' },
      path: 'firstName',
      code: 'too_small',
    },
    {
      what: 'a last name of blanks',
      fields: { lastName: '   ' },
      path: 'lastName',
      code: 'too_small',
    },
    {
      what: 'a date that is no date',
      fields: { dateOfBirth: '2031-02-30' },
      path: 'dateOfBirth',
      code: 'invalid_format',
    },
    {
      what: 'a date in another form',
      fields: { dateOfBirth: '01.01.1990' },
      path: 'dateOfBirth',
      code: 'invalid_format',
    },
    {
      what: 'a language that is not two lower-case letters',
      fields: { language: 'EN' },
      path: 'language',
      code: 'invalid_format',
    },
    {
      what: 'a first name of 101 characters',
      fields: { firstName: 'A'.repeat(101) },
      path: 'firstName',
      code: 'too_big',
    },
    {
      what: 'notes of 2,001 characters',
      fields: { notes: 'n'.repeat(2001) },
      path: 'notes',
      code: 'too_big',
    },
    {
      what: 'a phone of 41 characters',
      fields: { phone: '0'.repeat(41) },
      path: 'phone',
      code: 'too_big',
    },
  ])('$what: invalid_input at $path', async ({ fields, path, code }) => {
    expect(await createPatient(CLINIC, sent(fields))).toEqual({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: [path], code }] },
    });
    expect(db.opened).toBe(0);
    expect(patients.create).not.toHaveBeenCalled();
  });
});

describe('createPatient: its answer, its audit row and the list read again', () => {
  it('done: the new id only, one audit row patient.created with no personal value, /patients revalidated', async () => {
    expect(await createPatient(CLINIC, sent())).toEqual({ ok: true, value: { id: PATIENT } });
    expect(audit.record).toHaveBeenCalledExactlyOnceWith(TX, {
      at: expect.any(Date),
      actorType: 'user',
      actorId: USER,
      action: 'patient.created',
      entityType: 'patient',
      entityId: PATIENT,
      metadata: undefined,
    });
    expect(cache.revalidatePath).toHaveBeenCalledExactlyOnceWith('/patients');
  });

  it('an impossible phone: phone_impossible, with no audit row and nothing revalidated', async () => {
    patients.create.mockResolvedValue({ ok: false, code: 'phone_impossible' });
    expect(await createPatient(CLINIC, sent({ phone: '070 001 23' }))).toEqual({
      ok: false,
      error: { code: 'phone_impossible' },
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it('a clinic country the phone package does not know: internal, never phone_impossible', async () => {
    patients.create.mockRejectedValue(
      new Error('readPhone: the clinic names a country the phone package does not know'),
    );
    expect(await createPatient(CLINIC, sent())).toEqual({ ok: false, error: { code: 'internal' } });
    expect(audit.record).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it('sent for another clinic than the request is in: clinic_changed, before any transaction', async () => {
    expect(await createPatient('01970000-0000-7000-8000-0000000000e9', sent())).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect(db.opened).toBe(0);
  });
});

describe('findLikelyDuplicates: what it hands patients.likelyDuplicates', () => {
  const typed = {
    firstName: 'Ana',
    lastName: 'Kodra',
    dateOfBirth: '1990-01-01',
    phone: '070 001 234',
    email: 'ana.kodra@example.test',
  };

  it('what is typed, as the module reads it, and the patients it finds; no audit row', async () => {
    const found = [{ id: PATIENT, firstName: 'Ana', lastName: 'Kodra', dateOfBirth: '1990-01-01' }];
    patients.likelyDuplicates.mockResolvedValue(found);
    expect(await findLikelyDuplicates(CLINIC, typed)).toEqual({ ok: true, value: found });
    expect(patients.likelyDuplicates).toHaveBeenCalledExactlyOnceWith(TX, typed);
    expect(audit.record).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it('blank fields as none, an empty date included', async () => {
    await findLikelyDuplicates(CLINIC, { ...typed, dateOfBirth: '', phone: ' ', email: '' });
    expect(patients.likelyDuplicates).toHaveBeenCalledWith(TX, {
      firstName: 'Ana',
      lastName: 'Kodra',
      dateOfBirth: null,
      phone: null,
      email: null,
    });
  });

  it('an email that is no email is still looked for: it simply matches no one', async () => {
    await findLikelyDuplicates(CLINIC, { ...typed, email: 'ana.kodra' });
    expect(patients.likelyDuplicates).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ email: 'ana.kodra' }),
    );
  });

  it('a date that is no date: invalid_input, before any transaction', async () => {
    expect(await findLikelyDuplicates(CLINIC, { ...typed, dateOfBirth: '1990-02-30' })).toEqual({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: ['dateOfBirth'], code: 'invalid_format' }] },
    });
    expect(db.opened).toBe(0);
  });

  it('sent for another clinic than the request is in: clinic_changed, before any transaction', async () => {
    expect(await findLikelyDuplicates('01970000-0000-7000-8000-0000000000e9', typed)).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
    expect(db.opened).toBe(0);
  });
});

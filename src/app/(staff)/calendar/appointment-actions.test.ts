import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { changeAppointmentStatus } from './appointment-actions';

// E01-T06g: the restore branch of changeAppointmentStatus reads the "anyway" a form sends. A form
// sends the text "true" (the drawer's hidden field), a caller of the action may send a boolean, and a
// field that is not sent is false. These are the real wrapper-made action and its real schema; only
// who is asking, the transaction, the audit log and the scheduling module's change are stand-ins, so
// the test sees the request the module gets. Every value is synthetic.

const CLINIC = '01970000-0000-7000-8000-0000000000e1';
const VISIT = '01970000-0000-7000-8000-0000000005c1';

vi.mock('@/app/_lib/auth', () => ({
  currentStaff: () =>
    Promise.resolve({
      user: {
        id: '01970000-0000-7000-8000-0000000000e2',
        name: 'Demo member',
        email: 'demo-member@example.test',
      },
      clinic: {
        membershipId: '01970000-0000-7000-8000-0000000000e3',
        clinicId: CLINIC,
        clinicName: 'Test clinic (synthetic)',
        role: 'front_desk',
        extraPermissions: [],
        providerKind: null,
      },
      clinicCount: 1,
    } satisfies Staff),
  requireUser: () => Promise.reject(new Error('a staff action')),
}));
vi.mock('@/db/tenant', () => ({
  withTenant: (_clinicId: string, work: (tx: unknown) => Promise<unknown>) => work({}),
}));
vi.mock('@/modules/audit', () => ({ record: vi.fn(() => Promise.resolve('row')) }));
vi.mock('@/modules/tenancy', () => ({
  clinicPlace: () => Promise.resolve({ timeZone: 'Europe/Skopje' }),
}));
vi.mock('@/modules/patients', () => ({ patientStatus: () => Promise.resolve('active') }));
vi.mock('next/cache', () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const change = vi.hoisted(() => vi.fn());
vi.mock('@/modules/scheduling', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/scheduling')>()),
  changeAppointmentStatus: change,
}));

beforeEach(() => {
  change.mockReset();
  change.mockResolvedValue({ ok: true, from: 'cancelled', to: 'booked' });
});

/** What a form sends: text fields only. */
function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

/** The `anyway` the module was asked to restore with. */
function askedAnyway(): unknown {
  expect(change).toHaveBeenCalledTimes(1);
  const request = change.mock.calls[0]?.[1] as { action: string; anyway: unknown };
  expect(request.action).toBe('restore');
  return request.anyway;
}

describe('the restore branch reads the "anyway" a form sends', () => {
  it('the text "true" restores over an overlap', async () => {
    const answer = await changeAppointmentStatus(
      CLINIC,
      formData({ appointmentId: VISIT, action: 'restore', anyway: 'true' }),
    );
    expect(answer).toMatchObject({ ok: true, value: { from: 'cancelled', to: 'booked' } });
    expect(askedAnyway()).toBe(true);
  });

  it('a field that is not sent is false', async () => {
    await changeAppointmentStatus(CLINIC, formData({ appointmentId: VISIT, action: 'restore' }));
    expect(askedAnyway()).toBe(false);
  });

  it.each([
    [true, true],
    [false, false],
  ])('a caller’s boolean %s stands: %s', async (sent, expected) => {
    await changeAppointmentStatus(CLINIC, {
      appointmentId: VISIT,
      action: 'restore',
      anyway: sent,
    });
    expect(askedAnyway()).toBe(expected);
  });

  it.each(['false', 'yes', '1', ''])(
    'the text %j is no "anyway": the input is refused and the module is never asked',
    async (sent) => {
      const answer = await changeAppointmentStatus(
        CLINIC,
        formData({ appointmentId: VISIT, action: 'restore', anyway: sent }),
      );
      expect(answer).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(change).not.toHaveBeenCalled();
    },
  );
});
